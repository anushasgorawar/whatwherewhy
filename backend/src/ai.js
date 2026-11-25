const axios = require("axios");
const { promisify } = require("util");
const { exec } = require("child_process");
const { PassThrough } = require("stream");
const { z } = require("zod");
const { getClients, summarizePod } = require("./k8s");
const { fetchPodMetricsFromMetricsServer } = require("./metrics-server");

const execAsync = promisify(exec);
const DEFAULT_TAIL = 200;
const INSPECT_TAIL_LINES = 20;
const MAX_EVIDENCE_LOG_CHARS = 2000;
const AI_HTTP_TIMEOUT_MS = Number(process.env.AI_HTTP_TIMEOUT_MS || 60000);

const inspectResponseSchema = z.object({
  command: z.string().trim().min(1),
  explanation: z.string().trim().min(1)
});

// Sent to the provider so the model output is constrained to exactly these two fields.
const INSPECT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "Exactly one kubectl command to run, scoped with -n <namespace>."
    },
    explanation: {
      type: "string",
      description: "One or two short sentences: what is wrong and why this command addresses it."
    }
  },
  required: ["command", "explanation"],
  additionalProperties: false
};

function trimEvidence(text, maxChars = MAX_EVIDENCE_LOG_CHARS) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function resolvePodName(selectedPod, pods) {
  const podNames = (pods || []).map((pod) => pod.name).filter(Boolean);
  if (podNames.length === 0) return "";
  if (!selectedPod) return podNames[0];
  if (podNames.includes(selectedPod)) return selectedPod;

  // Allow deployment-style input (e.g., "memory-simulator") by mapping to a live pod name.
  const withDashMatch = podNames.find((name) => name.startsWith(`${selectedPod}-`));
  if (withDashMatch) return withDashMatch;

  const containsMatch = podNames.find((name) => name.includes(selectedPod));
  if (containsMatch) return containsMatch;

  return podNames[0];
}

function normalizeProviderErrorMessage(cause) {
  const text = String(cause || "Upstream provider failure");
  return text.replace(/status code(\d{3})\b/i, "status code $1");
}

function makeTransientProviderError(message, code = "TRANSIENT_PROVIDER_ERROR") {
  const err = new Error(message);
  err.code = code;
  err.isTransientProviderFailure = true;
  return err;
}

function normalizeGeminiModelName(modelName) {
  return String(modelName || "").replace(/^models\//, "").trim();
}

async function getGoogleGenAI(apiKey) {
  const mod = await import("@google/genai");
  const GoogleGenAI = mod?.GoogleGenAI;
  if (!GoogleGenAI) {
    throw new Error("Failed to load @google/genai (GoogleGenAI export missing).");
  }
  if (apiKey) {
    process.env.GEMINI_API_KEY = apiKey;
  }
  // Align with SDK usage where constructor reads env key by default.
  return new GoogleGenAI({});
}

async function withTimeout(task, ms, message) {
  let timer;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(makeTransientProviderError(message, "ECONNABORTED"));
        }, ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isTransientProviderFailure(err) {
  if (err?.isTransientProviderFailure) return true;
  const status = err?.response?.status;
  if (status === 429) return true;
  if (Number.isInteger(status) && status >= 500 && status <= 599) return true;
  if (err?.code === "ECONNABORTED") return true;
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("timed out");
}

async function fetchPodLogs(namespace, pod, container, tail = DEFAULT_TAIL, previous = false) {
  const { log } = getClients();
  const stream = new PassThrough();

  await log.log(namespace, pod, container, stream, {
    follow: false,
    pretty: false,
    timestamps: true,
    tailLines: tail,
    previous
  });

  return await new Promise((resolve, reject) => {
    let data = "";
    stream.on("data", (chunk) => {
      data += chunk.toString("utf8");
    });
    stream.on("end", () => resolve(data));
    stream.on("error", (err) => reject(err));
  });
}

const SENSITIVE_ENV_NAME = /pass|secret|token|key|credential|auth/i;

function describeEnvVar(env) {
  if (env.valueFrom?.secretKeyRef) return { name: env.name, from: "Secret" };
  if (env.valueFrom?.configMapKeyRef) {
    const ref = env.valueFrom.configMapKeyRef;
    return { name: env.name, from: `ConfigMap ${ref.name}/${ref.key}` };
  }
  if (env.valueFrom) return { name: env.name, from: "field or resource reference" };
  if (SENSITIVE_ENV_NAME.test(env.name)) return { name: env.name, value: "[redacted]" };
  return { name: env.name, value: String(env.value ?? "").slice(0, 100) };
}

function describeContainerState(state) {
  if (!state) return null;
  if (state.running) return { state: "running" };
  if (state.waiting) return { state: "waiting", reason: state.waiting.reason || "" };
  if (state.terminated) {
    return { state: "terminated", reason: state.terminated.reason || "", exitCode: state.terminated.exitCode };
  }
  return null;
}

async function resolveOwnerDeployment(namespace, rawPod) {
  const owner = (rawPod.metadata?.ownerReferences || []).find((ref) => ref.controller) || rawPod.metadata?.ownerReferences?.[0];
  if (!owner) return null;
  if (owner.kind !== "ReplicaSet") return { kind: owner.kind, name: owner.name };
  try {
    const { apps } = getClients();
    const rs = await apps.readNamespacedReplicaSet({ name: owner.name, namespace });
    const rsOwner = (rs.metadata?.ownerReferences || []).find((ref) => ref.kind === "Deployment");
    return rsOwner ? { kind: "Deployment", name: rsOwner.name } : { kind: "ReplicaSet", name: owner.name };
  } catch (_err) {
    return { kind: "ReplicaSet", name: owner.name };
  }
}

// Compact, Kubernetes-sourced facts about the selected pod (no secret values).
async function buildPodStatusEvidence(namespace, rawPod) {
  const statuses = rawPod.status?.containerStatuses || [];
  const containers = (rawPod.spec?.containers || []).map((c) => {
    const s = statuses.find((st) => st.name === c.name) || {};
    return {
      name: c.name,
      ready: Boolean(s.ready),
      restartCount: s.restartCount || 0,
      currentState: describeContainerState(s.state),
      lastTermination: describeContainerState(s.lastState),
      resources: {
        requests: c.resources?.requests || {},
        limits: c.resources?.limits || {}
      },
      env: (c.env || []).map(describeEnvVar),
      envFrom: (c.envFrom || []).map((ref) =>
        ref.configMapRef ? `ConfigMap ${ref.configMapRef.name}` : ref.secretRef ? "Secret" : "other"
      )
    };
  });

  return {
    phase: rawPod.status?.phase || "Unknown",
    status: summarizePod(rawPod).status,
    owner: await resolveOwnerDeployment(namespace, rawPod),
    containers
  };
}

async function fetchPodEvents(namespace, podName) {
  try {
    const { core } = getClients();
    const list = await core.listNamespacedEvent({
      namespace,
      fieldSelector: `involvedObject.name=${podName}`
    });
    return (list.items || [])
      .sort((a, b) => new Date(a.lastTimestamp || a.eventTime || 0) - new Date(b.lastTimestamp || b.eventTime || 0))
      .slice(-10)
      .map((e) => ({ type: e.type, reason: e.reason, message: String(e.message || "").slice(0, 200), count: e.count || 1 }));
  } catch (_err) {
    return [];
  }
}

async function collectIncidentEvidence({ namespace, selectedPod, tail = DEFAULT_TAIL }) {
  const { core } = getClients();
  const podList = await core.listNamespacedPod({ namespace });
  const pods = (podList.items || []).map(summarizePod);

  let metrics = [];
  try {
    metrics = await fetchPodMetricsFromMetricsServer(namespace);
  } catch (_err) {
    metrics = [];
  }

  const fallbackPod = resolvePodName(selectedPod, pods);
  const selectedPodObj = pods.find((pod) => pod.name === fallbackPod);
  const selectedContainer = selectedPodObj?.containers?.[0] || "";

  let logs = "";
  if (fallbackPod) {
    try {
      logs = await fetchPodLogs(namespace, fallbackPod, selectedContainer, tail);
    } catch (err) {
      logs = `Could not fetch logs for pod '${fallbackPod}': ${err.message}`;
    }
  }

  const rawPod = (podList.items || []).find((item) => item.metadata?.name === fallbackPod);
  let podStatus = null;
  let events = [];
  let previousLogs = "";
  if (rawPod) {
    podStatus = await buildPodStatusEvidence(namespace, rawPod);
    events = await fetchPodEvents(namespace, fallbackPod);
    const restarted = podStatus.containers.find((c) => c.name === selectedContainer)?.restartCount > 0;
    if (restarted) {
      try {
        previousLogs = await fetchPodLogs(namespace, fallbackPod, selectedContainer, tail, true);
      } catch (_err) {
        previousLogs = "";
      }
    }
  }

  return {
    namespace,
    selectedPod: fallbackPod,
    selectedContainer,
    pods,
    metrics,
    logs: trimEvidence(logs),
    podStatus,
    events,
    previousLogs: trimEvidence(previousLogs)
  };
}

function buildInspectPrompts({ evidence, priorAttempt }) {
  const systemPrompt = [
    "You are a Kubernetes incident response assistant.",
    'Return ONLY a JSON object with exactly two fields: {"command": string, "explanation": string}. No markdown.',
    "command: exactly one kubectl command, the single most useful next step. Prefer a remediation over a diagnostic when the evidence supports one.",
    "Always include the namespace explicitly using -n <namespace>. No chaining (;, &&, ||) and no pipes.",
    "Use only these command forms:",
    "kubectl get ... -n <namespace>",
    "kubectl describe ... -n <namespace>",
    "kubectl logs ... -n <namespace>",
    "kubectl rollout restart deployment/<name> -n <namespace>",
    "kubectl set env deployment/<name> KEY=VALUE -n <namespace>",
    "kubectl scale deployment/<name> --replicas=<n> -n <namespace>",
    "kubectl set resources deployment/<name> -c <container> --limits=memory=<n>Mi -n <namespace>",
    "Use evidence.podStatus first: container lastTermination reason and exitCode, restartCount, resources.limits, env, and evidence.events. Use evidence.previousLogs for what happened just before the last crash.",
    "For deployment commands, use the deployment name from evidence.podStatus.owner.name, never the pod name.",
    "If a container's lastTermination or currentState reason is OOMKilled (exit code 137), the explanation must say the container was OOMKilled because it exceeded its memory limit, citing the current limit, and the command must raise that container's memory limit with kubectl set resources. Choose a new limit of at least double the current limit and above any memory target visible in env or logs.",
    "explanation: at most two short sentences (under 40 words) stating what is wrong and why this command addresses it.",
    "If priorAttempt includes the output of a previous command, treat it as additional evidence and do not repeat that command; propose the next step.",
    "If priorAttempt indicates the previous command failed, return a materially different command."
  ].join(" ");

  const userPayload = {
    task: "Diagnose likely issue and suggest safe next commands.",
    priorAttempt: priorAttempt || null,
    evidence
  };

  return {
    systemPrompt,
    userPrompt: JSON.stringify(userPayload, null, 2)
  };
}

function buildProviderUnavailableFallback({ namespace, selectedPod, evidence, cause }) {
  const targetPod = resolvePodName(selectedPod, evidence?.pods || []) || "unknown-pod";

  return {
    namespace,
    selectedPod: targetPod,
    command: `kubectl describe pod ${targetPod} -n ${namespace}`,
    explanation:
      "AI provider is unavailable, so no diagnosis was generated. Pod events and the last termination reason usually show the immediate cause.",
    degraded_mode: true,
    degraded_reason: normalizeProviderErrorMessage(cause)
  };
}

async function callOpenAIInspect({ systemPrompt, userPrompt }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on backend.");
  }

  const model = process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
  let response;
  try {
    response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "inspect_command", strict: true, schema: INSPECT_RESPONSE_JSON_SCHEMA }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: AI_HTTP_TIMEOUT_MS
      }
    );
  } catch (err) {
    if (err.code === "ECONNABORTED") {
      const timeoutErr = makeTransientProviderError(
        `OpenAI request timed out after ${AI_HTTP_TIMEOUT_MS}ms. Retry Inspect or increase AI_HTTP_TIMEOUT_MS in backend/.env.`
      );
      timeoutErr.code = "ECONNABORTED";
      throw timeoutErr;
    }
    if (err.response?.status === 429) {
      throw makeTransientProviderError(
        "OpenAI rate limit reached (429). Please wait a moment or check your OpenAI billing/quota, then retry Inspect.",
        "OPENAI_RATE_LIMIT"
      );
    }
    throw err;
  }

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response did not include content.");
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_err) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("OpenAI response was not valid JSON.");
    }
    parsed = JSON.parse(jsonMatch[0]);
  }
  return inspectResponseSchema.parse(parsed);
}

async function callGeminiInspect({ systemPrompt, userPrompt }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on backend.");
  }

  const configuredModel = normalizeGeminiModelName(process.env.GEMINI_MODEL || "gemini-3.7-flash");
  const candidateModels = Array.from(
    new Set([
      configuredModel,
      "gemini-3.7-flash",
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
      "gemini-3.8-flash",
      "gemini-3.8-pro",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ])
  );

  const ai = await getGoogleGenAI(apiKey);
  let lastUnavailableModel = "";
  const probeResults = [];
  for (const model of candidateModels) {
    try {
      const mergedInput = [
        "You are a Kubernetes incident response assistant.",
        "Return ONLY valid JSON (no markdown).",
        systemPrompt,
        "",
        userPrompt
      ].join("\n");
      const interaction = await withTimeout(
        () =>
          ai.interactions.create({
            model,
            input: mergedInput,
            response_format: { type: "text", mime_type: "application/json", schema: INSPECT_RESPONSE_JSON_SCHEMA }
          }),
        AI_HTTP_TIMEOUT_MS,
        `Gemini request timed out after ${AI_HTTP_TIMEOUT_MS}ms. Retry Inspect or increase AI_HTTP_TIMEOUT_MS in backend/.env.`
      );

      const content = interaction?.output_text;
      if (!content) {
        throw new Error("Gemini response did not include output_text.");
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (_err) {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("Gemini response was not valid JSON.");
        }
        parsed = JSON.parse(jsonMatch[0]);
      }
      return inspectResponseSchema.parse(parsed);
    } catch (err) {
      const status = err?.status || err?.statusCode || err?.response?.status;
      const message = String(err?.message || "").toLowerCase();

      if (err.code === "ECONNABORTED" || message.includes("timed out") || message.includes("deadline")) {
        probeResults.push(`${model}:timeout`);
        lastUnavailableModel = model;
        continue;
      }

      if (status === 404 || message.includes("not found")) {
        probeResults.push(`${model}:404`);
        lastUnavailableModel = model;
        continue;
      }
      if (message.includes("did not include output_text")) {
        probeResults.push(`${model}:empty-output`);
        lastUnavailableModel = model;
        continue;
      }
      if (message.includes("not valid json")) {
        probeResults.push(`${model}:non-json`);
        lastUnavailableModel = model;
        continue;
      }
      if (Number.isInteger(status) && status >= 500 && status <= 599) {
        probeResults.push(`${model}:${status}`);
        lastUnavailableModel = model;
        continue;
      }
      if (status === 400 || status === 401 || status === 403) {
        probeResults.push(`${model}:${status}`);
        lastUnavailableModel = model;
        continue;
      }
      if (status === 429) {
        throw makeTransientProviderError(
          "Gemini rate limit reached (429). Please wait a moment or check your Gemini quota, then retry Inspect.",
          "GEMINI_RATE_LIMIT"
        );
      }
      if (Number.isInteger(status)) {
        probeResults.push(`${model}:${status}`);
      } else {
        probeResults.push(`${model}:${err.code || "error"}`);
      }
      throw err;
    }
  }

  const probeSummary = probeResults.length > 0 ? ` Probe results: ${probeResults.join(", ")}.` : "";
  throw makeTransientProviderError(
    `Gemini model '${lastUnavailableModel || configuredModel}' was unavailable (404/5xx/timeout), and fallback models were not usable for this key. Set GEMINI_MODEL in backend/.env to a model available in your account.${probeSummary}`,
    "GEMINI_MODELS_UNAVAILABLE"
  );
}

async function callLLMInspect(prompts) {
  if (process.env.OPENAI_API_KEY) {
    return callOpenAIInspect(prompts);
  }
  if (process.env.GEMINI_API_KEY) {
    return callGeminiInspect(prompts);
  }
  throw new Error("No LLM key found. Set OPENAI_API_KEY or GEMINI_API_KEY in backend/.env.");
}

async function inspectIncident({ namespace, selectedPod, tail: _tail, priorAttempt }) {
  const evidence = await collectIncidentEvidence({
    namespace,
    selectedPod,
    tail: INSPECT_TAIL_LINES
  });
  const compactEvidence = {
    namespace: evidence.namespace,
    selectedPod: evidence.selectedPod,
    podStatus: evidence.podStatus,
    events: evidence.events,
    metrics: (evidence.metrics || []).filter((metric) => metric.pod === evidence.selectedPod),
    logs: evidence.logs,
    previousLogs: evidence.previousLogs
  };
  const prompts = buildInspectPrompts({ evidence: compactEvidence, priorAttempt });
  let ai;
  try {
    ai = await callLLMInspect(prompts);
  } catch (err) {
    if (isTransientProviderFailure(err)) {
      return buildProviderUnavailableFallback({
        namespace,
        selectedPod: evidence.selectedPod,
        evidence,
        cause: err?.message || "Transient provider failure"
      });
    }
    throw err;
  }

  return {
    namespace,
    selectedPod: evidence.selectedPod,
    command: ai.command,
    explanation: ai.explanation
  };
}

// Only memory/CPU requests and limits on a deployment, optionally for one container.
function isAllowedSetResources(command) {
  const match = /^kubectl\s+set\s+resources\s+deployment\/[a-z0-9-]+((?:\s+\S+)+)$/i.exec(command);
  if (!match) return false;
  const tokens = match[1].trim().split(/\s+/);
  const quantity = "\\d+(?:Mi|Gi|m)?";
  const resourceFlag = new RegExp(
    `^--(limits|requests)=(memory|cpu)=${quantity}(,(memory|cpu)=${quantity})?$`
  );
  let hasLimitOrRequest = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "-c" || token === "-n" || token === "--namespace") {
      if (!/^[a-z0-9-]+$/.test(tokens[i + 1] || "")) return false;
      i += 1;
    } else if (/^--containers=[a-z0-9-]+$/.test(token)) {
      continue;
    } else if (resourceFlag.test(token)) {
      hasLimitOrRequest = true;
    } else {
      return false;
    }
  }
  return hasLimitOrRequest;
}

function validateCommandForExecution(command, namespace) {
  const trimmed = String(command || "").trim();
  const namespaceScoped =
    trimmed.includes(` -n ${namespace}`) || trimmed.includes(` --namespace ${namespace}`);

  const explicitlyForbidden =
    /\b(delete|drain|cordon|uncordon|replace|apply\s+-f\s+https?:\/\/|proxy)\b/i.test(trimmed) ||
    /;\s*|\|\||&&/.test(trimmed);

  if (explicitlyForbidden) {
    return { allowed: false, reason: "Command contains forbidden operations or chaining." };
  }
  if (!trimmed.startsWith("kubectl ")) {
    return { allowed: false, reason: "Only kubectl commands are allowed." };
  }
  if (!namespaceScoped) {
    return { allowed: false, reason: "Command must be scoped to the selected namespace." };
  }

  const allowedFamily =
    /^kubectl\s+get\s+/i.test(trimmed) ||
    /^kubectl\s+describe\s+/i.test(trimmed) ||
    /^kubectl\s+logs\s+/i.test(trimmed) ||
    /^kubectl\s+rollout\s+restart\s+deployment\/[a-z0-9-]+/i.test(trimmed) ||
    /^kubectl\s+set\s+env\s+deployment\/[a-z0-9-]+\s+/i.test(trimmed) ||
    /^kubectl\s+scale\s+deployment\/[a-z0-9-]+\s+--replicas=\d+/i.test(trimmed) ||
    isAllowedSetResources(trimmed);

  if (allowedFamily) {
    return { allowed: true };
  }
  return { allowed: false, reason: "Command is outside the execution allowlist." };
}

async function executeApprovedCommands({ namespace, commands }) {
  const results = [];

  for (const item of commands) {
    const command = String(item.command || "");
    const validation = validateCommandForExecution(command, namespace);
    if (!validation.allowed) {
      results.push({
        id: item.id,
        command,
        status: "blocked",
        reason: validation.reason,
        stdout: "",
        stderr: ""
      });
      continue;
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 20000,
        maxBuffer: 1024 * 1024
      });
      results.push({
        id: item.id,
        command,
        status: "success",
        stdout: trimEvidence(stdout, 3000),
        stderr: trimEvidence(stderr, 3000)
      });
    } catch (err) {
      results.push({
        id: item.id,
        command,
        status: "failed",
        stdout: trimEvidence(err.stdout || "", 3000),
        stderr: trimEvidence(err.stderr || err.message || "", 3000)
      });
    }
  }

  return {
    namespace,
    results
  };
}

module.exports = {
  inspectIncident,
  executeApprovedCommands
};

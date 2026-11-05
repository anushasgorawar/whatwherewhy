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
  one_liner_reason: z.string().min(1),
  details: z.array(z.string()).default([]),
  confidence_score: z.number().min(0).max(100).optional().nullable(),
  commands: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        command: z.string().min(1),
        rationale: z.string().min(1),
        risk: z.enum(["low", "medium", "high"]).default("low"),
        requires_manual: z.boolean().default(false)
      })
    )
    .default([]),
  manual_action_required: z.boolean().default(false),
  manual_action_message: z.string().default(""),
  risk_level: z.enum(["low", "medium", "high"]).default("low")
});

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

async function fetchPodLogs(namespace, pod, container, tail = DEFAULT_TAIL) {
  const { log } = getClients();
  const stream = new PassThrough();

  await log.log(namespace, pod, container, stream, {
    follow: false,
    pretty: false,
    timestamps: true,
    tailLines: tail
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

  return {
    namespace,
    selectedPod: fallbackPod,
    selectedContainer,
    pods,
    metrics,
    logs: trimEvidence(logs)
  };
}

function buildInspectPrompts({ evidence, priorAttempt }) {
  const systemPrompt = [
    "You are a Kubernetes incident response assistant.",
    "Return ONLY valid JSON. No markdown.",
    "Focus on namespace-scoped commands only.",
    "Use safe kubectl commands and include namespace explicitly using -n <namespace> or --namespace <namespace>.",
    "Provide at least one executable remediation command unless manual_action_required=true.",
    "Provide confidence_score as a number from 0 to 100 based only on the evidence quality and consistency.",
    "Prefer this command set only:",
    "kubectl get ... -n <namespace>",
    "kubectl describe ... -n <namespace>",
    "kubectl logs ... -n <namespace>",
    "kubectl rollout restart deployment/<name> -n <namespace>",
    "kubectl set env deployment/<name> KEY=VALUE -n <namespace>",
    "kubectl scale deployment/<name> --replicas=<n> -n <namespace>",
    "If priorAttempt indicates the previous solution failed, provide materially different next steps.",
    "Keep one_liner_reason concise and actionable."
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
  const normalizedCause = normalizeProviderErrorMessage(cause);
  const details = [
    `AI provider is temporarily unavailable: ${normalizedCause}`,
    `Continue diagnosis from recent pod evidence for '${targetPod}' in namespace '${namespace}'.`,
    "Use the suggested low-risk diagnostics below, then retry Inspect."
  ];

  return {
    namespace,
    selectedPod: targetPod,
    evidence_summary: {
      pod_count: evidence?.pods?.length || 0,
      metric_rows: evidence?.metrics?.length || 0
    },
    one_liner_reason: "AI provider unavailable; proceed with manual, evidence-first diagnostics.",
    details,
    confidence_score: null,
    commands: [
      {
        id: "fallback-describe",
        title: "Inspect pod events and failure reasons",
        command: `kubectl describe pod ${targetPod} -n ${namespace}`,
        rationale: "Describe output usually reveals immediate scheduling, image, probe, or restart causes.",
        risk: "low",
        requires_manual: false
      },
      {
        id: "fallback-logs",
        title: "Fetch recent logs for the selected pod",
        command: `kubectl logs ${targetPod} -n ${namespace} --tail=100`,
        rationale: "Recent logs provide direct error context while AI service is unavailable.",
        risk: "low",
        requires_manual: false
      }
    ],
    manual_action_required: false,
    manual_action_message: "",
    risk_level: "medium",
    degraded_mode: true
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
        response_format: { type: "json_object" }
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
            input: mergedInput
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
    metrics: (evidence.metrics || []).filter((metric) => metric.pod === evidence.selectedPod),
    logs: evidence.logs
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

  const reason = String(ai.one_liner_reason || "").toLowerCase();
  const looksHealthy =
    reason.includes("healthy") ||
    reason.includes("stable") ||
    reason.includes("no issue") ||
    reason.includes("normal operation");

  if (looksHealthy) {
    ai.manual_action_required = false;
    ai.manual_action_message = "";
    ai.risk_level = "low";
  }

  if (!looksHealthy && !ai.manual_action_required && (!ai.commands || ai.commands.length === 0)) {
    const targetPod = evidence.selectedPod || evidence.pods[0]?.name || "unknown-pod";
    ai.commands = [
      {
        id: "fallback-describe",
        title: "Inspect pod events and failure reasons",
        command: `kubectl describe pod ${targetPod} -n ${namespace}`,
        rationale: "No executable fix command was returned; start with explicit pod diagnostics.",
        risk: "low",
        requires_manual: false
      }
    ];
  }
  return {
    namespace,
    selectedPod: evidence.selectedPod,
    evidence_summary: {
      pod_count: evidence.pods.length,
      metric_rows: evidence.metrics.length
    },
    ...ai
  };
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
    /^kubectl\s+scale\s+deployment\/[a-z0-9-]+\s+--replicas=\d+/i.test(trimmed);

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

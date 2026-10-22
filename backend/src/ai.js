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

const inspectResponseSchema = z.object({
  one_liner_reason: z.string().min(1),
  details: z.array(z.string()).default([]),
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

  const fallbackPod = selectedPod || pods[0]?.name || "";
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
        timeout: 25000
      }
    );
  } catch (err) {
    if (err.response?.status === 429) {
      throw new Error(
        "OpenAI rate limit reached (429). Please wait a moment or check your OpenAI billing/quota, then retry Inspect."
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

  const configuredModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const candidateModels = Array.from(
    new Set([configuredModel, "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"])
  );

  let last404Model = "";
  for (const model of candidateModels) {
    let response;
    try {
      response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 25000
        }
      );
    } catch (err) {
      if (err.response?.status === 404) {
        last404Model = model;
        continue;
      }
      if (err.response?.status === 429) {
        throw new Error(
          "Gemini rate limit reached (429). Please wait a moment or check your Gemini quota, then retry Inspect."
        );
      }
      throw err;
    }

    const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error("Gemini response did not include content.");
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
  }

  throw new Error(
    `Gemini model '${last404Model || configuredModel}' was not found (404), and fallback models were unavailable for this key. Set GEMINI_MODEL in backend/.env to a model available in your account.`
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
  const ai = await callLLMInspect(prompts);

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

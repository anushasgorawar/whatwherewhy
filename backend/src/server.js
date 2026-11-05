const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { z } = require("zod");
const { PassThrough } = require("stream");
const { fetchPodMetricsFromMetricsServer } = require("./metrics-server");
const { inspectIncident, executeApprovedCommands } = require("./ai");
const { getClients, summarizePod } = require("./k8s");

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(morgan("combined"));
app.use("/assets/fonts", express.static(path.resolve(__dirname, "../exwayer")));

const namespaceSchema = z.object({
  namespace: z.string().min(1).max(63).default("default")
});

const logsSchema = z.object({
  namespace: z.string().min(1).max(63),
  pod: z.string().min(1),
  container: z.string().optional(),
  tail: z.coerce.number().int().min(10).max(1000).default(20)
});

const aiInspectSchema = z.object({
  namespace: z.string().min(1).max(63),
  selectedPod: z.string().min(1).optional(),
  tail: z.coerce.number().int().min(10).max(1000).default(20),
  priorAttempt: z
    .object({
      previousReason: z.string().optional(),
      previousCommands: z.array(z.string()).optional(),
      feedback: z.string().optional()
    })
    .optional()
});

const aiExecuteSchema = z.object({
  namespace: z.string().min(1).max(63),
  commands: z
    .array(
      z.object({
        id: z.string().min(1),
        command: z.string().min(1)
      })
    )
    .min(1)
});

function podHasIssues(pod) {
  const phase = pod?.status?.phase || "Unknown";
  if (phase === "Succeeded") return false;
  if (phase !== "Running") return true;

  const readyCondition = (pod?.status?.conditions || []).find((c) => c.type === "Ready");
  if (!readyCondition || readyCondition.status !== "True") return true;

  const containerStatuses = pod?.status?.containerStatuses || [];
  if (containerStatuses.length === 0) return true;

  for (const status of containerStatuses) {
    const waitingReason = status?.state?.waiting?.reason || "";
    const terminatedReason = status?.state?.terminated?.reason || "";
    const reasons = [waitingReason, terminatedReason].filter(Boolean);

    if (
      reasons.some((reason) =>
        [
          "CrashLoopBackOff",
          "ImagePullBackOff",
          "ErrImagePull",
          "CreateContainerConfigError",
          "CreateContainerError",
          "RunContainerError",
          "OOMKilled",
          "Error"
        ].includes(reason)
      )
    ) {
      return true;
    }
  }

  return false;
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/cluster/status", async (_req, res) => {
  try {
    const { core } = getClients();
    const list = await core.listNamespace();
    res.json({
      connected: true,
      namespaceCount: (list.items || []).length,
      checkedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      connected: false,
      checkedAt: new Date().toISOString(),
      error: err.message || "Cluster connection check failed."
    });
  }
});

app.get("/api/namespaces", async (_req, res) => {
  try {
    const { core } = getClients();
    const list = await core.listNamespace();
    const namespaces = (list.items || [])
      .map((item) => item.metadata?.name)
      .filter(Boolean)
      .sort();
    res.json({ namespaces });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch namespaces" });
  }
});

app.get("/api/pods", async (req, res) => {
  try {
    const { namespace } = namespaceSchema.parse(req.query);
    const { core } = getClients();
    const list = await core.listNamespacedPod({ namespace });
    const pods = (list.items || []).map(summarizePod);
    res.json({ namespace, pods });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch pods" });
  }
});

app.get("/api/logs", async (req, res) => {
  try {
    const { namespace, pod, container, tail } = logsSchema.parse(req.query);
    const { log } = getClients();
    const stream = new PassThrough();

    await log.log(
      namespace,
      pod,
      container,
      stream,
      {
        follow: false,
        pretty: false,
        timestamps: true,
        tailLines: tail
      }
    );

    let data = "";
    stream.on("data", (chunk) => {
      data += chunk.toString("utf8");
    });

    stream.on("end", () => {
      res.json({
        namespace,
        pod,
        container: container || null,
        tail,
        logs: data
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch logs" });
  }
});

app.get("/api/metrics/pods", async (req, res) => {
  try {
    const { namespace } = namespaceSchema.parse(req.query);
    const metrics = await fetchPodMetricsFromMetricsServer(namespace);
    res.json({
      namespace,
      source: "metrics-server",
      metrics
    });
  } catch (err) {
    res.status(500).json({
      error:
        err.message ||
        "Failed to fetch pod metrics from metrics-server (metrics.k8s.io/v1beta1)."
    });
  }
});

app.get("/api/metrics/namespaces-summary", async (_req, res) => {
  try {
    const { core } = getClients();
    const list = await core.listNamespace();
    const namespaces = (list.items || [])
      .map((item) => item.metadata?.name)
      .filter(Boolean)
      .sort();

    const perNamespace = [];
    for (const ns of namespaces) {
      try {
        const metrics = await fetchPodMetricsFromMetricsServer(ns);
        const totalCpuCores = metrics.reduce((sum, metric) => sum + Number(metric.cpuCores || 0), 0);
        const totalMemoryMiB = metrics.reduce((sum, metric) => sum + Number(metric.memoryMiB || 0), 0);
        perNamespace.push({
          namespace: ns,
          cpuCores: totalCpuCores.toFixed(4),
          memoryMiB: totalMemoryMiB.toFixed(2),
          metricRows: metrics.length
        });
      } catch (_err) {
        perNamespace.push({
          namespace: ns,
          cpuCores: "0.0000",
          memoryMiB: "0.00",
          metricRows: 0
        });
      }
    }

    const totalCpuCores = perNamespace
      .reduce((sum, item) => sum + Number(item.cpuCores || 0), 0)
      .toFixed(4);
    const totalMemoryMiB = perNamespace
      .reduce((sum, item) => sum + Number(item.memoryMiB || 0), 0)
      .toFixed(2);

    res.json({
      source: "metrics-server",
      totalCpuCores,
      totalMemoryMiB,
      namespaces: perNamespace
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Failed to fetch namespace metrics summary from metrics-server."
    });
  }
});

app.get("/api/dashboard/summary", async (req, res) => {
  try {
    const { namespace } = namespaceSchema.parse(req.query);
    const { core } = getClients();
    const list = await core.listNamespacedPod({ namespace });
    const pods = (list.items || []).map(summarizePod);

    let metrics = [];
    let metricsAvailable = true;
    try {
      metrics = await fetchPodMetricsFromMetricsServer(namespace);
    } catch (_err) {
      metricsAvailable = false;
      metrics = [];
    }

    const rawPods = list.items || [];
    const runningPods = pods.filter((pod) => pod.phase === "Running").length;
    const needsAttentionPodItems = rawPods.filter((pod) => podHasIssues(pod));
    const needsAttentionPodNames = needsAttentionPodItems
      .map((pod) => pod?.metadata?.name)
      .filter(Boolean);
    const needsAttentionPods = needsAttentionPodNames.length;

    const thresholdRaw = process.env.CPU_ALERT_CORES;
    const threshold = Number(thresholdRaw);
    const hasThreshold = Number.isFinite(threshold) && threshold > 0;

    const highCpuMetricRows = hasThreshold
      ? metrics.filter((metric) => Number(metric.cpuCores || 0) >= threshold)
      : [];
    const highCpuContainers = hasThreshold ? highCpuMetricRows.length : null;
    const highCpuPodNames = hasThreshold
      ? Array.from(new Set(highCpuMetricRows.map((row) => row.pod).filter(Boolean)))
      : [];

    res.json({
      namespace,
      runningPods,
      needsAttentionPods,
      needsAttentionPodNames,
      highCpuContainers,
      highCpuPodNames,
      highCpuThresholdCores: hasThreshold ? threshold : null,
      metricsAvailable,
      metricRows: metrics.length
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Failed to compute dashboard summary."
    });
  }
});

app.post("/api/ai/inspect", async (req, res) => {
  try {
    const { namespace, selectedPod, tail, priorAttempt } = aiInspectSchema.parse(req.body || {});
    const result = await inspectIncident({
      namespace,
      selectedPod,
      tail,
      priorAttempt
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to run AI inspect." });
  }
});

app.post("/api/ai/execute", async (req, res) => {
  try {
    const { namespace, commands } = aiExecuteSchema.parse(req.body || {});
    const result = await executeApprovedCommands({ namespace, commands });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to execute approved commands." });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`pod-observer backend listening on port ${port}`);
});

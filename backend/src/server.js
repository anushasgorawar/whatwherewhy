const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { z } = require("zod");
const { PassThrough } = require("stream");
const { fetchPodMetricsFromMetricsServer } = require("./metrics-server");
const { getClients, summarizePod } = require("./k8s");

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(morgan("combined"));

const namespaceSchema = z.object({
  namespace: z.string().min(1).max(63).default("default")
});

const logsSchema = z.object({
  namespace: z.string().min(1).max(63),
  pod: z.string().min(1),
  container: z.string().optional(),
  tail: z.coerce.number().int().min(10).max(1000).default(200)
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
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

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`pod-observer backend listening on port ${port}`);
});

import { useEffect, useMemo, useState } from "react";
import { fetchLogs, fetchNamespaces, fetchPodMetrics, fetchPods } from "./api";

const PODS_AND_METRICS_POLL_MS = 5000;
const LOGS_POLL_MS = 5000;

export default function App() {
  const [namespace, setNamespace] = useState("default");
  const [namespaces, setNamespaces] = useState([]);
  const [pods, setPods] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [selectedPod, setSelectedPod] = useState("");
  const [tail, setTail] = useState(200);
  const [logs, setLogs] = useState("");
  const [loadingNamespaces, setLoadingNamespaces] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsPollingEnabled, setLogsPollingEnabled] = useState(true);
  const [error, setError] = useState("");
  const [metricsSource, setMetricsSource] = useState("");

  const selectedPodObj = useMemo(
    () => pods.find((pod) => pod.name === selectedPod),
    [pods, selectedPod]
  );
  const runningPods = useMemo(
    () => pods.filter((pod) => pod.phase === "Running").length,
    [pods]
  );
  const degradedPods = useMemo(
    () =>
      pods.filter(
        (pod) =>
          pod.phase !== "Running" ||
          Number(pod.restarts || 0) > 0
      ).length,
    [pods]
  );
  const hotMetrics = useMemo(
    () => metrics.filter((metric) => Number(metric.cpuCores || 0) >= 0.15).length,
    [metrics]
  );
  const metricsByPod = useMemo(() => {
    const map = new Map();
    metrics.forEach((metric) => {
      const podName = metric.pod || "unknown";
      const cpuCores = Number(metric.cpuCores || 0);
      const memoryMiB = Number(metric.memoryMiB || 0);
      const current = map.get(podName) || { cpuCores: 0, memoryMiB: 0, containers: 0 };
      current.cpuCores += cpuCores;
      current.memoryMiB += memoryMiB;
      current.containers += 1;
      map.set(podName, current);
    });
    return map;
  }, [metrics]);
  const podsWithMetrics = useMemo(
    () =>
      pods.map((pod) => {
        const podMetrics = metricsByPod.get(pod.name);
        return {
          ...pod,
          cpuCores: podMetrics ? podMetrics.cpuCores.toFixed(4) : null,
          memoryMiB: podMetrics ? podMetrics.memoryMiB.toFixed(2) : null
        };
      }),
    [pods, metricsByPod]
  );
  const metricsEmptyMessage = useMemo(() => {
    if (pods.length === 0) {
      return "No pods found in this namespace yet. Start a simulator or choose another namespace.";
    }
    if (runningPods === 0) {
      return "Pods exist, but none are Running yet. Metrics appear after pods enter Running state.";
    }
    return "No metrics returned yet for currently running pods. Wait a few seconds for the next update cycle.";
  }, [pods.length, runningPods]);

  async function loadNamespaces() {
    setLoadingNamespaces(true);
    setError("");
    try {
      const data = await fetchNamespaces();
      const nextNamespaces = data.namespaces || [];
      setNamespaces(nextNamespaces);
      if (nextNamespaces.includes("simulation") && namespace !== "simulation") {
        setNamespace("simulation");
      } else if (nextNamespaces.length && !nextNamespaces.includes(namespace)) {
        setNamespace(nextNamespaces[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingNamespaces(false);
    }
  }

  async function refreshPods() {
    try {
      const data = await fetchPods(namespace);
      setPods(data.pods || []);
      if (data.pods?.length && !data.pods.find((pod) => pod.name === selectedPod)) {
        setSelectedPod(data.pods[0].name);
      } else if (!data.pods?.length) {
        setSelectedPod("");
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function refreshMetrics() {
    try {
      const data = await fetchPodMetrics(namespace);
      setMetrics(data.metrics || []);
      setMetricsSource(data.source || "metrics-server");
    } catch (err) {
      setMetrics([]);
      setError(err.message || "Metrics request failed.");
      setMetricsSource("unavailable");
    }
  }

  async function refreshLogs(options = {}) {
    const { showLoading = true } = options;
    if (!selectedPod) return;
    if (showLoading) {
      setLoadingLogs(true);
      setError("");
    }
    try {
      const container = selectedPodObj?.containers?.[0] || "";
      const data = await fetchLogs({
        namespace,
        pod: selectedPod,
        container,
        tail
      });
      setLogs(data.logs || "");
    } catch (err) {
      setError(err.message);
    } finally {
      if (showLoading) {
        setLoadingLogs(false);
      }
    }
  }

  useEffect(() => {
    loadNamespaces();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!namespace) return undefined;
    let mounted = true;
    async function tick() {
      if (!mounted) return;
      await Promise.all([refreshPods(), refreshMetrics()]);
    }
    tick();
    const intervalId = setInterval(tick, PODS_AND_METRICS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace]);

  useEffect(() => {
    if (!namespace || !selectedPod || !logsPollingEnabled) return undefined;
    let mounted = true;
    async function tick() {
      if (!mounted) return;
      await refreshLogs({ showLoading: false });
    }
    tick();
    const intervalId = setInterval(tick, LOGS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, selectedPod, tail, logsPollingEnabled]);

  return (
    <div className="page">
      <header className="hero">
        <h1>Kubernetes Incident Console</h1>
      </header>

      <section className="card controls-panel">
        <div className="controls-row">
          <label className="control-label">
            Namespace
            <select
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              disabled={loadingNamespaces || namespaces.length === 0}
            >
              {loadingNamespaces && <option value={namespace}>Loading namespaces...</option>}
              {!loadingNamespaces && namespaces.length === 0 && (
                <option value="">No namespaces available</option>
              )}
              {namespaces.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="summary-row">
          <div className="summary-tile">
            <span className="summary-label">Namespace</span>
            <span className="summary-value">{namespace || "n/a"}</span>
          </div>
          <div className="summary-tile">
            <span className="summary-label">Pods Running</span>
            <span className="summary-value">{runningPods}</span>
          </div>
          <div className="summary-tile">
            <span className="summary-label">Needs Attention</span>
            <span className="summary-value">{degradedPods}</span>
          </div>
          <div className="summary-tile">
            <span className="summary-label">High CPU Containers</span>
            <span className="summary-value">{hotMetrics}</span>
          </div>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Pods + Metrics</h2>
        {metricsSource && (
          <p className="muted">
            Source: <strong>{metricsSource}</strong>
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Restarts</th>
              <th>Age</th>
              <th>Node</th>
              <th>CPU (cores)</th>
              <th>Memory (MiB)</th>
            </tr>
          </thead>
          <tbody>
            {podsWithMetrics.map((pod) => {
              const highCpu = Number(pod.cpuCores || 0) >= 0.15;
              const warn = pod.phase !== "Running" || Number(pod.restarts || 0) > 0 || highCpu;
              return (
                <tr
                  key={pod.name}
                  onClick={() => setSelectedPod(pod.name)}
                  className={`${selectedPod === pod.name ? "selected" : ""} ${warn ? "warn-row" : ""}`}
                >
                  <td>{pod.name}</td>
                  <td>
                    <span className={`phase-chip phase-${String(pod.phase || "").toLowerCase()}`}>
                      {pod.phase}
                    </span>
                  </td>
                  <td>{pod.restarts}</td>
                  <td>{pod.age}</td>
                  <td>{pod.nodeName}</td>
                  <td>{pod.cpuCores ?? "n/a"}</td>
                  <td>{pod.memoryMiB ?? "n/a"}</td>
                </tr>
              );
            })}
            {pods.length === 0 && (
              <tr>
                <td colSpan="7">No pods found.</td>
              </tr>
            )}
          </tbody>
        </table>
        {metrics.length === 0 && <p className="muted">{metricsEmptyMessage}</p>}
      </section>

      <section className="card">
        <h2>Logs</h2>
        <p className="muted">
          Polling: <strong>{logsPollingEnabled ? `on (${LOGS_POLL_MS / 1000}s)` : "stopped"}</strong>
        </p>
        <div className="controls-row">
          <label className="control-label">
            Pod
            <select value={selectedPod} onChange={(e) => setSelectedPod(e.target.value)}>
              {pods.map((pod) => (
                <option key={pod.name} value={pod.name}>
                  {pod.name}
                </option>
              ))}
            </select>
          </label>
          <label className="control-label">
            Tail lines
            <input
              type="number"
              min="10"
              max="1000"
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
            />
          </label>
          <button
            onClick={async () => {
              setLogsPollingEnabled(true);
              await refreshLogs();
            }}
            disabled={loadingLogs || !selectedPod}
          >
            {loadingLogs ? "Fetching logs..." : "Refresh Logs"}
          </button>
          <button
            onClick={() => setLogsPollingEnabled(false)}
            disabled={!logsPollingEnabled || !selectedPod}
          >
            Stop Logs
          </button>
        </div>
        <pre>{logs || "Select a pod to stream log output."}</pre>
      </section>
    </div>
  );
}

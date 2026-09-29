import { useEffect, useMemo, useState } from "react";
import { fetchLogs, fetchPodMetrics, fetchPods } from "./api";

export default function App() {
  const [namespace, setNamespace] = useState("default");
  const [pods, setPods] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [selectedPod, setSelectedPod] = useState("");
  const [tail, setTail] = useState(200);
  const [logs, setLogs] = useState("");
  const [loadingPods, setLoadingPods] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [error, setError] = useState("");
  const [metricsSource, setMetricsSource] = useState("");

  const selectedPodObj = useMemo(
    () => pods.find((pod) => pod.name === selectedPod),
    [pods, selectedPod]
  );

  async function refreshPods() {
    setLoadingPods(true);
    setError("");
    try {
      const data = await fetchPods(namespace);
      setPods(data.pods || []);
      if (data.pods?.length && !data.pods.find((pod) => pod.name === selectedPod)) {
        setSelectedPod(data.pods[0].name);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPods(false);
    }
  }

  async function refreshMetrics() {
    setLoadingMetrics(true);
    setError("");
    try {
      const data = await fetchPodMetrics(namespace);
      setMetrics(data.metrics || []);
      setMetricsSource(data.source || "metrics-server");
    } catch (err) {
      setMetrics([]);
      setError(err.message || "Metrics request failed.");
      setMetricsSource("unavailable");
    } finally {
      setLoadingMetrics(false);
    }
  }

  async function refreshLogs() {
    if (!selectedPod) return;
    setLoadingLogs(true);
    setError("");
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
      setLoadingLogs(false);
    }
  }

  useEffect(() => {
    refreshPods();
    refreshMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace]);

  return (
    <div className="page">
      <header>
        <h1>Local Kubernetes Pod Health</h1>
        <p>Inspect running pods, fetch fresh logs, and review basic metrics.</p>
      </header>

      <section className="controls">
        <label>
          Namespace:
          <input value={namespace} onChange={(e) => setNamespace(e.target.value)} />
        </label>
        <button onClick={refreshPods} disabled={loadingPods}>
          {loadingPods ? "Refreshing pods..." : "Refresh Pods"}
        </button>
        <button onClick={refreshMetrics} disabled={loadingMetrics}>
          {loadingMetrics ? "Refreshing metrics..." : "Refresh Metrics"}
        </button>
      </section>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Pods</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Restarts</th>
              <th>Age</th>
              <th>Node</th>
            </tr>
          </thead>
          <tbody>
            {pods.map((pod) => (
              <tr
                key={pod.name}
                onClick={() => setSelectedPod(pod.name)}
                className={selectedPod === pod.name ? "selected" : ""}
              >
                <td>{pod.name}</td>
                <td>{pod.phase}</td>
                <td>{pod.restarts}</td>
                <td>{pod.age}</td>
                <td>{pod.nodeName}</td>
              </tr>
            ))}
            {pods.length === 0 && (
              <tr>
                <td colSpan="5">No pods found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Logs</h2>
        <div className="controls">
          <label>
            Pod:
            <select value={selectedPod} onChange={(e) => setSelectedPod(e.target.value)}>
              {pods.map((pod) => (
                <option key={pod.name} value={pod.name}>
                  {pod.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tail lines:
            <input
              type="number"
              min="10"
              max="1000"
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
            />
          </label>
          <button onClick={refreshLogs} disabled={loadingLogs || !selectedPod}>
            {loadingLogs ? "Fetching logs..." : "Refresh Logs"}
          </button>
        </div>
        <pre>{logs || "Select a pod and click Refresh Logs."}</pre>
      </section>

      <section>
        <h2>Pod Metrics (metrics-server)</h2>
        {metricsSource && (
          <p>
            Source: <strong>{metricsSource}</strong>
          </p>
        )}
        {metrics.length === 0 ? (
          <p>No real metrics available yet. Ensure metrics-server is healthy.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Pod</th>
                <th>Container</th>
                <th>CPU (cores)</th>
                <th>Memory (MiB)</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={`${metric.pod}-${metric.container}`}>
                  <td>{metric.pod}</td>
                  <td>{metric.container}</td>
                  <td>{metric.cpuCores}</td>
                  <td>{metric.memoryMiB}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

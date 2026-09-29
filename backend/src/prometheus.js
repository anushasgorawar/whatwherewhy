const axios = require("axios");

const PROMETHEUS_URL =
  process.env.PROMETHEUS_URL || "http://prometheus.monitoring.svc.cluster.local:9090";

async function queryPrometheus(promQl) {
  const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
    params: { query: promQl },
    timeout: 6000
  });
  return response.data?.data?.result || [];
}

function mapCpuMetrics(result) {
  return result.map((item) => ({
    pod: item.metric?.pod || "unknown",
    container: item.metric?.container || "unknown",
    cpuCores: Number(item.value?.[1] || 0).toFixed(4),
    phase: "unknown",
    source: "cpu"
  }));
}

function mapFallbackPhaseMetrics(result) {
  return result
    .filter((item) => String(item.value?.[1]) === "1")
    .map((item) => ({
      pod: item.metric?.pod || "unknown",
      container: "-",
      cpuCores: "n/a",
      phase: item.metric?.phase || "unknown",
      source: "kube-state-metrics"
    }));
}

async function fetchPodMetrics(namespace) {
  const cpuQuery = `sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}",container!="",pod!=""}[5m])) by (pod,container)`;
  const cpuResult = await queryPrometheus(cpuQuery);

  if (cpuResult.length > 0) {
    return {
      source: "cpu",
      metrics: mapCpuMetrics(cpuResult),
      warning: null
    };
  }

  const phaseQuery = `max(kube_pod_status_phase{namespace="${namespace}"}) by (pod,phase)`;
  const phaseResult = await queryPrometheus(phaseQuery);
  return {
    source: "kube-state-metrics",
    metrics: mapFallbackPhaseMetrics(phaseResult),
    warning:
      "CPU usage series is unavailable in Prometheus; showing pod phase fallback from kube-state-metrics."
  };
}

module.exports = {
  fetchPodMetrics
};

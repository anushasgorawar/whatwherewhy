const { getClients } = require("./k8s");

function cpuToCores(cpu) {
  if (!cpu) return 0;
  if (cpu.endsWith("n")) return Number(cpu.slice(0, -1)) / 1e9;
  if (cpu.endsWith("u")) return Number(cpu.slice(0, -1)) / 1e6;
  if (cpu.endsWith("m")) return Number(cpu.slice(0, -1)) / 1000;
  return Number(cpu);
}

function memoryToMiB(memory) {
  if (!memory) return 0;
  const units = {
    Ki: 1 / 1024,
    Mi: 1,
    Gi: 1024,
    Ti: 1024 * 1024,
    K: 1 / (1000 * 1024 / 1024),
    M: 1000 / 1024,
    G: 1000 * 1000 / 1024
  };
  const match = String(memory).match(/^([0-9.]+)([A-Za-z]+)?$/);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2] || "";
  if (unit in units) return value * units[unit];
  return value / (1024 * 1024);
}

async function fetchPodMetricsFromMetricsServer(namespace) {
  const { customObjects } = getClients();
  const response = await customObjects.listNamespacedCustomObject({
    group: "metrics.k8s.io",
    version: "v1beta1",
    namespace,
    plural: "pods"
  });

  const items = response.items || [];
  return items.flatMap((podMetrics) => {
    const podName = podMetrics.metadata?.name || "unknown";
    const containers = podMetrics.containers || [];
    return containers.map((container) => {
      const cpuRaw = container.usage?.cpu || "0";
      const memoryRaw = container.usage?.memory || "0";
      return {
        pod: podName,
        container: container.name || "unknown",
        cpuCores: cpuToCores(cpuRaw).toFixed(4),
        memoryMiB: memoryToMiB(memoryRaw).toFixed(2)
      };
    });
  });
}

module.exports = {
  fetchPodMetricsFromMetricsServer
};

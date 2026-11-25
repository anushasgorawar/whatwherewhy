const k8s = require("@kubernetes/client-node");

function getClients() {
  const kc = new k8s.KubeConfig();

  const inCluster =
    Boolean(process.env.KUBERNETES_SERVICE_HOST) &&
    Boolean(process.env.KUBERNETES_SERVICE_PORT);

  if (inCluster) {
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }

  return {
    core: kc.makeApiClient(k8s.CoreV1Api),
    apps: kc.makeApiClient(k8s.AppsV1Api),
    log: new k8s.Log(kc),
    customObjects: kc.makeApiClient(k8s.CustomObjectsApi)
  };
}

function toAge(creationTimestamp) {
  if (!creationTimestamp) return "unknown";
  const created = new Date(creationTimestamp).getTime();
  const diffMs = Date.now() - created;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d`;
}

// Mirrors the STATUS column of `kubectl get pods`: container waiting/terminated
// reasons (e.g. CrashLoopBackOff, OOMKilled) override the coarse pod phase.
function podDisplayStatus(item) {
  if (item.metadata?.deletionTimestamp) return "Terminating";

  for (const s of item.status?.initContainerStatuses || []) {
    const terminated = s.state?.terminated;
    if (terminated && terminated.exitCode === 0) continue;
    if (terminated) return `Init:${terminated.reason || "Error"}`;
    const waitingReason = s.state?.waiting?.reason;
    if (waitingReason && waitingReason !== "PodInitializing") return `Init:${waitingReason}`;
    if (!s.ready) return "Init";
  }

  let status = item.status?.reason || item.status?.phase || "Unknown";
  for (const s of item.status?.containerStatuses || []) {
    if (s.state?.waiting?.reason) {
      status = s.state.waiting.reason;
    } else if (s.state?.terminated) {
      status = s.state.terminated.reason || `ExitCode:${s.state.terminated.exitCode}`;
    }
  }
  return status;
}

function summarizePod(item) {
  const containerStatuses = item.status?.containerStatuses || [];
  const restarts = containerStatuses.reduce((sum, s) => sum + (s.restartCount || 0), 0);
  const readyCount = containerStatuses.filter((s) => s.ready).length;
  const containerCount = (item.spec?.containers || []).length;

  return {
    name: item.metadata?.name || "unknown",
    namespace: item.metadata?.namespace || "unknown",
    phase: item.status?.phase || "unknown",
    status: podDisplayStatus(item),
    ready: `${readyCount}/${containerCount}`,
    restarts,
    age: toAge(item.metadata?.creationTimestamp),
    nodeName: item.spec?.nodeName || "unknown",
    containers: (item.spec?.containers || []).map((c) => c.name)
  };
}

module.exports = {
  getClients,
  summarizePod
};

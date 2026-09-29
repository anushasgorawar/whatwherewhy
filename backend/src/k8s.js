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

function summarizePod(item) {
  const containerStatuses = item.status?.containerStatuses || [];
  const restarts = containerStatuses.reduce((sum, s) => sum + (s.restartCount || 0), 0);

  return {
    name: item.metadata?.name || "unknown",
    namespace: item.metadata?.namespace || "unknown",
    phase: item.status?.phase || "unknown",
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

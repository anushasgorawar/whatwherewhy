const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

async function request(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchNamespaces() {
  return request("/api/namespaces");
}

export async function fetchPods(namespace = "default") {
  return request(`/api/pods?namespace=${encodeURIComponent(namespace)}`);
}

export async function fetchLogs({ namespace, pod, container, tail = 200 }) {
  const params = new URLSearchParams({
    namespace,
    pod,
    tail: String(tail)
  });
  if (container) {
    params.set("container", container);
  }
  return request(`/api/logs?${params.toString()}`);
}

export async function fetchPodMetrics(namespace = "default") {
  return request(`/api/metrics/pods?namespace=${encodeURIComponent(namespace)}`);
}

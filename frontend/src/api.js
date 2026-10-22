const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

async function request(path) {
  const response = await fetch(`${API_BASE}${path}`);
  return handleResponse(response);
}

async function requestPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body || {})
  });
  return handleResponse(response);
}

async function handleResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      parsed = null;
    }
    const message =
      parsed?.error ||
      parsed?.message ||
      text ||
      `Request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
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

export async function fetchNamespaceMetricsSummary() {
  return request("/api/metrics/namespaces-summary");
}

export async function inspectWithAI({ namespace, selectedPod, tail = 200, priorAttempt }) {
  return requestPost("/api/ai/inspect", {
    namespace,
    selectedPod,
    tail,
    priorAttempt
  });
}

export async function executeAISuggestion({ namespace, commands }) {
  return requestPost("/api/ai/execute", { namespace, commands });
}

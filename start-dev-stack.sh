#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd osascript
require_cmd kubectl
require_cmd npm

echo "Checking Kubernetes access..."
kubectl cluster-info >/dev/null

if kubectl -n kube-system get deployment metrics-server >/dev/null 2>&1; then
  METRICS_SERVER_ARGS="$(kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].args}')"
  if [[ "${METRICS_SERVER_ARGS}" != *"--kubelet-insecure-tls"* ]]; then
    echo "Patching metrics-server: adding --kubelet-insecure-tls for local-cluster scraping compatibility..."
    kubectl -n kube-system patch deployment metrics-server --type='json' -p='[
      {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}
    ]' >/dev/null
    kubectl -n kube-system rollout status deployment/metrics-server --timeout=120s >/dev/null || true
  fi
fi

if ! kubectl get --raw "/apis/metrics.k8s.io/v1beta1/nodes" >/dev/null 2>&1; then
  echo "Warning: Kubernetes metrics API is unavailable; pod logs will work, but CPU/memory metrics will not."
fi

# Open two Terminal tabs:
# 1) Frontend dev server
# 2) Backend local dev server
osascript <<EOF
tell application "Terminal"
    activate

    do script "cd \"$FRONTEND_DIR\" && npm install && npm run dev"

    do script "cd \"$BACKEND_DIR\" && npm install && npm run dev"
end tell
EOF

echo "Started:"
echo "- Frontend dev server (Terminal tab 1)"
echo "- Backend local dev server (Terminal tab 2)"

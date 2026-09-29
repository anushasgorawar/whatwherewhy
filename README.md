# Local Kubernetes Pod Health Dashboard

This repository now includes a no-AI observability stack for local Kubernetes (Rancher Desktop):

- `frontend/`: React UI for pod status, manual refresh, and logs view (runs locally, not in Kubernetes).
- `backend/`: Node/Express API for pods, logs, and Prometheus-backed metrics.
- `k8s/app/`: app namespace, RBAC, backend deployment, backend service.
- `k8s/metrics/`: Prometheus, kube-state-metrics, and metrics-server manifests.

## Features

- List pods by namespace.
- Refresh pod list on demand.
- Fetch fresh pod logs on every log refresh action.
- Display basic pod CPU metrics from Prometheus (when available).

## Prerequisites

- Rancher Desktop Kubernetes cluster running.
- `kubectl` configured for your local cluster.
- Docker/nerdctl image build capability.

## Build Images

Rancher Desktop commonly uses containerd for Kubernetes. Build the backend image into the Kubernetes image namespace:

```bash
cd /Users/anushasg/www
nerdctl -n k8s.io build -t pod-observer-backend:0.1.0 ./backend
```

If your setup uses Docker Engine instead, use:

```bash
docker build -t pod-observer-backend:0.1.0 ./backend
```

## Deploy Metrics Stack

```bash
cd /Users/anushasg/www
kubectl apply -f k8s/metrics/
kubectl -n monitoring get pods
```

## Deploy App Stack

```bash
cd /Users/anushasg/www
kubectl apply -f k8s/app/
kubectl -n pod-observer get pods
kubectl -n pod-observer get svc
```

## Run Local React UI (outside Kubernetes)

```bash
cd /Users/anushasg/www/frontend
npm install
npm run dev
```

The UI runs at `http://localhost:5173`.

## Connect Local UI to In-Cluster Backend

In a second terminal:

```bash
kubectl -n pod-observer port-forward svc/pod-observer-backend 8080:8080
```

By default, the UI calls `http://localhost:8080`.

If needed, override API base:

```bash
cd /Users/anushasg/www/frontend
VITE_API_BASE=http://localhost:8080 npm run dev
```

## Verify Backend and Logs

```bash
kubectl -n pod-observer logs deploy/pod-observer-backend
kubectl get pods -A
```

In the UI:

1. Set namespace (for example, `default` or `kube-system`).
2. Click **Refresh Pods**.
3. Select a pod.
4. Click **Refresh Logs** to fetch fresh logs from the cluster.

## Verify Metrics

```bash
kubectl -n monitoring get pods
kubectl -n monitoring get svc prometheus
kubectl -n monitoring port-forward svc/prometheus 9090:9090
```

Open `http://localhost:9090/targets` and verify scrape targets are up.

## Notes

- Backend uses in-cluster config when deployed, and local kubeconfig when run locally.
- Frontend is intentionally local-only in this setup and is not deployed to Kubernetes.
- If Prometheus is unavailable, metrics endpoint degrades gracefully (pods/logs still work).
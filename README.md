# Local Kubernetes Pod Health Dashboard

This repository now includes a no-AI observability stack for local Kubernetes (Rancher Desktop):

- `frontend/`: React UI for pod status, manual refresh, and logs view (runs locally, not in Kubernetes).
- `backend/`: local Node/Express API for pods, logs, and Kubernetes Metrics API data.
- `k8s/app/`: optional deployment manifests retained for reference; not used by the local workflow.
- `k8s/metrics/`: optional Prometheus and kube-state-metrics manifests.

## Features

- Fetch all cluster namespaces and select one from a dropdown.
- List pods for the selected namespace.
- Refresh pod list on demand.
- Fetch fresh pod logs on every log refresh action.
- Display real pod CPU and memory data from the Kubernetes Metrics API.

## Prerequisites

- Rancher Desktop Kubernetes cluster running.
- `kubectl` configured for your local cluster.
- Node.js and npm.

## Optional Monitoring Stack

```bash
cd /Users/anushasg/www
kubectl apply -k k8s/metrics
kubectl -n monitoring get pods
```

`k8s/metrics` intentionally excludes `metrics-server.yaml` from the default kustomization to avoid conflicts with cluster-managed metrics-server installs (common in Rancher Desktop).

## Run Local React UI (outside Kubernetes)

```bash
cd /Users/anushasg/www/frontend
npm install
npm run dev
```

The UI runs at `http://localhost:5173`.

## Run Local Backend

In another terminal:

```bash
cd /Users/anushasg/www/backend
npm install
npm run dev
```

The backend runs at `http://localhost:8080`, uses your active kubeconfig, and requires no container image or port-forward.

If needed, override API base:

```bash
cd /Users/anushasg/www/frontend
VITE_API_BASE=http://localhost:8080 npm run dev
```

## Verify Backend and Logs

```bash
curl http://localhost:8080/healthz
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

- Backend runs locally and uses the active kubeconfig to access Kubernetes.
- Frontend is intentionally local-only in this setup and is not deployed to Kubernetes.
- Pod logs come from the Kubernetes API, and CPU/memory metrics come directly from the Kubernetes Metrics API.

## Optional One-Command Startup

To verify Kubernetes access and open two Terminal tabs (frontend dev server and local backend dev server):

```bash
cd /Users/anushasg/www
./start-dev-stack.sh
```

The script does not build an image or deploy the application backend to Kubernetes. The backend runs locally on port `8080` and accesses the cluster through your active kubeconfig.
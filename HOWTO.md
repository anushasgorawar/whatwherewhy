# HOWTO.md

Operational command log for this repository.

Policy:
- Every code change that affects runtime, deployment, or debugging must update this file.
- Commands should be copy-paste ready.
- Add new sections instead of deleting history, unless a command is confirmed obsolete and replaced.

## Current Baseline Workflow (Local UI + K8s Backend)

### 1) Run frontend locally

```bash
cd /Users/anushasg/www/frontend
npm install
npm run dev
```

Open: `http://localhost:5173`

### 2) Run backend locally (talks to local kubeconfig)

```bash
cd /Users/anushasg/www/backend
npm install
npm start
```

Backend health:

```bash
curl http://localhost:8080/healthz
```

Verify namespace discovery:

```bash
curl http://localhost:8080/api/namespaces
```

### 3) Optional legacy path: build backend image

This is not required for the default local-backend workflow.

```bash
cd /Users/anushasg/www
nerdctl -n k8s.io build -t pod-observer-backend:0.1.0 ./backend
```

### 4) Optional legacy path: deploy app backend resources

This is not required for the default local-backend workflow.

```bash
cd /Users/anushasg/www
kubectl apply -f k8s/app/namespace.yaml
kubectl apply -f k8s/app/backend-rbac.yaml
kubectl apply -f k8s/app/backend-deployment.yaml
kubectl apply -f k8s/app/backend-service.yaml
```

### 5) Deploy monitoring resources

```bash
cd /Users/anushasg/www
kubectl apply -k k8s/metrics
```

Note: on Rancher Desktop, metrics-server is often already present in `kube-system`. The default `k8s/metrics` kustomization excludes `metrics-server.yaml` to avoid deployment conflicts.

If you intentionally need this repository's metrics-server manifest:

```bash
cd /Users/anushasg/www
kubectl apply -f k8s/metrics/metrics-server.yaml
```

### 6) Verify deployments

```bash
kubectl -n pod-observer get pods,svc
kubectl -n monitoring get pods,svc
kubectl -n kube-system get deploy metrics-server
```

### 7) View Prometheus targets

```bash
kubectl -n monitoring port-forward svc/prometheus 9090:9090
```

Open: `http://localhost:9090/targets`

### 8) Verify Metrics API directly (real metrics, no fallback)

```bash
kubectl get --raw "/apis/metrics.k8s.io/v1beta1/namespaces/monitoring/pods"
```

### 9) Useful debug commands

Backend logs from k8s deployment:

```bash
kubectl -n pod-observer logs deploy/pod-observer-backend
```

Prometheus pod logs:

```bash
kubectl -n monitoring logs deploy/prometheus
```

## 10) One-command local startup

Use the helper script to verify Kubernetes access and open two Terminal tabs:

```bash
cd /Users/anushasg/www
./start-dev-stack.sh
```

What the script does:
- Verifies access to the current Kubernetes cluster.
- Checks whether the Kubernetes Metrics API is available and prints a warning if it is not.
- Opens Terminal tab 1 for frontend dev server (`frontend`: `npm install && npm run dev`).
- Opens Terminal tab 2 for backend local dev server (`backend`: `npm install && npm run dev`).

No application image is built, no application pod is deployed, and no port-forward is needed. The local backend uses the active kubeconfig to retrieve pod lists, pod logs, and real CPU/memory data from `metrics.k8s.io`.

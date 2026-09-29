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

### 3) Build backend image for Rancher Desktop k8s runtime

```bash
cd /Users/anushasg/www
nerdctl -n k8s.io build -t pod-observer-backend:0.1.0 ./backend
```

### 4) Deploy app backend resources to Kubernetes

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
kubectl apply -f k8s/metrics/namespace.yaml
kubectl apply -f k8s/metrics/kube-state-metrics-rbac.yaml
kubectl apply -f k8s/metrics/kube-state-metrics.yaml
kubectl apply -f k8s/metrics/prometheus-rbac.yaml
kubectl apply -f k8s/metrics/prometheus-configmap.yaml
kubectl apply -f k8s/metrics/prometheus.yaml
```

Note: on Rancher Desktop, metrics-server is often already present in `kube-system`. Avoid reapplying `k8s/metrics/metrics-server.yaml` unless intentionally replacing the cluster's default metrics-server.

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

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
cp .env.example .env
# edit .env and set:
# - OPENAI_API_KEY (preferred; used when present), or
# - GEMINI_API_KEY (used when OPENAI_API_KEY is absent)
# optional model variables:
# - OPENAI_MODEL (default: gpt-4o-mini)
# - GEMINI_MODEL (default: gemini-1.5-flash)
# optional AI request timeout (milliseconds):
# - AI_HTTP_TIMEOUT_MS (default: 60000)
# optional KPI threshold:
# - CPU_ALERT_CORES (example: 0.7 for 70% of one core)
npm start
```

`backend/.env` is git-ignored. Keep secrets there instead of exporting them in shell history.

LLM provider selection behavior:
- If `OPENAI_API_KEY` is set, backend uses OpenAI for Inspect.
- Else if `GEMINI_API_KEY` is set, backend uses Gemini.
- If both are missing, Inspect returns a configuration error.
- Gemini Inspect now uses the `@google/genai` SDK path (interactions API) and tries model fallbacks in order (`GEMINI_MODEL`, then known Gemini variants including `gemini-flash-latest`, `gemini-3.8-flash`, `gemini-2.5-*`, `gemini-2.0-flash`, `gemini-1.5-*`).
- Gemini Inspect request shape now follows the direct SDK interaction pattern (`ai.interactions.create({ model, input })`), with system/user guidance merged into a single input payload to reduce incompatibility across model variants.
- If Gemini fallback still fails, Inspect returns a probe summary in the error text (for example `gemini-3.8-flash:503, gemini-1.5-flash:404`) to speed up model/key debugging.
- Based on live key validation, the default model is now `gemini-3.7-flash`. Fallback prioritizes that model early and skips candidates that return empty/non-JSON output instead of failing the whole inspect request.
- Timeout behavior: provider timeouts are treated as transient failures; Inspect now returns degraded-mode diagnostics instead of hard-failing the request. For Gemini, timeout on one candidate model also advances to fallback models before failing.
- When all Gemini candidates are unavailable (`404/5xx/timeout`), Inspect now treats that outcome as transient and returns degraded-mode diagnostics (HTTP 200) instead of a hard API error.

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
- If `kube-system/metrics-server` exists and is missing `--kubelet-insecure-tls`, patches the deployment and waits for rollout.
- Checks whether the Kubernetes Metrics API is available and prints a warning if it is not.
- Opens Terminal tab 1 for frontend dev server (`frontend`: `npm install && npm run dev`).
- Opens Terminal tab 2 for backend local dev server (`backend`: `npm install && npm run dev`).

No application image is built, no application pod is deployed, and no port-forward is needed. The local backend uses the active kubeconfig to retrieve pod lists, pod logs, and real CPU/memory data from `metrics.k8s.io`.

Manual equivalent for the metrics-server patch (if you are not using `start-dev-stack.sh`):

```bash
kubectl -n kube-system patch deployment metrics-server --type='json' -p='[
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}
]'
kubectl -n kube-system rollout status deploy/metrics-server
```

### Live frontend behavior

After the latest frontend update, data auto-refreshes while the UI is open:

- namespaces on explicit **Refresh Namespaces** button click
- pods and metrics every 5s
- logs every 5s for the selected pod

If you made code changes or pulled updates, restart frontend/backend:

```bash
cd /Users/anushasg/www/frontend
npm run dev
```

```bash
cd /Users/anushasg/www/backend
npm run dev
```

### AI inspect/execute API quick checks

Inspect current namespace/pod evidence with AI:

```bash
curl -X POST http://localhost:8080/api/ai/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "namespace":"simulation",
    "selectedPod":"cpu-simulator-548d4c57fb-tvb5m",
    "tail":200
  }'
```

Note: Inspect now sends a compact payload to the LLM by default: selected-pod metrics plus the last 20 log lines, to reduce model timeout risk.

Namespace resource dashboard API (all namespaces total + per-namespace CPU/memory):

```bash
curl http://localhost:8080/api/metrics/namespaces-summary
```

Re-inspect with "Find Another Way" feedback:

```bash
curl -X POST http://localhost:8080/api/ai/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "namespace":"simulation",
    "selectedPod":"cpu-simulator-548d4c57fb-tvb5m",
    "priorAttempt":{
      "previousReason":"Previous suggestion did not resolve issue",
      "previousCommands":["kubectl rollout restart deployment/cpu-simulator -n simulation"],
      "feedback":"the prev solution did not work, suggest more ideas"
    }
  }'
```

Execute approved AI commands (allowlist + namespace-scoped only):

```bash
curl -X POST http://localhost:8080/api/ai/execute \
  -H "Content-Type: application/json" \
  -d '{
    "namespace":"simulation",
    "commands":[
      {
        "id":"cmd-1",
        "command":"kubectl scale deployment/cpu-simulator --replicas=2 -n simulation"
      }
    ]
  }'
```

Inspect 503 recovery behavior:
- If upstream AI provider returns `429` or `5xx` (including `503`), backend now returns a degraded-but-successful inspect response with safe diagnostic commands instead of failing the request.
- The UI shows an explicit `AI degraded mode` warning banner while still rendering AI Insight content; retry Inspect after provider recovers.
- Inspect fallback now resolves deployment-style pod input (for example `memory-simulator`) to a live pod name (for example `memory-simulator-<hash>-<id>`) before generating diagnostic commands.

Quick backend diagnostics for Inspect failures:

```bash
cd /Users/anushasg/www/backend
npm run dev
```

In another terminal:

```bash
curl -s -X POST http://localhost:8080/api/ai/inspect \
  -H "Content-Type: application/json" \
  -d '{
    "namespace":"simulation",
    "selectedPod":"healthy-baseline-api",
    "tail":20
  }' | jq
```

If no LLM key is configured, set one in `backend/.env` and restart backend:
- `OPENAI_API_KEY=...` (preferred), or
- `GEMINI_API_KEY=...`

## 11) Simulation environment commands

Install simulation resources (healthy baseline starts automatically):

```bash
cd /Users/anushasg/www
./scripts/simulate.sh install
```

Default post-install state:
- `healthy-baseline-api` running at `replicas=1`
- `healthy-baseline-worker` running at `replicas=1`
- `healthy-baseline-cache` running at `replicas=1`
- `healthy-baseline-gateway` running at `replicas=1`
- all other simulators at `replicas=0`

Start one scenario (this scales the selected simulator to `1` and all others to `0`):

```bash
./scripts/simulate.sh start crashloop
```

Current behavior:
- all four healthy baseline pods remain running at `replicas=1`
- selected scenario also runs at `replicas=1`
- all other simulators remain at `replicas=0`

Memory OOM scenario details (`memory`):
- The `memory-simulator` container is intentionally configured with a very small memory envelope:
  - request: `16Mi`
  - limit: `48Mi`
- The simulator tries to allocate `96Mi` by default (`MEM_TARGET_MB=96`), which is designed to exceed the container limit and trigger `OOMKilled` even when node memory is mostly free.
- This demonstrates cgroup-enforced per-container limits (not node-level exhaustion).

Check scenario status:

```bash
./scripts/simulate.sh status crashloop
```

Run and verify OOMKilled behavior:

```bash
./scripts/simulate.sh start memory
kubectl -n simulation get pods -l app=memory-simulator -w
```

In another terminal, inspect restart reason and exit code:

```bash
POD=$(kubectl -n simulation get pods -l app=memory-simulator -o jsonpath='{.items[0].metadata.name}')
kubectl -n simulation describe pod "$POD" | rg "Reason:|Exit Code:|OOMKilled"
```

Expected signals:
- `Reason: OOMKilled`
- `Exit Code: 137`

Apply memory scenario fix (keeps deployment running but lowers allocation):

```bash
./scripts/simulate.sh fix memory
kubectl -n simulation rollout restart deployment/memory-simulator
```

Trigger interactive auth failure:

```bash
./scripts/simulate.sh trigger auth
```

Apply scenario fix:

```bash
./scripts/simulate.sh fix crashloop
./scripts/simulate.sh fix auth
./scripts/simulate.sh fix cpu
./scripts/simulate.sh fix memory
./scripts/simulate.sh fix readiness
./scripts/simulate.sh fix config
```

Reset one scenario or all scenarios:

```bash
./scripts/simulate.sh reset cpu
./scripts/simulate.sh reset all
```

`reset all` restores the same four healthy baseline pods (`replicas=1` each) and keeps all scenarios at `0`.

Cleanup simulation namespace:

```bash
./scripts/simulate.sh cleanup
```

Direct kubectl inspection:

```bash
kubectl -n simulation get deployments,pods
kubectl -n simulation get events --sort-by=.lastTimestamp
kubectl -n simulation logs deployment/crashloop-simulator --tail=200
kubectl top pods -n simulation
```

## 12) AI Insight panel controls

The AI Insight side panel now uses:
- an icon-only `X` close control in the panel header (replaces text `Close`)
- a left/right collapse indicator in the header title toggle (replaces up/down)
- when collapsed, the panel becomes a thin right-edge control bar (expand + close icons) instead of a full-width empty card

No backend restart is needed for this UI-only control update; refresh the frontend page if it is already open.

## 13) Gemini API evidence-first smoke test

Use this script to avoid guesswork and verify exactly what Gemini models are available for your API key with a tiny prompt.

```bash
cd /Users/anushasg/www/backend
npm run gemini:test
```

What it does:
- loads `GEMINI_API_KEY` from `backend/.env`
- calls `v1beta/models` and lists key-accessible `generateContent` Gemini models
- sends a low-token probe prompt (`give one line response`) against prioritized model candidates
- prints first working model, text response, and usage metadata

Optional:

```bash
cd /Users/anushasg/www/backend
node scripts/test-gemini-api.mjs --list-only
node scripts/test-gemini-api.mjs --model gemini-flash-latest
```

# Final Project Plan: HCI Incident Response + Local K8 Observability

This file is the canonical execution plan for the project. It replaces generic planning guidance with a project-specific roadmap that combines:

- the research paper direction, and
- the working local Kubernetes prototype used to ground that research.

## 1) Locked Decisions (Resolved Ambiguity)

These decisions are now final unless explicitly changed:

1. Project framing is HCI research, not a product launch plan.
2. Paper title is:
   - **What Broke, Why, and Now What?: Designing Interactive AI for Incident Response**
3. Current implementation phase contains **no AI decision logic** in code.
4. React UI runs locally; it is not deployed on Kubernetes.
5. Kubernetes backend and observability components run in cluster.
6. Metrics shown in UI must be real telemetry only (no synthetic/fallback metrics).
7. Every meaningful code/documentation change must update:
   - `Paper.md` (research-style progress), and
   - `HOWTO.md` (exact run/deploy/debug commands if command flow changed).

## 2) Purpose and Outcome

### Research outcome

Produce a coherent HCI paper narrative around three operator questions:

1. What broke? (diagnosis)
2. Why? (evidence/explanation)
3. Now what? (recommended action with explicit human approval)

### Prototype outcome

Maintain a functional local observability prototype that demonstrates:

- pod visibility by namespace,
- explicit log refresh behavior,
- real pod metrics retrieval from Kubernetes metrics API,
- operational reproducibility via documented commands.

## 3) Current System Baseline

### Repo structure

- `frontend/`: local React UI
- `backend/`: Node API for pods/logs/metrics
- `k8s/app/`: backend namespace/RBAC/deployment/service manifests
- `k8s/metrics/`: monitoring manifests
- `README.md`: user-facing setup/deploy instructions
- `HOWTO.md`: operator command log
- `Paper.md`: research progress record
- `AGENTS.md`: collaboration and process rules

### Runtime architecture

- Frontend: local development server (`localhost:5173`)
- Backend: local process or in-cluster service
- Cluster data sources:
  - Core Kubernetes API (pods/logs)
  - Metrics API (`metrics.k8s.io/v1beta1`) via metrics-server

## 4) Milestones and Checklist

## Milestone A: Research Framing Stability

Goal: lock terminology and narrative structure for advisor-readable drafts.

- [x] Final title selected and documented.
- [x] Core three-question model established.
- [x] Human-in-the-loop emphasis and evidence-before-action thesis documented.
- [ ] Draft introduction + contribution statements in paper-ready form.
- [ ] Draft evaluation framing section (method + outcome measures).

Acceptance criteria:

- A reviewer can explain the project scope without seeing chat history.
- Draft language avoids product-marketing tone and remains HCI-focused.

## Milestone B: Functional Prototype Baseline

Goal: maintain a working non-AI observability interface aligned with the research flow.

- [x] Pod list endpoint implemented and wired to UI.
- [x] Logs endpoint implemented with explicit user-triggered refresh.
- [x] Frontend runs locally and calls backend via configured API base.
- [x] Backend configuration supports local and in-cluster runtime modes.
- [x] Metrics endpoint uses real Kubernetes metrics only.
- [ ] End-to-end validation pass on clean local cluster with reproducible transcript.

Acceptance criteria:

- User can load UI, select namespace, view pods, and fetch logs on demand.
- Metrics shown in UI come from real runtime measurements (or fail with explicit error).

## Milestone C: Kubernetes Deployment Reliability

Goal: ensure predictable deployment behavior in Rancher Desktop environments.

- [x] Backend manifests for namespace/RBAC/deployment/service are present.
- [x] Monitoring manifests are present and apply in expected order.
- [ ] Remove/guard cluster-conflicting metrics-server manifest path for default Rancher installs.
- [ ] Add deployment health checks and known-failure remedies to docs.

Acceptance criteria:

- Backend pods reach Ready in `pod-observer`.
- Monitoring pods (Prometheus, kube-state-metrics) reach Ready in `monitoring`.
- Deployment instructions do not require ad-hoc corrections.

## Milestone D: Documentation and Reproducibility Discipline

Goal: keep docs synchronized with implementation at all times.

- [x] `AGENTS.md` includes mandatory sync rules.
- [x] `HOWTO.md` baseline command log created.
- [ ] Align `README.md` and `HOWTO.md` after each architecture/runtime change.
- [ ] Add dated changelog entries in `HOWTO.md` for each command-path update.

Acceptance criteria:

- A collaborator can run frontend/backend and deploy k8 resources with no extra guidance.
- Every command-sensitive code change has matching `HOWTO.md` updates.

## 5) Execution Rules for Future Changes

For every implementation change:

1. Make code/manifests update.
2. Validate behavior (`ReadLints` + runtime checks as relevant).
3. Update `HOWTO.md` if commands or operator steps changed.
4. Update `Paper.md` with:
   - what changed,
   - why it matters to research direction,
   - what remains next.
5. Re-check `README.md` for user-facing setup accuracy.

## 6) Open Risks and Mitigations

1. **Cluster variance risk**
   - Risk: local cluster defaults (especially metrics-server) vary.
   - Mitigation: document cluster-specific paths and avoid forcing conflicting manifests.

2. **Documentation drift risk**
   - Risk: commands in README/HOWTO diverge from real behavior.
   - Mitigation: mandatory dual updates and post-change command verification.

3. **Research-implementation drift risk**
   - Risk: prototype evolves away from HCI questions.
   - Mitigation: each implementation update must include a Paper.md linkage note.

## 7) Immediate Next Actions

1. Complete clean-cluster end-to-end validation and capture results.
2. Resolve metrics-server manifest conflict strategy for Rancher Desktop default installs.
3. Draft paper introduction + evaluation framing sections tied to current prototype behavior.
4. Add first dated `HOWTO.md` change-log block for recent deployment/runtime corrections.

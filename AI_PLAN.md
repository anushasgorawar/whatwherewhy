# AI Integration Plan: Inspect -> Recommend -> Approve -> Act

## 1) Goal

Add a human-in-the-loop AI layer to the existing local Kubernetes incident console so operators can:

1. click **Inspect**,
2. receive a diagnosis + command suggestions based on live pod state, logs, and metrics,
3. choose one of three actions:
   - **Ignore**
   - **Fix It**
   - **Find Another Way**

The implementation must preserve explicit human control and command transparency.

## 2) Locked Scope for This AI Phase

### In scope

- UI button: **Inspect**
- AI analysis of current namespace/pod evidence (pods + metrics + logs)
- Modal/popup with:
  - probable issue summary
  - one-line "why AI thinks so" summary
  - optional "Read details" dropdown/expand panel for deeper evidence only when requested
  - suggested commands
  - actions: **Ignore**, **Fix It**, **Find Another Way**
- Command execution for **Fix It** after user approval
- Re-inspection loop for **Find Another Way** with context:
  - `"the prev solution did not work, suggest more ideas"`
- Controlled scaling/remediation actions for CPU/OOM incidents after explicit approval, including:
  - scaling replicas for a targeted workload
  - patching CPU/memory requests/limits for a targeted workload (phase-gated)

### Out of scope (for now)

- Autonomous cluster-wide scaling or infrastructure reconfiguration without explicit approval
- Multi-step autonomous remediation that spans unrelated services
- Hidden command execution without explicit UI approval

When manual intervention is required, system returns a clear message to operator.

## 3) UX Flow (Detailed)

## 3.1 Inspect action

1. User selects namespace (and optionally pod via table row).
2. User clicks **Inspect**.
3. UI sends request to backend with current context:
   - namespace
   - selected pod
   - latest pods table snapshot
   - latest metrics snapshot
   - latest logs snapshot (selected pod)
4. UI shows loading state: "Inspecting incident evidence..."

## 3.2 AI result popup

Popup includes:

- **What might be wrong** (1-3 ranked hypotheses)
- **One-line reason** (default visible)
- **Read details** (collapsed by default; expands to show log/metric/pod-status evidence references)
- **Suggested commands** (ordered, copyable, explicit namespace)
- **Confidence** (initially optional field, can be null until evaluation model is finalized)
- **Risk note** (low/medium/high operational risk)

Buttons:

- **Ignore**: close popup, no action
- **Fix It**: execute selected AI command set
- **Find Another Way**: rerun inspect with prior-failure context

## 3.3 Fix It behavior

1. User clicks **Fix It**.
2. UI shows exact commands to run and asks for explicit confirmation.
3. Backend runs only approved commands (allowlist + scoped checks).
4. UI displays:
   - command execution status (success/failure)
   - stdout/stderr excerpts
   - post-action pod/metrics/log refresh

## 3.4 Find Another Way behavior

1. User clicks **Find Another Way**.
2. Backend reruns inspect using same evidence plus feedback:
   - `"the prev solution did not work, suggest more ideas"`
3. Popup refreshes with alternate diagnosis/commands.

## 4) Backend Design

## 4.1 New endpoints

- `POST /api/ai/inspect`
  - input: namespace, selectedPod, evidence snapshot, optional priorAttempt
  - output: hypotheses, evidenceRefs, commandPlan, riskLevel, manualActionRequired flag

- `POST /api/ai/execute`
  - input: namespace, selectedPod, approvedCommandIds
  - output: per-command execution results, failures, follow-up recommendations

## 4.2 Evidence packaging

For `inspect`, backend assembles:

- pod objects (phase, restarts, age, node)
- aggregated CPU/memory from metrics API
- recent logs for selected pod
- optional recent event snippets

Evidence is normalized before prompt construction (bounded size, cleaned text).

## 4.3 Prompting strategy

System prompt constraints:

- prioritize kubectl-based diagnosis/remediation
- include namespace explicitly in commands
- avoid destructive/unscoped operations
- mark uncertain hypotheses
- output strict JSON schema for deterministic parsing

Required model output fields:

- `hypotheses[]`
- `evidence_refs[]`
- `commands[]` (id, command, rationale, risk, requires_manual)
- `next_checks[]`

## 5) Command Execution Safety Policy

## 5.1 Allowlist-first execution

Allowed command families (initial):

- `kubectl get ...`
- `kubectl describe ...`
- `kubectl logs ...`
- targeted `kubectl rollout restart deployment/<name> -n <namespace>`
- targeted `kubectl set env deployment/<name> ... -n <namespace>` (only simulation namespace in phase 1)
- targeted `kubectl scale deployment/<name> --replicas=<n> -n <namespace>` (bounded min/max)
- targeted `kubectl patch deployment/<name> -n <namespace> --type merge -p ...` for CPU/memory requests/limits (phase-gated allowlist)

Forbidden (initial):

- `kubectl delete namespace ...`
- cluster-wide destructive ops
- wildcard or unscoped mutations
- shell chaining with untrusted interpolation

## 5.2 Guardrails

- execute only after explicit user approval
- enforce namespace scoping in executor
- validate command against regex/policy before run
- capture full audit trail:
  - timestamp
  - user action
  - command
  - result

## 6) Modal Decision State Machine

- `idle` -> `inspecting` -> `suggested`
- `suggested` + Ignore -> `idle`
- `suggested` + Fix It -> `executing` -> (`execution_success` | `execution_failed`)
- `suggested` + Find Another Way -> `reinspecting` -> `suggested`

Failure transitions:

- inspect failure -> show retry + diagnostics
- execution failure -> show failure details + option: Find Another Way

## 7) Manual-Action Handling (Out-of-Scope Path)

If AI identifies a fix that needs manual infra changes beyond scoped workload remediation (e.g., node pool resize, cluster autoscaler policy changes, quota redesign), return:

- `manual_action_required: true`
- `manual_action_message`: concise operator instructions
- `suggested_verification_commands[]`

No auto-execution for this branch.

## 8) Phased Implementation Plan

## Phase A: AI Read-Only Suggestion

- add Inspect button + popup
- implement `/api/ai/inspect`
- no command execution yet

## Phase B: Controlled Fix It Execution

- implement `/api/ai/execute`
- add approval dialog and execution logs
- apply allowlist and namespace guardrails
- support approved, scoped scaling commands for high CPU/OOM scenarios

## Phase C: Find Another Way Loop

- add prior-failure context injection
- support alternate command plan generation

## Phase D: Evaluation and Confidence Integration

- instrument outcomes
- calibrate/validate confidence fields
- map to HCI trust and decision-quality measures

## 9) Acceptance Criteria

- Inspect produces structured diagnosis and commands from live evidence.
- Popup presents clear choices: Ignore, Fix It, Find Another Way.
- Fix It executes only approved + safe-scoped commands.
- Find Another Way generates materially different alternatives when prior attempt fails.
- Manual-only remediations are surfaced as guidance, not auto-run.
- All actions are logged for later analysis/evaluation.

## 10) Required Files to Change (Implementation Phase)

- `frontend/src/App.jsx` (Inspect button, popup, action flow)
- `frontend/src/api.js` (AI endpoints)
- `backend/src/server.js` (new AI routes)
- new backend AI modules (prompt, schema, executor, safety policy)
- `HOWTO.md` (new run/config/debug commands)
- `Paper.md` (research-style progress updates)

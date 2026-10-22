# What Broke, Why, and Now What?: Designing Interactive AI for Incident Response

## Abstract

Incident responders often rely on command-line tools to inspect pod logs and resource behavior, which makes troubleshooting repetitive, fragmented, and cognitively expensive during active failures. Existing observability workflows are commonly split across separate tools for logs and metrics, requiring operators to context-switch instead of reasoning in one place. This project introduces a single local interface that unifies pod status, logs, and live metrics to support faster diagnosis in a human-centered workflow. The current implementation focuses on this evidence-first interaction layer; LLM-assisted explanation and recommendation are planned as the next phase.

<!-- Previous abstract direction:
This project investigates how to design an AI-assisted incident response workflow that preserves human control while improving speed and clarity during software failure investigation. The current project direction formalizes a three-stage interaction model: (1) What broke? for diagnosis, (2) Why? for evidence-backed explanation, and (3) Now what? for recommendation with explicit human approval. The project framing has been intentionally shifted from product-style language to HCI research language, with emphasis on explainability, trust, and decision accountability.
-->

## Motivation: CLI Density and Cognitive Load

The current command-line workflow for local incident investigation is operationally powerful but interaction-heavy. Responders must remember exact command forms, pod names, namespace scoping, and command order while simultaneously interpreting failures. This produces avoidable cognitive overhead during time-sensitive diagnosis, especially when operators need to correlate pod status, resource pressure, and logs.

![Terminal workflow density](/Users/anushasg/www/terminal.png)

In practice, even a basic pod check often requires multiple commands and mental joins (for example, `kubectl get pods -n simulation`, `kubectl top pods -n simulation`, and `kubectl logs ...`). The key design objective of the UI is not to replace Kubernetes tooling, but to reduce repetitive command recall and cross-referencing effort by showing the same evidence in one place.

## HCI Rationale and Applied Principles

The interface decisions in this prototype map to established HCI principles:

- **Recognition rather than recall** (Nielsen): namespace selection and pod lists reduce memory dependence on exact resource names and flags.
- **Visibility of system status** (Nielsen): 5-second live updates for pod state/metrics and explicit log polling status communicate freshness and liveness.
- **Consistency and standards** (Nielsen): uniform table structure and repeated visual encodings (phase chips, warning cues) reduce interpretation switching costs.
- **Aesthetic and minimalist design** (Nielsen): control-bar simplification removes non-essential refresh controls for pods/metrics and keeps actions focused.
- **Information reduction and integrated context** (HCI decision-support principle): combining pod status and metrics in one table removes the need to reconcile separate views or separate CLI command outputs.

These rules apply directly to the observed CLI pain point: command syntax is still available when needed, but the default path emphasizes low-friction evidence review before action.

## Current Framing and Research Direction

The project is now positioned as an HCI research effort rather than a product proposal. The paper title has been finalized as:

**What Broke, Why, and Now What?: Designing Interactive AI for Incident Response**

The central thesis is that incident response tools should not only generate fixes, but also support human judgment under uncertainty by making model reasoning inspectable before action is taken.

## Interaction Model

The current design scope is organized around three operator questions:

1. **What Broke?**  
   The interface supports diagnosis of failing services, dependencies, or configurations.
2. **Why?**  
   The interface provides evidence traces and explanation for AI-generated claims.
3. **Now What?**  
   The interface proposes candidate actions while preserving explicit human authorization.

This structure is being used as the backbone for both interface narrative and paper organization.

## Language and Positioning Decisions Completed

- Replaced project-branding style references (for example, "Find Fix and Follow-through") with neutral system framing.
- Standardized abstract opening direction to:

  This project proposes an AI-assisted incident response system aimed at assisting users in investigating and responding to software failures via a human-in-the-loop interface.

- Aligned planning language with HCI priorities: explainability, trust calibration, and human oversight.

## Work Completed So Far

The planning artifact has been finalized in `PLANS.md` with:

- an overall plan defining project objective, scope boundaries, and research narrative
- a step-by-step execution plan from title and abstract refinement through evaluation framing and final review
- a reusable `AGENTS.md` template to standardize future collaboration rules, documentation obligations, and agent operating constraints
- a populated `AGENTS.md` policy baseline that operationalizes project priorities, documentation-sync requirements, terminology controls, and guardrails for future agent edits
- an implemented local Kubernetes observability prototype (`React + Node + Kubernetes manifests`) that operationalizes the "What Broke / Why / Now What" interaction structure without AI decision logic
- an architecture correction that keeps both the React interface and backend local while using kubeconfig for Kubernetes data access
- a backend configuration fix that distinguishes local runtime from in-cluster runtime to prevent Kubernetes client initialization failures (`Invalid URL`) during local development
- a metrics fallback strategy that surfaces pod-phase data from kube-state-metrics when Prometheus CPU usage series are unavailable, improving observability continuity in local clusters
- a strict real-metrics update that removes fallback behavior and sources pod CPU/memory directly from Kubernetes metrics-server (`metrics.k8s.io`), ensuring the UI shows only actual telemetry
- a process-control update introducing mandatory `HOWTO.md` synchronization so every runtime/deploy/debug command change is tracked alongside code changes
- a full rewrite of `PLANS.md` from generic ExecPlan template content to a project-specific final plan with locked decisions, milestone checklists, acceptance criteria, and execution rules
- an implemented simulation execution stack (`k8s/simulation` + `scripts/simulate.sh`) that keeps scenarios idle on install and activates failures only through explicit start commands
- a live-observability frontend update that replaces manual-only refresh behavior with periodic polling for namespaces, pod state, logs, and metrics
- a namespace-refresh interaction update that removes namespace polling and introduces explicit operator-controlled namespace refresh
- a UI stability refinement that separates manual loading indicators from background polling to prevent refresh-button state flicker during live updates

## Prototype Implementation Update

A functional, deployable baseline has been added to support incident investigation workflows on local Kubernetes:

- **Frontend (`frontend/`)**: a React interface for namespace selection, pod list refresh, pod selection, and explicit on-demand log retrieval.
- **Backend (`backend/`)**: a local Express API that uses kubeconfig to read Kubernetes pods, logs, and real resource data from the Kubernetes Metrics API.
- **Infrastructure manifests (`k8s/app/`, `k8s/metrics/`)**: raw Kubernetes YAML for backend deployment, RBAC controls, Prometheus, kube-state-metrics, and metrics-server.

## Architecture Adjustment Note

To align with the requirement that the React UI should not be deployed on Kubernetes, the frontend deployment/service manifests were removed from the app stack. The operational model is now:

- Run frontend locally for interaction and visualization.
- Run backend locally and use the active kubeconfig for authenticated cluster access.
- Use the cluster-provided Metrics API for real CPU and memory data.

This prototype advances the research objective by enabling direct observation of how evidence presentation (pod state, logs, and metrics) affects operator understanding before action.

## Runtime Reliability Adjustment

During local validation, pod listing failed with `Invalid URL` because Kubernetes client initialization always attempted in-cluster configuration first. The backend now checks Kubernetes service environment variables and only uses in-cluster config when actually running inside Kubernetes; otherwise, it uses local kubeconfig. This improves development reliability and keeps local UI + local backend workflows consistent with research iteration needs.

## Real Metrics Enforcement

To avoid synthetic or fallback-derived values, metrics retrieval now uses only the Kubernetes Metrics API (`metrics.k8s.io/v1beta1`) provided by metrics-server. The backend returns container-level CPU and memory usage directly from live cluster telemetry, and fails explicitly when metrics are unavailable. This supports a strict evidence-first workflow in which all values shown to users are grounded in real runtime measurements.

## Operational Reproducibility Update

To reduce environment drift and execution ambiguity, the repository now includes an explicit `HOWTO.md` command log and a corresponding rule in `AGENTS.md` requiring updates whenever code changes affect local run flow, Kubernetes deployment flow, or debugging steps. This improves reproducibility of experiments and shortens iteration cycles by keeping verified commands versioned with implementation changes.

## Planning Consolidation Update

`PLANS.md` has been rewritten to match the actual project state and remove generic planning boilerplate. The plan explicitly locks key decisions (HCI framing, local UI and backend, no-AI implementation phase, real-metrics-only policy), and introduces milestone-based tracking with clear acceptance conditions. This improves advisor readability and reduces ambiguity between research intent and implementation activity.

This document (`Paper.md`) now serves as the research-style running record of decisions and progress.

## Developer Workflow Automation Update

A repository-level startup script (`start-dev-stack.sh`) has been added to reduce setup friction during prototype iteration. The script verifies cluster and Metrics API access, then opens two Terminal tabs for the local workflow: frontend development server and backend development server. It does not build a container image, deploy an application backend pod, or require a port-forward. This change matters to the research direction because it improves reproducibility while keeping the prototype lightweight. Next, the same scripted flow should be validated on a clean machine profile and, if stable, integrated into advisor-facing onboarding notes.

## Metrics Deployment Compatibility Update

The default monitoring deployment path has been adjusted to avoid `metrics-server` conflicts in local clusters that already manage this component (for example, Rancher Desktop defaults). Specifically, `k8s/metrics/kustomization.yaml` now excludes `metrics-server.yaml`, and documentation has been updated to treat that manifest as an explicit opt-in step. This improves setup reliability by reducing apply-time failures that interrupt iterative interface evaluation. Next, deployment validation should confirm that required telemetry remains available across both cluster-managed and manually managed metrics-server setups.

## Local Backend Simplification Update

The default workflow now runs the backend only as a local Node process. Pod discovery and log retrieval use the Kubernetes API through the active kubeconfig, while CPU and memory measurements use `metrics.k8s.io`. Removing image builds, application deployment, and port-forwarding avoids unnecessary infrastructure and reduces failure modes during prototype evaluation. Next, the local workflow should be validated against the namespaces used in planned interface studies.

## Namespace Discovery Update

The prototype now retrieves all namespaces visible through the active kubeconfig and presents them in a selection control rather than requiring operators to type a namespace. This reduces recall demands and input errors during incident investigation while making the available scope explicit. Pod, log, and metrics requests continue to use the operator-selected namespace. Next, evaluation should examine whether namespace visibility helps users orient themselves more quickly during diagnosis.

## Failure Simulation Planning Update

A dedicated planning artifact (`simulate.md`) now defines six isolated Kubernetes failure scenarios: crash loops, failed authentication, CPU saturation, out-of-memory termination, readiness failure, and invalid configuration. Each scenario will be implemented as an independent deployment in a `simulation` namespace, remain scaled to zero by default, and emit structured evidence suitable for both human diagnosis and later AI-assisted analysis. The plan also specifies bounded resources, synthetic credentials, independent activation and recovery, and an auditable helper CLI with raw Kubernetes command equivalents. Next, the manifests and CLI should be implemented and validated one scenario at a time before any LLM integration begins.

## Failure Simulation Implementation Update

The simulation plan has now been implemented in repository code. A new `k8s/simulation` manifest set creates the simulation namespace, shared simulator script ConfigMap, and six scenario deployments/services with bounded resource limits and no privileged access. A new helper CLI (`scripts/simulate.sh`) provides install, start, status, trigger, fix, reset, and cleanup workflows. Installation preserves a non-failing baseline by setting all simulator deployments to `replicas=0`; failure states are entered only after a deliberate `start <scenario>` command. This implementation strengthens experimental control by separating environment provisioning from fault activation and by making scenario lifecycle operations reproducible through versioned commands.

## Live Data Update

The frontend now operates as a live dashboard rather than a manual-refresh-only interface. Namespace discovery, pod state, and metrics are polled on short intervals, and logs auto-refresh for the selected pod. This change improves incident-monitoring fidelity by reducing interaction overhead and making state transitions visible with lower latency during simulation and diagnosis tasks.

The polling cadence has been standardized to a uniform 5-second interval for namespaces, pods, metrics, and selected-pod logs to simplify operator expectations and reduce uneven update timing across panels.

Namespace discovery has since been changed to explicit refresh-button control (no namespace polling), while retaining 5-second polling for pod state, metrics, and selected-pod logs. This reduces unnecessary namespace API churn while preserving live incident telemetry in operational panels.

An additional interaction refinement now keeps background polling silent in the control bar: manual button actions still show loading states, while automatic refresh cycles no longer toggle button labels. This improves readability and reduces perceived interface instability during continuous monitoring.

## HCI Visual Salience Update

The frontend interface has been restructured around operator salience and rapid triage. The visual system now uses a constrained three-color palette (`#191716`, `#E6AF2E`, `#E0E2DB`) with explicit contrast mappings to keep status signals legible and consistent under monitoring conditions. Layout has been reorganized into a top-level incident header, focused control strip, summary risk tiles, side-by-side pods/metrics views, and a dedicated log inspection panel. 

To support faster orientation, namespace selection now prioritizes `simulation` when present, and tabular views use status chips plus warning row emphasis for non-running pods, restart activity, and elevated container CPU values. This matters to the research direction because it shifts the prototype from raw data display toward an HCI-grounded decision surface that foregrounds what needs attention first while preserving direct access to evidence.

A subsequent visual consistency pass now applies a uniform surface treatment across the primary dashboard containers, removing mixed panel fills that competed for attention. This improves perceptual grouping and keeps warning emphasis tied to operational state (for example, degraded pods) rather than arbitrary section styling.

The consistency pass has been further tightened by removing remaining mixed fill treatments in status chips and feedback panels. Alert salience is now conveyed through structural cues (selection contrast and accent edge markers) rather than multiple block background colors, preserving a single visual surface hierarchy while retaining incident visibility.

The visual baseline has now been adjusted to a high-contrast dark-canvas scheme: black application background with yellow operational cards, while preserving black action buttons for clear control affordance. This change keeps the interface aligned with rapid scanability goals while making panel boundaries and actionable regions more immediately visible during live incident monitoring.

The palette has since been remapped to a new triad (`#F4F1DE`, `#3D405B`, `#E07A5F`) to continue UI iteration on visual identity and legibility while preserving the same interaction structure and evidence-prioritization layout.

The header has also been simplified to a centered single-title presentation ("Kubernetes Incident Console"), removing supporting subtext to reduce visual noise and prioritize immediate task focus when operators open the dashboard.

A minor visual cleanup removed the header border treatment, further reducing non-essential framing around the title and keeping attention on incident data panels.

Typography has now been updated to use the project-provided Exwayer typeface (`backend/exwayer/exwayer.ttf`) served through the local backend and applied globally in the frontend. This supports ongoing HCI iteration by allowing visual tone and readability experiments without changing dashboard interaction logic.

Typography scope has been refined so Exwayer is used only for section headings while operational body text remains in a standard sans-serif. This keeps visual identity for hierarchy cues without reducing readability in dense monitoring content.

Metrics empty-state feedback has been refined to be context-aware rather than generic. The dashboard now distinguishes among three operational states: no pods in namespace, pods present but not yet running, and running pods with delayed metric availability. This improves operator interpretation by linking missing metric values to observable cluster state instead of suggesting a single infrastructure failure mode.

An additional reliability fix addresses a common local-cluster telemetry failure mode where `metrics-server` runs but returns "no metrics to serve" because kubelet scraping requires insecure TLS mode. The startup workflow now checks for this condition and patches `metrics-server` with `--kubelet-insecure-tls` when missing. This reduces setup friction and helps keep live CPU/memory evidence consistently available in the interface.

To reduce split-attention during triage, pod state and pod-level resource telemetry are now rendered in a single integrated table. In command-line workflows, this information typically requires at least two separate commands (for example, `kubectl get pods` and `kubectl top pods`) and manual cross-referencing. The new view joins each pod row with aggregated CPU/memory values from container metrics, so operators can interpret status, restarts, and runtime pressure at once before drilling into logs.

Log inspection control has also been made explicit through separate refresh and stop actions. Operators can pause log polling to stabilize a view during analysis and then resume by refreshing, which restarts periodic log updates. This supports deliberate attention management during incident diagnosis while preserving live-observability behavior when desired.

The dashboard control bar has been further simplified by removing separate refresh buttons for namespaces, pods, and metrics. Namespace options are loaded directly, while pod state and metrics continue to update through background polling. This reduces control clutter and shifts the interaction model toward passive live monitoring plus focused log controls.

A subsequent layout refinement removes redundant namespace controls by placing namespace selection directly inside the "Namespace" summary card. This keeps scope-selection and summary context co-located, reduces duplicated affordances in the first panel, and improves scannability of the top-level dashboard state.

The namespace selector presentation has been visually softened so it reads as a normal summary value within the card rather than as a separate form field. This preserves direct scope switching while minimizing control salience and maintaining top-card visual consistency.

Log targeting has been further simplified by coupling pod selection directly to the integrated pod-metrics table. Selecting a pod row now immediately loads that pod's logs, the logs panel displays the active pod as plain text, and first-pod logs are shown by default when data becomes available. This removes an extra selector from the logs panel while preserving rapid drill-down behavior.

Dropdown visual treatment has been aligned with local card surfaces so scope-selection controls read as part of their surrounding information cards rather than as mismatched form widgets. This improves aesthetic consistency and supports faster scanning by reducing style discontinuities in the top summary area.

Log retrieval now includes pod-churn recovery behavior for rolling or restarted workloads. When a selected pod disappears and the Kubernetes API returns a not-found response, the interface refreshes pod state and transitions to an available pod context instead of exposing raw transport error payloads. This improves robustness during dynamic incident conditions where pod identities change rapidly.

Namespace-card control sizing has been tightened so the scope selector occupies the full card width and visually aligns with the summary tile layout. This improves perceived consistency between selectable controls and surrounding dashboard cards.

The namespace selector interaction now uses a custom card-native dropdown pattern (button + in-card option menu) instead of the browser-default select control. This avoids platform-specific styling drift, keeps option width aligned with the summary tile, and improves visual continuity with the surrounding HCI dashboard components.

AI-phase planning has now been formalized in a dedicated implementation artifact (`AI_PLAN.md`). The plan defines a human-in-the-loop inspect workflow (Inspect -> Suggest -> Ignore/Fix It/Find Another Way), command-safety guardrails, controlled execution policy, and explicit handling for manual-only remediations. This planning step aligns upcoming AI work with the core research thesis by preserving human approval while expanding from observability to guided action.

The AI scope has been further clarified to keep targeted workload scaling in-scope for approved remediation (for example, replica scaling or scoped CPU/memory adjustments for high CPU/OOM incidents), while still treating broader infrastructure-level changes as manual-only guidance. This preserves actionable support without removing human control over high-impact cluster decisions.

The planned AI explanation presentation has been tightened for readability: the popup now defaults to a one-line rationale, with detailed evidence available only through an optional expand/dropdown interaction. This preserves transparency while reducing initial cognitive load and visual density.

Initial AI integration has now been implemented as a functional end-to-end slice. The frontend provides an Inspect trigger and an AI inspection modal with one-line diagnosis, expandable detail view, command suggestions, and explicit actions (Ignore, Fix It, Find Another Way). The backend adds OpenAI-powered inspection and controlled command-execution endpoints, with namespace-scoped allowlist validation before any command is run. This advances the project from passive observability toward supervised action support while preserving explicit human approval boundaries.

Backend runtime configuration has been updated to use a local `.env` file (`backend/.env`) loaded at process start, with a committed `.env.example` template and git-ignore protections for secret-bearing env files. This reduces key-leak risk and improves reproducibility of AI endpoint setup across development environments.

The AI inspect pipeline has been hardened for practical reliability: prompt constraints now explicitly require namespace-scoped executable commands, response parsing tolerates model formatting variance while enforcing JSON structure, and a safe fallback diagnostic command is returned when no executable suggestion is produced. This improves consistency of the Inspect -> Fix It workflow without adding interaction complexity.

The interaction layout has been further simplified around pod-first actions: the top summary card now remains status-only, while per-pod controls are colocated with pod names in a dedicated pod list panel. Log retrieval has been changed to explicit, on-demand behavior (fetch only after user-triggered refresh inside the pod's expandable logs section), and Inspect is now available directly next to each pod context. This reduces cross-panel navigation and aligns action controls with the object of diagnosis.

Simulation startup behavior has been adjusted to improve immediate observability: installation/reset now restores four dedicated always-healthy baseline pods (`healthy-baseline-api`, `healthy-baseline-worker`, `healthy-baseline-cache`, `healthy-baseline-gateway`) at one replica each while keeping failure scenarios inactive by default. In the UI, each pod row now surfaces core metric context (status, CPU, memory, restarts) adjacent to pod identity, and logs remain accessible through an expandable per-pod control. Together, these changes reduce initial empty-state friction and tighten pod-level evidence scanning.

Scenario-start behavior has been further refined so the healthy baseline remains active during failure simulations. Starting a scenario now keeps all four healthy baseline pods running while enabling the selected failure pod, providing simultaneous contrast between healthy and degraded service states during diagnosis.

Pod-level evidence presentation has been further improved by replacing dense inline metric text with compact metric cards for status, CPU, memory, and restart count. This increases scannability and supports faster visual parsing of per-pod health signals during incident triage.

Per-pod action affordances are now integrated into the same horizontal card strip as core health metrics, so status, resource signals, and immediate actions (Inspect, Logs) are co-located in a single scan path. This reduces eye travel and supports faster pod-level triage decisions.

Namespace-level resource awareness has been expanded with aggregate totals for CPU and memory usage in the top summary region. These totals provide a quick macro-level load signal that complements per-pod cards and supports faster escalation judgments.

LLM provider handling has also been generalized for implementation resilience: the backend now supports provider fallback by using OpenAI when an OpenAI key is configured, and otherwise using Gemini when a Gemini key is available. This keeps the AI inspection workflow operational across different API account constraints while preserving a single frontend interaction model.

A namespace-level resource dashboard has been added to complement pod-local evidence views. The interface now surfaces total CPU/memory usage across all namespaces and a per-namespace breakdown, enabling faster macro-level load awareness before drilling into individual pods.

Provider-specific model resolution has been simplified to prevent cross-provider model mismatches (for example, OpenAI model names being sent to Gemini endpoints). This removes a frequent 404 failure mode and improves reliability of the Inspect action under mixed credential configurations.

Gemini integration has been further hardened with lightweight model fallback logic: when a configured Gemini model is unavailable for the active API key, the backend attempts a short set of known alternatives before failing. This reduces setup friction and avoids unnecessary operator interruption caused by provider model-availability variance.

AI inspect request construction has been further simplified for runtime reliability: the model now receives a compact evidence payload consisting of selected-pod metrics and the last 20 log lines, rather than larger telemetry snapshots. This reduces timeout risk while preserving the most actionable signals for first-pass diagnosis.

Post-processing logic now explicitly handles healthy-state AI outcomes to avoid false escalation: when the diagnosis indicates stable/healthy operation, manual-action flags are cleared and no remediation fallback command is injected. This prevents contradictory UI states (for example, "healthy" plus "manual action required") and keeps operator guidance aligned with observed evidence.

## Observability Dashboard Redesign Update (Frontend-Only)

The Kubernetes Incident Console frontend has been redesigned into a modern observability dashboard while preserving existing backend APIs and runtime behavior. The updated interface introduces a structured two-column layout (primary incident workspace plus AI Insight sidebar), a four-card KPI strip, namespace and cluster current-usage cards, a pod-centric evidence table, and tabbed drill-down views for metrics history, logs, YAML, and events.

This matters to the research direction because it strengthens the "evidence before action" workflow: operators can now assess global load, namespace pressure, pod health, and remediation context in a single visual scan path before deciding whether to invoke AI-assisted actions.

### Applied Gestalt Principles

- **Proximity**: related values are co-located (for example, namespace selector and namespace KPI in one card; pod controls and pod state in the same row) to reduce attention switching.
- **Similarity**: repeated metrics (CPU/memory cards, status chips, table cells) use consistent shapes, color semantics, and typography so operators can compare values quickly.
- **Common Region**: each conceptual unit is grouped in a bordered card (KPI row, current-usage row, pod table, AI panel), which clarifies information boundaries during high-pressure triage.
- **Figure-Ground**: a low-noise background with white cards and subtle borders visually elevates actionable content and keeps critical signals legible.
- **Continuity**: left-to-right alignment from summary state to pod evidence to action controls supports a predictable progression from diagnosis to decision.

### Applied Nielsen Heuristics

- **Visibility of system status**: cluster connectivity, loading states, polling behavior, and inspection progress are always visible.
- **Recognition rather than recall**: pod evidence, namespace options, and AI suggestions are presented directly in the interface, reducing command-memory burden.
- **Consistency and standards**: shared interaction patterns (buttons, tabs, badges, cards, iconography) keep meaning stable across sections.
- **User control and freedom**: operators can inspect on demand, approve or withhold remediation, switch tabs, and stop log polling.
- **Error prevention**: disabled actions and scoped controls prevent invalid operations (for example, actions requiring selected pods or available AI suggestions).
- **Aesthetic and minimalist design**: dense operational data is organized into clear hierarchy without introducing nonessential controls.

### Interface-Specific Research Contribution

Historically, operators needed separate CLI commands and mental cross-referencing to combine pod state, usage metrics, and logs. The redesigned console reduces this split-attention cost by presenting these evidence streams in one coordinated surface, then attaching AI investigation affordances next to the same operational context. The practical hypothesis for evaluation is that this integrated view improves triage speed, comprehension quality, and action confidence without removing human approval authority.

## Visual Salience Calibration Update

A follow-up frontend styling pass increased color salience across summary cards, usage panels, table regions, and AI context surfaces to make state-group boundaries immediately visible during active monitoring. The prior visual treatment was functionally correct but could appear too neutral in some local runs, reducing perceptual separation between informational layers. Strengthening card-level color regions improves figure-ground contrast and supports faster first-pass scanning without changing data flow or interaction logic.

## Next Paper-Facing Steps

1. Expand the abstract beyond the opening paragraph with problem statement, method framing, and expected contribution.
2. Draft section outlines for diagnosis, explanation, and action-approval interaction design.
3. Define evaluation criteria (e.g., understanding, confidence, and safer action selection).
4. Run a consistency pass so all sections preserve the same HCI thesis and terminology.

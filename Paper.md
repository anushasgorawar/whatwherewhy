# What Broke, Why, and Now What?: Designing Interactive AI for Incident Response

## Abstract

This project investigates how to design an AI-assisted incident response workflow that preserves human control while improving speed and clarity during software failure investigation. The current project direction formalizes a three-stage interaction model: (1) What broke? for diagnosis, (2) Why? for evidence-backed explanation, and (3) Now what? for recommendation with explicit human approval. The project framing has been intentionally shifted from product-style language to HCI research language, with emphasis on explainability, trust, and decision accountability.

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

## Next Paper-Facing Steps

1. Expand the abstract beyond the opening paragraph with problem statement, method framing, and expected contribution.
2. Draft section outlines for diagnosis, explanation, and action-approval interaction design.
3. Define evaluation criteria (e.g., understanding, confidence, and safer action selection).
4. Run a consistency pass so all sections preserve the same HCI thesis and terminology.

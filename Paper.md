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
- an architecture correction that keeps the React interface local (outside Kubernetes) while retaining in-cluster backend and metrics components for Kubernetes data access
- a backend configuration fix that distinguishes local runtime from in-cluster runtime to prevent Kubernetes client initialization failures (`Invalid URL`) during local development
- a metrics fallback strategy that surfaces pod-phase data from kube-state-metrics when Prometheus CPU usage series are unavailable, improving observability continuity in local clusters
- a strict real-metrics update that removes fallback behavior and sources pod CPU/memory directly from Kubernetes metrics-server (`metrics.k8s.io`), ensuring the UI shows only actual telemetry
- a process-control update introducing mandatory `HOWTO.md` synchronization so every runtime/deploy/debug command change is tracked alongside code changes
- a full rewrite of `PLANS.md` from generic ExecPlan template content to a project-specific final plan with locked decisions, milestone checklists, acceptance criteria, and execution rules

## Prototype Implementation Update

A functional, deployable baseline has been added to support incident investigation workflows on local Kubernetes:

- **Frontend (`frontend/`)**: a React interface for namespace selection, pod list refresh, pod selection, and explicit on-demand log retrieval.
- **Backend (`backend/`)**: an Express API that reads Kubernetes pods and logs through service-account permissions and exposes metrics data from Prometheus where available.
- **Infrastructure manifests (`k8s/app/`, `k8s/metrics/`)**: raw Kubernetes YAML for backend deployment, RBAC controls, Prometheus, kube-state-metrics, and metrics-server.

## Architecture Adjustment Note

To align with the requirement that the React UI should not be deployed on Kubernetes, the frontend deployment/service manifests were removed from the app stack. The operational model is now:

- Run frontend locally for interaction and visualization.
- Port-forward backend service from cluster to local machine.
- Keep backend and metrics components in-cluster for authenticated Kubernetes and monitoring data access.

This prototype advances the research objective by enabling direct observation of how evidence presentation (pod state, logs, and metrics) affects operator understanding before action.

## Runtime Reliability Adjustment

During local validation, pod listing failed with `Invalid URL` because Kubernetes client initialization always attempted in-cluster configuration first. The backend now checks Kubernetes service environment variables and only uses in-cluster config when actually running inside Kubernetes; otherwise, it uses local kubeconfig. This improves development reliability and keeps local UI + local backend workflows consistent with research iteration needs.

## Real Metrics Enforcement

To avoid synthetic or fallback-derived values, metrics retrieval now uses only the Kubernetes Metrics API (`metrics.k8s.io/v1beta1`) provided by metrics-server. The backend returns container-level CPU and memory usage directly from live cluster telemetry, and fails explicitly when metrics are unavailable. This supports a strict evidence-first workflow in which all values shown to users are grounded in real runtime measurements.

## Operational Reproducibility Update

To reduce environment drift and execution ambiguity, the repository now includes an explicit `HOWTO.md` command log and a corresponding rule in `AGENTS.md` requiring updates whenever code changes affect local run flow, Kubernetes deployment flow, or debugging steps. This improves reproducibility of experiments and shortens iteration cycles by keeping verified commands versioned with implementation changes.

## Planning Consolidation Update

`PLANS.md` has been rewritten to match the actual project state and remove generic planning boilerplate. The new plan explicitly locks key decisions (HCI framing, local UI / in-cluster backend split, no-AI implementation phase, real-metrics-only policy), and introduces milestone-based tracking with clear acceptance conditions. This improves advisor readability and reduces ambiguity between research intent and implementation activity.

This document (`Paper.md`) now serves as the research-style running record of decisions and progress.

## Next Paper-Facing Steps

1. Expand the abstract beyond the opening paragraph with problem statement, method framing, and expected contribution.
2. Draft section outlines for diagnosis, explanation, and action-approval interaction design.
3. Define evaluation criteria (e.g., understanding, confidence, and safer action selection).
4. Run a consistency pass so all sections preserve the same HCI thesis and terminology.

# AGENTS.md

This file defines project-specific instructions for coding agents and collaborators working in this repository.

## 1) Project Overview

- Project name: `What Broke, Why, and Now What?`
- One-sentence purpose: Design and document an HCI-centered, human-in-the-loop AI incident response workflow that improves understanding before action.
- Primary users: Incident responders, software engineers on call, and HCI reviewers/advisors.
- Current stage: Research and paper development.

## 2) Goals and Priorities

- Top 3 goals:
  1. Produce a coherent HCI research narrative around diagnosis, explanation, and action approval.
  2. Keep all project docs aligned on terminology and framing.
  3. Make every change traceable in `Paper.md` as research progress.
- Non-goals:
  - Shipping production software in this repository right now.
  - Over-optimizing implementation details before narrative and evaluation framing are stable.

## 3) Repository Orientation

- Current important files:
  - `PLANS.md`: planning and execution guidance.
  - `Paper.md`: research-style running draft and progress record.
  - `README.md`: lightweight repository overview.
  - `HOWTO.md`: running log of commands used to run frontend/backend and deploy/operate Kubernetes resources.
  - `AGENTS.md`: agent collaboration rules (this file).
- Files that must not be modified without approval:
  - None explicitly locked, but do not rewrite or remove major sections in `PLANS.md` without user confirmation.

## 4) Documentation Standards

- Use concise, formal language suitable for research communication.
- Prefer explicit headings and clear section boundaries.
- Keep terminology consistent:
  - Use: "incident response", "human-in-the-loop", "explainability", "evidence", "human approval".
  - Avoid product-marketing tone and unexplained branding.
- Definition of done for doc changes:
  - The updated document is internally consistent.
  - Related project docs are synchronized (`Paper.md` update included).
  - The change can be understood without prior chat context.

## 5) Workflow Rules

- Branch strategy: make incremental, reviewable edits on current branch unless user requests otherwise.
- Commit strategy: small logical groups of changes.
- Before finalizing a task:
  - Re-read changed files for coherence.
  - Run available lint/diagnostic checks when applicable.

## 6) Agent Operating Instructions

- Allowed by default:
  - Edit documentation files (`AGENTS.md`, `Paper.md`, `PLANS.md`, `README.md`) as requested.
  - Propose structure, language, and research framing improvements.
- Requires confirmation first:
  - Deleting major sections from core docs.
  - Introducing new top-level files not requested by the user.
  - Any destructive operation.
- Forbidden:
  - Fabricating experiment results, citations, or user studies that did not happen.
  - Reframing the project away from HCI without explicit user approval.
- If requirements are unclear:
  - Make the smallest safe interpretation.
  - Ask one focused clarification question when ambiguity changes outcomes.
- Progress updates:
  - Provide concise updates before and after meaningful edits.

## 7) Mandatory Documentation Sync

For every meaningful change in this repository, also update `Paper.md` in research-paper style to reflect:
- what changed,
- why it matters to the research direction,
- what remains next.

When relevant, also update:
- `README.md` for high-level orientation changes.
- `PLANS.md` for planning or milestone changes.
- `HOWTO.md` with exact commands required to run frontend/backend locally and deploy/operate Kubernetes resources affected by that change.

`HOWTO.md` requirement for all code changes:
- Add or update command snippets whenever behavior, startup flow, build flow, deploy flow, or debugging flow changes.
- Keep commands copy-paste ready and grouped by use case (run locally, deploy to k8s, verify health, inspect logs).
- Treat missing `HOWTO.md` updates as incomplete work.

## 8) Domain Context

Core model for this project:
1. What Broke? -> diagnosis
2. Why? -> evidence and explanation
3. Now What? -> recommendation with explicit human approval

Core thesis:
- Good incident response support tools should improve human judgment, not replace it.
- Evidence should precede action.

## 9) Quality and Safety Constraints

- Security/privacy:
  - Do not include secrets, credentials, private tokens, or real incident-sensitive data in docs.
- Reliability:
  - Avoid contradictory statements across files.
- Accessibility/usability:
  - Use readable prose and explicit structure suitable for advisor and peer review.

## 10) Open Questions (Living)

- What evaluation methodology will be used (study design vs. analytical framework)?
- What concrete interface artifacts (mockups/prototypes) will accompany the paper?
- Which venue style (class paper vs. conference-like format) will be targeted first?

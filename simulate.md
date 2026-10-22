# Failure Simulation Guide

## Purpose

This document defines the planned Kubernetes failure-simulation environment for the incident response prototype. The environment will create six independent simulator deployments in a dedicated `simulation` namespace. It is intended to generate controlled logs, Kubernetes states, events, and metrics for diagnosis and, in a later phase, AI-assisted explanation and remediation suggestions.

The AI/LLM integration is outside the scope of this phase.

## Operating Model

- Each simulator is its own Kubernetes Deployment.
- All simulator deployments default to `replicas: 0`.
- Starting one scenario scales only that deployment to one replica.
- Multiple scenarios run together only when explicitly started.
- `reset all` returns every simulator to zero replicas.
- No simulator uses privileged containers, host mounts, or cluster-wide permissions.
- CPU and memory limits bound the impact of active scenarios.
- Simulator applications use a lightweight public Python image and mounted scripts, so no custom image build is required.

## Planned CLI

The commands below describe the interface that will be implemented in `scripts/simulate.sh`.

### Install simulator resources

```bash
./scripts/simulate.sh install
```

This creates the `simulation` namespace and installs all six deployments at zero replicas.

### Start one failure

```bash
./scripts/simulate.sh start <scenario>
```

Example:

```bash
./scripts/simulate.sh start memory
```

Only `memory-simulator` is activated. The other deployments remain at zero replicas.

### Inspect a scenario

```bash
./scripts/simulate.sh status <scenario>
```

The status output should include:

- Deployment availability
- Pod phase and readiness
- Restart count
- Recent Kubernetes events
- A command for retrieving logs

### Trigger an interactive failure

The authentication simulator requires an invalid login request:

```bash
./scripts/simulate.sh trigger auth
```

### Apply the documented fix

```bash
./scripts/simulate.sh fix <scenario>
```

Example:

```bash
./scripts/simulate.sh fix readiness
```

### Reset scenarios

Reset one scenario:

```bash
./scripts/simulate.sh reset cpu
```

Reset and stop every scenario:

```bash
./scripts/simulate.sh reset all
```

### Remove the environment

```bash
./scripts/simulate.sh cleanup
```

This explicitly deletes the isolated `simulation` namespace and all resources inside it.

## Scenario 1: CrashLoop / Pod Failure

Deployment: `crashloop-simulator`

### Simulation

The process starts, emits a structured fatal startup record, and exits with status code 1. Kubernetes restarts the container until the pod enters `CrashLoopBackOff`.

```bash
./scripts/simulate.sh start crashloop
```

Expected evidence:

- Pod status becomes `CrashLoopBackOff`.
- Restart count increases.
- Logs contain a `STARTUP_FATAL` event.
- Kubernetes events report container back-off.

### Fix

```bash
./scripts/simulate.sh fix crashloop
```

The fix sets `FAIL_MODE=false`. The replacement container remains running and becomes ready.

An additional recovery exercise can delete the healthy pod and verify that its Deployment automatically creates a replacement:

```bash
kubectl -n simulation delete pod -l app=crashloop-simulator
```

## Scenario 2: Login Failure

Deployment: `auth-simulator`

Service: `auth-simulator`

### Simulation

The service exposes a synthetic `/login` endpoint. An invalid request returns HTTP 401 and emits an `AUTH_INVALID_CREDENTIALS` record. Synthetic credentials must never reuse real usernames, passwords, or secrets.

```bash
./scripts/simulate.sh start auth
./scripts/simulate.sh trigger auth
```

Expected evidence:

- Pod remains running and ready.
- Login request returns HTTP 401.
- Logs identify the attempted synthetic username, response status, and authentication failure reason.
- Logs never include the submitted password.

### Fix

```bash
./scripts/simulate.sh fix auth
```

The fix sends the documented valid synthetic credentials. The endpoint returns success and emits an `AUTH_SUCCESS` record.

## Scenario 3: CPU Saturation

Deployment: `cpu-simulator`

### Simulation

The process runs a CPU-intensive loop within a strict container CPU limit.

```bash
./scripts/simulate.sh start cpu
```

Expected evidence:

- Pod remains running.
- Kubernetes Metrics API reports CPU usage near the configured limit.
- Logs periodically emit a `CPU_SATURATION` record.

### Fix

```bash
./scripts/simulate.sh fix cpu
```

The fix disables the busy loop. CPU usage should fall after the Metrics API refresh interval.

## Scenario 4: Memory / OOM Failure

Deployment: `memory-simulator`

### Simulation

The process gradually allocates more memory than its small container memory limit.

```bash
./scripts/simulate.sh start memory
```

Expected evidence:

- Logs show allocation progress.
- Container termination reason becomes `OOMKilled`.
- Restart count increases.
- Kubernetes events and pod status show repeated termination.

### Fix

```bash
./scripts/simulate.sh fix memory
```

The fix lowers the target allocation below the configured memory limit. The replacement pod remains running.

## Scenario 5: Readiness Failure

Deployment: `readiness-simulator`

Service: `readiness-simulator`

### Simulation

The process runs normally, but its `/ready` endpoint returns HTTP 503.

```bash
./scripts/simulate.sh start readiness
```

Expected evidence:

- Pod phase is `Running`.
- Ready condition remains false.
- Readiness probe events report HTTP 503.
- Logs emit a `READINESS_REJECTED` record.

### Fix

```bash
./scripts/simulate.sh fix readiness
```

The fix enables the readiness endpoint. The probe returns HTTP 200 and the pod becomes ready.

## Scenario 6: Invalid Configuration

Deployment: `config-simulator`

ConfigMap: `config-simulator-settings`

### Simulation

The application reads an intentionally invalid configuration value, emits a `CONFIG_INVALID` record, and exits.

```bash
./scripts/simulate.sh start config
```

Expected evidence:

- Pod repeatedly restarts.
- Logs identify the invalid field and value.
- Logs do not expose credentials or sensitive configuration.

### Fix

```bash
./scripts/simulate.sh fix config
```

The fix updates the ConfigMap with a valid value and restarts the deployment. The replacement pod remains healthy.

## Structured Log Contract

Simulator application logs use one JSON object per line:

```json
{
  "timestamp": "2026-10-01T14:00:00Z",
  "service": "config-simulator",
  "severity": "ERROR",
  "event": "CONFIG_INVALID",
  "message": "Unsupported operating mode",
  "configuredValue": "broken"
}
```

Required fields:

- `timestamp`: UTC ISO 8601 timestamp
- `service`: simulator deployment identity
- `severity`: `INFO`, `WARN`, or `ERROR`
- `event`: stable machine-readable event code
- `message`: concise human-readable explanation

Scenario-specific evidence fields may be added, but logs must not include passwords, tokens, kubeconfig content, or other secrets.

## Running Multiple Failures

Scenarios are independent and may be combined intentionally:

```bash
./scripts/simulate.sh start cpu
./scripts/simulate.sh start readiness
```

Only those two deployments run. Combined scenarios should be used after each individual scenario has been validated because simultaneous failures make diagnosis less controlled.

Return to a clean state with:

```bash
./scripts/simulate.sh reset all
```

## Planned Raw Kubernetes Access

The helper CLI will print or document equivalent `kubectl` commands. Common inspection commands will include:

```bash
kubectl -n simulation get deployments,pods
kubectl -n simulation get events --sort-by=.lastTimestamp
kubectl -n simulation logs deployment/<deployment-name> --tail=200
kubectl -n simulation describe pod <pod-name>
kubectl top pods -n simulation
```

The exact scenario-specific mutation commands will be added after the manifests and helper CLI are implemented and validated.

## Definition of Done

- The `simulation` namespace is created through versioned manifests.
- All six deployments install at zero replicas.
- Each scenario can be started, observed, fixed, and reset independently.
- Failure evidence is visible through logs, pod status, events, or Metrics API data.
- The existing local dashboard can select the `simulation` namespace and retrieve simulator logs and metrics.
- Every simulator has bounded resources and contains no real credentials or incident-sensitive data.
- Validation ends with all deployments at zero replicas.

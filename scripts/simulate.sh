#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="simulation"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST_DIR="${ROOT_DIR}/k8s/simulation"

SCENARIOS=(crashloop auth cpu memory readiness config)
HEALTHY_BASELINE_DEPLOYMENTS=(
  "healthy-baseline-api"
  "healthy-baseline-worker"
  "healthy-baseline-cache"
  "healthy-baseline-gateway"
)

deployment_for() {
  case "$1" in
    crashloop) echo "crashloop-simulator" ;;
    auth) echo "auth-simulator" ;;
    cpu) echo "cpu-simulator" ;;
    memory) echo "memory-simulator" ;;
    readiness) echo "readiness-simulator" ;;
    config) echo "config-simulator" ;;
    *) return 1 ;;
  esac
}

require_scenario() {
  local scenario="${1:-}"
  if [[ -z "${scenario}" ]]; then
    echo "Scenario is required."
    exit 1
  fi
  deployment_for "${scenario}" >/dev/null || {
    echo "Unknown scenario: ${scenario}"
    echo "Supported: ${SCENARIOS[*]}"
    exit 1
  }
}

reset_defaults() {
  kubectl -n "${NAMESPACE}" set env deployment/crashloop-simulator FAIL_MODE=true >/dev/null
  kubectl -n "${NAMESPACE}" set env deployment/cpu-simulator CPU_SATURATION=true >/dev/null
  kubectl -n "${NAMESPACE}" set env deployment/memory-simulator MEM_TARGET_MB=256 >/dev/null
  kubectl -n "${NAMESPACE}" set env deployment/readiness-simulator READINESS_FAIL=true >/dev/null
  kubectl -n "${NAMESPACE}" set env deployment/config-simulator CONFIG_MODE- >/dev/null || true
  kubectl -n "${NAMESPACE}" patch configmap/config-simulator-settings \
    --type merge \
    -p '{"data":{"APP_MODE":"broken"}}' >/dev/null
}

scale_all_zero() {
  for item in "${SCENARIOS[@]}"; do
    local dep
    dep="$(deployment_for "${item}")"
    kubectl -n "${NAMESPACE}" scale deployment/"${dep}" --replicas=0 >/dev/null
  done
}

scale_healthy_baseline() {
  for dep in "${HEALTHY_BASELINE_DEPLOYMENTS[@]}"; do
    kubectl -n "${NAMESPACE}" scale deployment/"${dep}" --replicas=1 >/dev/null
  done
}

cmd_install() {
  kubectl apply -k "${MANIFEST_DIR}"
  scale_all_zero
  reset_defaults
  scale_healthy_baseline
  echo "Simulation resources installed in namespace '${NAMESPACE}'. Four healthy baseline pods are running (replicas=1 each); all scenario simulators are replicas=0."
}

cmd_start() {
  local scenario="$1"
  require_scenario "${scenario}"
  local target_dep
  target_dep="$(deployment_for "${scenario}")"

  scale_all_zero
  reset_defaults
  scale_healthy_baseline
  kubectl -n "${NAMESPACE}" scale deployment/"${target_dep}" --replicas=1 >/dev/null
  echo "Started scenario '${scenario}' (${target_dep}) with healthy baseline '${HEALTHY_BASELINE_DEPLOYMENT}' also running."
}

cmd_status() {
  local scenario="$1"
  require_scenario "${scenario}"
  local dep
  dep="$(deployment_for "${scenario}")"

  echo "=== Deployment status (${dep}) ==="
  kubectl -n "${NAMESPACE}" get deployment "${dep}" -o wide || true

  echo
  echo "=== Pod status ==="
  kubectl -n "${NAMESPACE}" get pods -l app="${dep}" \
    -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount --no-headers || true

  echo
  echo "=== Recent events ==="
  kubectl -n "${NAMESPACE}" get events --sort-by=.lastTimestamp | tail -n 15 || true

  echo
  echo "Logs command:"
  echo "kubectl -n ${NAMESPACE} logs deployment/${dep} --tail=200"
}

cmd_trigger() {
  local scenario="$1"
  require_scenario "${scenario}"
  if [[ "${scenario}" != "auth" ]]; then
    echo "trigger is currently supported only for scenario 'auth'."
    exit 1
  fi
  kubectl -n "${NAMESPACE}" run auth-trigger --rm -i --restart=Never --image=curlimages/curl:8.10.1 -- \
    curl -sS -X POST \
    -H "Content-Type: application/json" \
    -d '{"username":"bad-user","password":"bad-pass"}' \
    http://auth-simulator:8080/login
}

cmd_fix() {
  local scenario="$1"
  require_scenario "${scenario}"

  case "${scenario}" in
    crashloop)
      kubectl -n "${NAMESPACE}" set env deployment/crashloop-simulator FAIL_MODE=false
      ;;
    auth)
      kubectl -n "${NAMESPACE}" run auth-fix --rm -i --restart=Never --image=curlimages/curl:8.10.1 -- \
        curl -sS -X POST \
        -H "Content-Type: application/json" \
        -d '{"username":"demo-user","password":"demo-pass"}' \
        http://auth-simulator:8080/login
      ;;
    cpu)
      kubectl -n "${NAMESPACE}" set env deployment/cpu-simulator CPU_SATURATION=false
      ;;
    memory)
      kubectl -n "${NAMESPACE}" set env deployment/memory-simulator MEM_TARGET_MB=64
      ;;
    readiness)
      kubectl -n "${NAMESPACE}" set env deployment/readiness-simulator READINESS_FAIL=false
      ;;
    config)
      kubectl -n "${NAMESPACE}" patch configmap/config-simulator-settings \
        --type merge \
        -p '{"data":{"APP_MODE":"healthy"}}'
      kubectl -n "${NAMESPACE}" rollout restart deployment/config-simulator
      ;;
  esac

  echo "Applied fix for scenario '${scenario}'."
}

cmd_reset() {
  local scenario="$1"
  if [[ "${scenario}" == "all" ]]; then
    scale_all_zero
    reset_defaults
    scale_healthy_baseline
    echo "Reset all scenarios to default failure settings and restored all healthy baseline pods (replicas=1 each)."
    return
  fi
  require_scenario "${scenario}"
  local dep
  dep="$(deployment_for "${scenario}")"
  kubectl -n "${NAMESPACE}" scale deployment/"${dep}" --replicas=0
  reset_defaults
  echo "Reset scenario '${scenario}' to replicas=0."
}

cmd_cleanup() {
  kubectl delete namespace "${NAMESPACE}" --ignore-not-found=true
  echo "Deleted namespace '${NAMESPACE}'."
}

usage() {
  cat <<EOF
Usage:
  ./scripts/simulate.sh install
  ./scripts/simulate.sh start <scenario>
  ./scripts/simulate.sh status <scenario>
  ./scripts/simulate.sh trigger auth
  ./scripts/simulate.sh fix <scenario>
  ./scripts/simulate.sh reset <scenario|all>
  ./scripts/simulate.sh cleanup

Scenarios:
  ${SCENARIOS[*]}
EOF
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    install) cmd_install ;;
    start) cmd_start "${2:-}" ;;
    status) cmd_status "${2:-}" ;;
    trigger) cmd_trigger "${2:-}" ;;
    fix) cmd_fix "${2:-}" ;;
    reset) cmd_reset "${2:-}" ;;
    cleanup) cmd_cleanup ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"

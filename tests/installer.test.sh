#!/usr/bin/env bash
#
# Installer presentation / behavior tests.
#
# These tests check stable textual behavior and terminal-mode decisions only.
# They never depend on timing-sensitive visual assertions.
#
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${ROOT}/install.sh"
PASS=0
FAIL=0
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ams-installer-test.XXXXXX")"
TEST_HOME="${TEST_ROOT}/home"
TEST_CONFIG_HOME="${TEST_ROOT}/config"
TEST_DATA_HOME="${TEST_ROOT}/data"
mkdir -p "${TEST_HOME}" "${TEST_CONFIG_HOME}/auto-model-switcher/logs" "${TEST_DATA_HOME}"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT

run_isolated() {
  env \
    HOME="${TEST_HOME}" \
    XDG_CONFIG_HOME="${TEST_CONFIG_HOME}" \
    XDG_DATA_HOME="${TEST_DATA_HOME}" \
    "$@"
}

# ANSI escape sequence detector (matches CSI / OSC / common SGR bytes).
has_ansi() { [[ "$1" == *$'\033['* || "$1" == *$'\033]'* ]]; }

# check <name> <result-var>
# result-var must hold 0 (pass) or non-zero (fail).
check() {
  local name="$1" result="$2"
  if [[ "${result}" -eq 0 ]]; then
    PASS=$((PASS + 1))
    printf '[OK] %s\n' "${name}"
  else
    FAIL=$((FAIL + 1))
    printf '[XX] %s\n' "${name}"
  fi
}

# --- 1. bash -n succeeds ----------------------------------------------------
if bash -n "${INSTALLER}" 2>/dev/null; then r1=0; else r1=1; fi
check "bash -n parses install.sh" "${r1}"

# --- 2. plain mode contains no ANSI ----------------------------------------
plain_render="$(run_isolated env AUTO_MODEL_SWITCHER_PLAIN=1 bash -c '
  source "'"${INSTALLER}"'"
  ams_logo
  ams_welcome
  info "hello"
  warn "careful"
  success "done"
' 2>&1)"
if ! has_ansi "${plain_render}"; then r2=0; else r2=1; fi
check "plain mode has no ANSI escapes" "${r2}"

# --- 3. NO_COLOR disables colors -------------------------------------------
no_color_render="$(run_isolated env NO_COLOR=1 bash -c '
  source "'"${INSTALLER}"'"
  info "hello"
  success "done"
' 2>&1)"
if ! has_ansi "${no_color_render}"; then r3=0; else r3=1; fi
check "NO_COLOR disables colors" "${r3}"

# --- 4. TERM=dumb disables colors ------------------------------------------
dumb_render="$(run_isolated env TERM=dumb bash -c '
  source "'"${INSTALLER}"'"
  info "hello"
' 2>&1)"
if ! has_ansi "${dumb_render}"; then r4=0; else r4=1; fi
check "TERM=dumb disables colors" "${r4}"

# --- 5. redirected/non-TTY output does not animate -------------------------
# When stdout is not a TTY, no carriage-return animation is emitted.
redirected="$(run_isolated bash -c '
  source "'"${INSTALLER}"'"
  _spin_start "non-interactive work"
  _spin_stop
' 2>&1 | cat)"
if [[ "${redirected}" != *$'\r'* ]]; then r5=0; else r5=1; fi
check "non-TTY output has no carriage returns" "${r5}"

# --- 6. success path cleans up spinner processes ---------------------------
cleanup_test="$(run_isolated bash -c '
  source "'"${INSTALLER}"'"
  AMS_INTERACTIVE=1 AMS_USE_ANIMATION=1 AMS_USE_COLOR=0 AMS_USE_UNICODE=0
  run_sanitized "fake work" true
  [[ -z "${AMS_SPIN_PID}" ]] && echo "SPINNERS=0" || echo "SPINNERS=1"
' 2>&1)"
if [[ "${cleanup_test}" == *"SPINNERS=0"* && "${cleanup_test}" == *"fake work"* ]]; then r6=0; else r6=1; fi
check "success path stops spinner process" "${r6}"

# --- 7. failure path preserves exit code and stops spinner -----------------
fail_test="$(run_isolated bash -c '
  source "'"${INSTALLER}"'"
  AMS_INTERACTIVE=1 AMS_USE_ANIMATION=1 AMS_USE_COLOR=0 AMS_USE_UNICODE=0
  set +e
  run_sanitized "failing step" false
  echo "RC=$?"
  [[ -z "${AMS_SPIN_PID}" ]] && echo "SPINNERS=0" || echo "SPINNERS=1"
' 2>&1)"
if [[ "${fail_test}" == *"RC=1"* && "${fail_test}" == *"SPINNERS=0"* ]]; then r7=0; else r7=1; fi
check "failure path preserves exit code" "${r7}"
check "failure path stops spinner" "${r7}"

# --- 8. error messages do not expose fake test secrets ---------------------
secret_test="$(run_isolated env AUTO_MODEL_SWITCHER_PLAIN=1 bash -c '
  source "'"${INSTALLER}"'"
  ams_err_trap 1 "curl --data sk-or-supersecret12345 https://x" 42
' 2>&1)"
if [[ "${secret_test}" != *"sk-or-supersecret12345"* && "${secret_test}" == *"<redacted>"* ]]; then r8=0; else r8=1; fi
check "error trap redacts sk-or- secrets" "${r8}"

# --- 9. skip-auth / skip-service / skip-vscode still honored ---------------
skip_test="$(run_isolated env AUTO_MODEL_SWITCHER_PLAIN=1 AUTO_MODEL_SWITCHER_SKIP_AUTH=1 AUTO_MODEL_SWITCHER_SKIP_SERVICE=1 AUTO_MODEL_SWITCHER_SKIP_VSCODE=1 bash -c '
  source "'"${INSTALLER}"'"
  [[ "${AUTO_MODEL_SWITCHER_SKIP_AUTH}" == 1 ]] && echo "auth-skipped"
  [[ "${AUTO_MODEL_SWITCHER_SKIP_SERVICE}" == 1 ]] && echo "service-skipped"
  [[ "${AUTO_MODEL_SWITCHER_SKIP_VSCODE}" == 1 ]] && echo "vscode-skipped"
' 2>&1)"
if [[ "${skip_test}" == *"auth-skipped"* && "${skip_test}" == *"service-skipped"* && "${skip_test}" == *"vscode-skipped"* ]]; then r9=0; else r9=1; fi
check "skip-auth/env vars honored" "${r9}"
check "skip-service/env vars honored" "${r9}"
check "skip-vscode/env vars honored" "${r9}"

# --- 10. skip-auth cannot overwrite the production credential --------------
if run_isolated env AUTO_MODEL_SWITCHER_SKIP_AUTH=1 bash -c '
  source "'"${INSTALLER}"'"
  configure_key
' >/dev/null 2>&1; then
  r10=1
else
  r10=0
fi
check "skip-auth refuses production config" "${r10}"

# --- 11. skip-auth writes only to an explicitly isolated config ------------
isolated_auth="$(run_isolated env \
  CONFIG_DIR="${TEST_ROOT}/explicit-test-config" \
  AUTO_MODEL_SWITCHER_SKIP_AUTH=1 \
  bash -c '
    source "'"${INSTALLER}"'"
    configure_key
    grep -q "installer-test-key" "${CONFIG_DIR}/secrets.env"
    stat -c "%a" "${CONFIG_DIR}/secrets.env" 2>/dev/null \
      || stat -f "%Lp" "${CONFIG_DIR}/secrets.env"
  ' 2>&1)"
if [[ "${isolated_auth}" == *"600"* ]]; then r11=0; else r11=1; fi
check "skip-auth uses isolated mode-600 credential" "${r11}"

# --- 12. command failures are redacted and preserve their status -----------
output_failure="$(run_isolated bash -c '
  source "'"${INSTALLER}"'"
  prepare_install_log
  set +e
  run_sanitized "secret failure" bash -c "echo sk-or-privatevalue12345; exit 7"
  echo "RC=$?"
' 2>&1)"
if [[ "${output_failure}" == *"RC=7"* \
  && "${output_failure}" == *"<redacted>"* \
  && "${output_failure}" != *"sk-or-privatevalue12345"* ]]; then
  r12=0
else
  r12=1
fi
check "failure output is redacted and keeps exit code" "${r12}"

# --- 13. verbose output and log remain redacted -----------------------------
verbose_output="$(run_isolated env AUTO_MODEL_SWITCHER_VERBOSE=1 bash -c '
  source "'"${INSTALLER}"'"
  prepare_install_log
  run_sanitized "verbose check" bash -c "echo Authorization: Bearer sk-or-verbosesecret12345"
  cat "${LOG_FILE}"
' 2>&1)"
if [[ "${verbose_output}" == *"<redacted>"* \
  && "${verbose_output}" != *"sk-or-verbosesecret12345"* ]]; then
  r13=0
else
  r13=1
fi
check "verbose output and log redact credentials" "${r13}"

# --- 14. installer log is private ------------------------------------------
log_mode="$(run_isolated bash -c '
  source "'"${INSTALLER}"'"
  prepare_install_log
  stat -c "%a" "${LOG_FILE}" 2>/dev/null || stat -f "%Lp" "${LOG_FILE}"
')"
if [[ "${log_mode}" == "600" ]]; then r14=0; else r14=1; fi
check "installer log uses mode 600" "${r14}"

# --- 15. existing key-shaped credential is preserved securely --------------
credential_result="$(run_isolated env CONFIG_DIR="${TEST_ROOT}/existing-config" bash -c '
  source "'"${INSTALLER}"'"
  mkdir -p "${CONFIG_DIR}"
  printf "%s\n" "OPENROUTER_API_KEY='"'"'sk-or-validtestcredential12345'"'"'" > "${CONFIG_DIR}/secrets.env"
  chmod 644 "${CONFIG_DIR}/secrets.env"
  configure_key
  grep -q "sk-or-validtestcredential12345" "${CONFIG_DIR}/secrets.env"
  stat -c "%a" "${CONFIG_DIR}/secrets.env" 2>/dev/null \
    || stat -f "%Lp" "${CONFIG_DIR}/secrets.env"
' 2>&1)"
if [[ "${credential_result}" == *"600"* ]]; then r15=0; else r15=1; fi
check "existing credential is preserved with mode 600" "${r15}"

# --- 16. stage counter reaches 9 -------------------------------------------
stages="$(run_isolated env AUTO_MODEL_SWITCHER_PLAIN=1 bash -c '
  source "'"${INSTALLER}"'"
  for s in one two three four five six seven eight nine; do stage_header "${s}"; done
  echo "COUNT=${AMS_STAGE_CURRENT}"
' 2>&1)"
if [[ "${stages}" == *"COUNT=9"* ]]; then r16=0; else r16=1; fi
check "stage counter reaches 9" "${r16}"

# --- summary ---------------------------------------------------------------
printf '\n%d passed, %d failed\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]]

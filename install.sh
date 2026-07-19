#!/usr/bin/env bash
#
# Auto Model Switcher — installer
#
# Modern, polished, safe installer for the Auto Model Switcher stack:
#   * private Node.js runtime (when needed)
#   * pinned & patched FreeRouter build
#   * OpenRouter authorization
#   * free-model discovery
#   * systemd / launchd background service
#   * VS Code language-model provider
#
# Presentation is kept separate from installation logic. Colors, Unicode
# decorations, and animation are used only when stdout is an interactive TTY.
# Plain mode and TERM=dumb disable presentation; NO_COLOR disables color.
#
set -Eeuo pipefail

APP_NAME="auto-model-switcher"
NODE_VERSION="22.17.0"
FREEROUTER_REPOSITORY="https://github.com/openfreerouter/freerouter.git"
FREEROUTER_COMMIT="641623e0315f1a62cfb4a46e4ce3471746012f72"

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
INSTALL_DIR="${DATA_HOME}/${APP_NAME}"
CONFIG_DIR="${CONFIG_DIR:-${CONFIG_HOME}/${APP_NAME}}"
BIN_DIR="${HOME}/.local/bin"
RUNTIME_DIR="${INSTALL_DIR}/runtime"
LOG_DIR="${CONFIG_DIR}/logs"
LOG_FILE="${LOG_DIR}/install.log"

# ---------------------------------------------------------------------------
# Presentation layer
# ---------------------------------------------------------------------------

# Terminal capability detection.
AMS_INTERACTIVE=0
AMS_USE_COLOR=0
AMS_USE_UNICODE=0
AMS_USE_ANIMATION=0
if [[ -t 1 ]]; then
  AMS_INTERACTIVE=1
  if [[ "${TERM:-}" != "dumb" && "${AUTO_MODEL_SWITCHER_PLAIN:-0}" != "1" ]]; then
    AMS_USE_ANIMATION=1
    [[ -z "${NO_COLOR:-}" ]] && AMS_USE_COLOR=1
    # Unicode box drawing is widely supported; fall back to ASCII if locale
    # looks like a pure C/POSIX environment.
    case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
      ""|C|C.*|POSIX) AMS_USE_UNICODE=0 ;;
      *) AMS_USE_UNICODE=1 ;;
    esac
  fi
fi

# Color initialization (no-op unless colors are enabled).
if [[ "${AMS_USE_COLOR}" -eq 1 ]]; then
  if command -v tput >/dev/null 2>&1; then
    AMS_BOLD="$(tput bold 2>/dev/null || true)"
    AMS_DIM="$(tput dim 2>/dev/null || true)"
    AMS_RESET="$(tput sgr0 2>/dev/null || printf '\033[0m')"
    AMS_RED="$(tput setaf 1 2>/dev/null || printf '\033[31m')"
    AMS_GREEN="$(tput setaf 2 2>/dev/null || printf '\033[32m')"
    AMS_YELLOW="$(tput setaf 3 2>/dev/null || printf '\033[33m')"
    AMS_BLUE="$(tput setaf 4 2>/dev/null || printf '\033[34m')"
    AMS_CYAN="$(tput setaf 6 2>/dev/null || printf '\033[36m')"
  else
    AMS_RESET=$'\033[0m'
    AMS_BOLD=$'\033[1m'
    AMS_DIM=$'\033[2m'
    AMS_RED=$'\033[31m'
    AMS_GREEN=$'\033[32m'
    AMS_YELLOW=$'\033[33m'
    AMS_BLUE=$'\033[34m'
    AMS_CYAN=$'\033[36m'
  fi
else
  AMS_RESET=""
  AMS_BOLD=""
  AMS_DIM=""
  AMS_RED=""
  AMS_GREEN=""
  AMS_YELLOW=""
  AMS_BLUE=""
  AMS_CYAN=""
fi

# Glyphs (chosen so plain/ASCII mode stays readable).
if [[ "${AMS_USE_UNICODE}" -eq 1 ]]; then
  GLYPH_OK="✓"
  GLYPH_WARN="!"
  GLYPH_FAIL="✗"
  GLYPH_INFO="i"
  GLYPH_ARROW="→"
  GLYPH_BULLET="•"
  SPIN_FRAMES=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
else
  GLYPH_OK="OK"
  GLYPH_WARN="!!"
  GLYPH_FAIL="XX"
  GLYPH_INFO=".."
  GLYPH_ARROW="->"
  GLYPH_BULLET="*"
  SPIN_FRAMES=("|" "/" "-" "\\")
fi

AMS_VERBOSE="${AUTO_MODEL_SWITCHER_VERBOSE:-0}"

sanitize_text() {
  sed -E \
    -e 's/(sk-or-|Bearer )[A-Za-z0-9._-]+/\1<redacted>/g' \
    -e 's/(Authorization:)[[:space:]]*[^[:space:]]+/\1 <redacted>/Ig'
}

# --- logging primitives -----------------------------------------------------

# Raw line to the log file (always, no decorations).
raw_log() {
  [[ -d "${LOG_DIR}" ]] || return 0
  printf '[%s] %s\n' "$(date +'%Y-%m-%dT%H:%M:%S')" "$*" >> "${LOG_FILE}" 2>/dev/null || true
}

prepare_install_log() {
  umask 077
  mkdir -p "${LOG_DIR}"
  : > "${LOG_FILE}"
  chmod 600 "${LOG_FILE}"
}

# Visible informational line.
info() {
  printf '%s[%s]%s %s\n' "${AMS_BLUE}${AMS_BOLD}" "${GLYPH_INFO}" "${AMS_RESET}" "$*"
  raw_log "INFO: $*"
}

success() {
  printf '%s[%s]%s %s\n' "${AMS_GREEN}${AMS_BOLD}" "${GLYPH_OK}" "${AMS_RESET}" "$*"
  raw_log "OK: $*"
}

warn() {
  printf '%s[%s]%s %s\n' "${AMS_YELLOW}${AMS_BOLD}" "${GLYPH_WARN}" "${AMS_RESET}" "$*"
  raw_log "WARN: $*"
}

fatal() {
  printf '%s[%s]%s %s\n' "${AMS_RED}${AMS_BOLD}" "${GLYPH_FAIL}" "${AMS_RESET}" "$*" >&2
  raw_log "FATAL: $*"
}

# --- stage display ----------------------------------------------------------

AMS_STAGE_COUNT=9
AMS_STAGE_CURRENT=0

stage_header() {
  AMS_STAGE_CURRENT=$((AMS_STAGE_CURRENT + 1))
  local title="$1"
  local pad
  pad="$(printf '%02d' "${AMS_STAGE_CURRENT}")/$(printf '%02d' "${AMS_STAGE_COUNT}")"
  printf '\n%s%s%s %s\n' "${AMS_CYAN}${AMS_BOLD}" "${pad}" "${AMS_RESET}" "${AMS_BOLD}${title}${AMS_RESET}"
  raw_log "STAGE ${pad}: ${title}"
}

# --- spinner lifecycle ------------------------------------------------------

AMS_SPIN_PID=""
AMS_SPIN_LABEL=""

_spin_start() {
  AMS_SPIN_LABEL="$1"
  if [[ "${AMS_USE_ANIMATION}" -ne 1 || "${AMS_VERBOSE}" -eq 1 ]]; then
    # Non-interactive or verbose: just print the label once.
    if [[ "${AMS_VERBOSE}" -eq 1 ]]; then
      printf '%s%s%s\n' "${AMS_DIM}" "${AMS_SPIN_LABEL}" "${AMS_RESET}"
    fi
    return
  fi
  # Start a background spinner process.
  (
    local i=0
    local frame
    while true; do
      frame="${SPIN_FRAMES[$((i % ${#SPIN_FRAMES[@]}))]}"
      printf '\r%s%s%s %s' "${AMS_CYAN}" "${frame}" "${AMS_RESET}" "${AMS_SPIN_LABEL}"
      i=$((i + 1))
      sleep 0.12
    done
  ) &
  AMS_SPIN_PID=$!
}

_spin_stop() {
  if [[ -n "${AMS_SPIN_PID}" ]]; then
    kill "${AMS_SPIN_PID}" 2>/dev/null || true
    wait "${AMS_SPIN_PID}" 2>/dev/null || true
    AMS_SPIN_PID=""
    # Clear the spinner line.
    printf '\r%*s\r' "$(tput cols 2>/dev/null || echo 80)" ""
  fi
}

cleanup_presentation() {
  _spin_stop
}

# --- elapsed time -----------------------------------------------------------

ams_elapsed() {
  local start="$1" now
  now="$(date +%s)"
  local secs=$((now - start))
  printf '%dm%02ds' "$((secs / 60))" "$((secs % 60))"
}

# --- sanitized command execution -------------------------------------------

# run_sanitized <description> <command...>
# Runs a command, streaming safe output to the log file, and (in verbose mode)
# to the terminal. On failure the spinner is stopped and a sanitized error is
# shown. Never echoes secrets.
run_sanitized() {
  local desc="$1"
  shift
  _spin_start "${desc}"
  local start
  start="$(date +%s)"
  local rc=0 command_log safe_desc
  command_log="$(mktemp "${TMPDIR:-/tmp}/ams-command.XXXXXX")"
  safe_desc="$*"
  # Redact anything that looks like a secret token in the description.
  safe_desc="$(printf '%s' "${safe_desc}" | sed -E 's/(sk-or-|Bearer )[A-Za-z0-9._-]+/<redacted>/g')"

  if [[ "${AMS_VERBOSE}" -eq 1 ]]; then
    "$@" 2>&1 | sanitize_text | tee -a "${LOG_FILE}" "${command_log}" || rc=${PIPESTATUS[0]}
  else
    "$@" > "${command_log}" 2>&1 || rc=$?
    sanitize_text < "${command_log}" >> "${LOG_FILE}"
  fi

  _spin_stop
  local elapsed
  elapsed="$(ams_elapsed "${start}")"
  if [[ "${rc}" -eq 0 ]]; then
    if [[ "${AMS_INTERACTIVE}" -eq 1 ]]; then
      printf '%s[%s]%s %s %s(%s)%s\n' \
        "${AMS_GREEN}${AMS_BOLD}" "${GLYPH_OK}" "${AMS_RESET}" \
        "${desc}" "${AMS_DIM}" "${elapsed}" "${AMS_RESET}"
    fi
    raw_log "OK (${elapsed}): ${safe_desc}"
  else
    raw_log "FAIL(${rc}, ${elapsed}): ${safe_desc}"
    fatal "${desc} failed (exit ${rc}). Recent output:"
    tail -n 20 "${command_log}" | sanitize_text | sed 's/^/    /' >&2
  fi
  rm -f -- "${command_log}"
  return "${rc}"
}

# --- banner ----------------------------------------------------------------

ams_logo() {
  if [[ "${AMS_USE_UNICODE}" -eq 1 && "${AMS_USE_COLOR}" -eq 1 ]]; then
    cat <<'EOF'

   ╔══════════════════════════════════════════════════╗
   ║   A U T O   M O D E L   S W I T C H E R            ║
   ║   local router · ranked free OpenRouter models     ║
   ╚══════════════════════════════════════════════════╝

EOF
  else
    cat <<'EOF'

   ===========================================================
    A U T O   M O D E L   S W I T C H E R
    local router - ranked free OpenRouter models
   ===========================================================

EOF
  fi
}

ams_welcome() {
  local mode_note=""
  if [[ "${AMS_INTERACTIVE}" -ne 1 ]]; then
    mode_note=" (non-interactive - plain output)"
  elif [[ "${AMS_USE_COLOR}" -ne 1 ]]; then
    mode_note=" (plain mode)"
  fi
  printf '%sWelcome to the Auto Model Switcher installer%s%s%s\n' \
    "${AMS_BOLD}" "${AMS_RESET}" "${AMS_DIM}" "${mode_note}${AMS_RESET}"
  printf 'This will install a private Node runtime, a pinned FreeRouter build,\n'
  printf 'authorize OpenRouter, discover free models, and set up the background\n'
  printf 'service plus the VS Code provider.\n'
  printf '\n'
  printf '  Install dir : %s\n' "${INSTALL_DIR}"
  printf '  Config dir  : %s\n' "${CONFIG_DIR}"
  printf '  Log file    : %s\n' "${LOG_FILE}"
  printf '\n'
}

# --- final summary ----------------------------------------------------------

ams_summary() {
  local version="$1" tiers="$2" router_url="$3" config_path="$4" service_status="$5"
  printf '\n'
  if [[ "${AMS_USE_UNICODE}" -eq 1 && "${AMS_USE_COLOR}" -eq 1 ]]; then
    printf '%s╔══════════════════════════════════════════════════════════╗%s\n' "${AMS_GREEN}" "${AMS_RESET}"
    printf '%s║%s  %sINSTALLATION COMPLETE%s                              %s║%s\n' "${AMS_GREEN}" "${AMS_RESET}" "${AMS_BOLD}" "${AMS_RESET}" "${AMS_GREEN}" "${AMS_RESET}"
    printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "${AMS_GREEN}" "${AMS_RESET}"
  else
    printf '%s============================================================%s\n' "${AMS_GREEN}" "${AMS_RESET}"
    printf '%s  INSTALLATION COMPLETE%s\n' "${AMS_BOLD}" "${AMS_RESET}"
    printf '%s============================================================%s\n' "${AMS_GREEN}" "${AMS_RESET}"
  fi
  printf '\n'
  printf '  %sExtension version%s : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${version}"
  printf '  %sActive tiers%s       : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${tiers}"
  printf '  %sRouter URL%s         : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${router_url}"
  printf '  %sConfig path%s        : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${config_path}"
  printf '  %sService status%s     : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${service_status}"
  printf '\n'
  printf '  %sNext steps%s\n' "${AMS_BOLD}" "${AMS_RESET}"
  printf '    %s reload VS Code, then open Chat and pick "Auto Model Switcher".\n' "${GLYPH_ARROW}"
  printf '    %s auto-model-switcher status\n' "${GLYPH_BULLET}"
  printf '    %s auto-model-switcher doctor\n' "${GLYPH_BULLET}"
  printf '    %s auto-model-switcher update-models\n' "${GLYPH_BULLET}"
  printf '\n'
  printf '  %sAdd %s to your PATH if your shell has not picked it up yet.%s\n' "${AMS_DIM}" "${BIN_DIR}" "${AMS_RESET}"
  printf '\n'
}

# ---------------------------------------------------------------------------
# Error trap
# ---------------------------------------------------------------------------

AMS_FAILED_STAGE="(unknown)"
ams_err_trap() {
  local rc="$1" cmd="$2" line="$3"
  _spin_stop
  # Sanitize the command: redact secrets / tokens.
  local safe_cmd
  safe_cmd="$(printf '%s' "${cmd}" | sed -E 's/(sk-or-|Bearer )[A-Za-z0-9._-]+/<redacted>/g; s/=([A-Za-z0-9._-]{8,})/=<redacted>/g')"
  printf '\n%s[%s]%s Installation failed%s\n' "${AMS_RED}${AMS_BOLD}" "${GLYPH_FAIL}" "${AMS_RESET}" "${AMS_RED}" "${AMS_RESET}"
  printf '  %sStage%s     : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${AMS_FAILED_STAGE}"
  printf '  %sCommand%s   : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${safe_cmd}"
  printf '  %sExit code%s : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${rc}"
  printf '  %sLog file%s  : %s\n' "${AMS_DIM}" "${AMS_RESET}" "${LOG_FILE}"
  printf '  %sRecover%s   : review the log, fix the reported issue, then rerun ./install.sh\n' "${AMS_DIM}" "${AMS_RESET}"
  raw_log "FAILED stage=${AMS_FAILED_STAGE} cmd=${safe_cmd} rc=${rc} line=${line}"
}

# ---------------------------------------------------------------------------
# Installation layer
# ---------------------------------------------------------------------------

die() { fatal "$*"; exit 1; }

platform() {
  case "$(uname -s)" in
    Linux) printf 'linux' ;;
    Darwin) printf 'darwin' ;;
    *) die "Only Linux and macOS are supported" ;;
  esac
}

architecture() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    arm64|aarch64) printf 'arm64' ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

private_node_is_usable() {
  [[ -x "${RUNTIME_DIR}/node/bin/node" ]] || return 1
  local major
  major="$("${RUNTIME_DIR}/node/bin/node" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  [[ "${major:-0}" -ge 20 ]]
}

install_node_runtime() {
  if private_node_is_usable; then
    export PATH="${RUNTIME_DIR}/node/bin:${PATH}"
    info "Node.js runtime already present ($(node -v 2>/dev/null || echo 'managed'))"
    return
  fi

  local os arch archive base_url expected actual tmp_dir
  os="$(platform)"
  arch="$(architecture)"
  archive="node-v${NODE_VERSION}-${os}-${arch}.tar.xz"
  base_url="https://nodejs.org/dist/v${NODE_VERSION}"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/auto-model-switcher-node.XXXXXX")"

  info "Downloading private Node.js ${NODE_VERSION} runtime"
  run_sanitized "Fetching Node.js checksums" \
    curl -fsSL "${base_url}/SHASUMS256.txt" -o "${tmp_dir}/SHASUMS256.txt"
  run_sanitized "Downloading Node.js archive" \
    curl -fL "${base_url}/${archive}" -o "${tmp_dir}/${archive}"

  expected="$(awk -v file="${archive}" '$2 == file {print $1}' "${tmp_dir}/SHASUMS256.txt")"
  [[ -n "${expected}" ]] || die "Node.js checksum not found"
  actual="$(sha256_file "${tmp_dir}/${archive}")"
  [[ "${actual}" == "${expected}" ]] || die "Node.js checksum mismatch"

  rm -rf -- "${RUNTIME_DIR}/node"
  mkdir -p "${RUNTIME_DIR}/node"
  run_sanitized "Extracting Node.js runtime" \
    tar -xJf "${tmp_dir}/${archive}" --strip-components=1 -C "${RUNTIME_DIR}/node"
  export PATH="${RUNTIME_DIR}/node/bin:${PATH}"
  rm -rf -- "${tmp_dir}"
}

copy_application() {
  info "Installing application files"
  mkdir -p "${INSTALL_DIR}" "${CONFIG_DIR}" "${BIN_DIR}" "${LOG_DIR}"
  for path in bin scripts patches README.md LICENSE; do
    rm -rf -- "${INSTALL_DIR:?}/${path}"
    cp -R "${SOURCE_DIR}/${path}" "${INSTALL_DIR}/${path}"
  done
  rm -rf -- "${INSTALL_DIR}/vscode-extension"
  mkdir -p "${INSTALL_DIR}/vscode-extension"
  for path in extension.js package.json package-lock.json README.md LICENSE .vscodeignore src; do
    cp -R "${SOURCE_DIR}/vscode-extension/${path}" "${INSTALL_DIR}/vscode-extension/${path}"
  done
  chmod +x "${INSTALL_DIR}/bin/auto-model-switcher"
  ln -sfn "${INSTALL_DIR}/bin/auto-model-switcher" "${BIN_DIR}/auto-model-switcher"
}

capture_network_environment() {
  local destination="${CONFIG_DIR}/network.env"
  local temporary="${destination}.tmp-$$"
  local name value found=0
  umask 077
  : > "${temporary}"
  for name in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; do
    value="${!name:-}"
    if [[ -n "${value}" ]]; then
      printf '%s=%q\n' "${name}" "${value}" >> "${temporary}"
      found=1
    fi
  done
  if [[ "${found}" -eq 1 || ! -e "${destination}" ]]; then
    mv "${temporary}" "${destination}"
    chmod 600 "${destination}"
    [[ "${found}" -eq 1 ]] && info "Captured proxy settings into network.env"
  else
    rm -f -- "${temporary}"
  fi
}

install_freerouter() {
  local target="${INSTALL_DIR}/freerouter"
  local staging="${INSTALL_DIR}/freerouter.new"
  info "Building FreeRouter at pinned commit ${FREEROUTER_COMMIT:0:12}"
  rm -rf -- "${staging}"
  run_sanitized "Cloning FreeRouter repository" \
    git clone --quiet "${FREEROUTER_REPOSITORY}" "${staging}"
  run_sanitized "Checking out pinned FreeRouter commit" \
    git -C "${staging}" checkout --quiet --detach "${FREEROUTER_COMMIT}"
  run_sanitized "Applying FreeRouter VS Code patch" \
    git -C "${staging}" apply --check "${INSTALL_DIR}/patches/freerouter-vscode.patch"
  run_sanitized "Installing FreeRouter VS Code patch" \
    git -C "${staging}" apply "${INSTALL_DIR}/patches/freerouter-vscode.patch"
  # Upstream's lockfile is currently stale. npm install reconciles it inside the
  # managed dependency checkout; the git commit still pins all source code.
  run_sanitized "Installing FreeRouter dependencies" \
    npm --prefix "${staging}" install --ignore-scripts
  run_sanitized "Pinning undici for FreeRouter" \
    npm --prefix "${staging}" install --ignore-scripts --save-exact undici@7.28.0
  run_sanitized "Building FreeRouter" \
    npm --prefix "${staging}" run build --if-present
  if [[ ! -f "${staging}/dist/server.js" ]]; then
    run_sanitized "Compiling FreeRouter (tsc fallback)" bash -c "cd '${staging}' && npx tsc"
  fi
  [[ -f "${staging}/dist/server.js" ]] || die "FreeRouter build did not produce dist/server.js"
  rm -rf -- "${target}"
  mv "${staging}" "${target}"
}

configure_key() {
  local secrets="${CONFIG_DIR}/secrets.env"
  mkdir -p "${CONFIG_DIR}"
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_AUTH:-0}" == "1" ]]; then
    local production_config="${CONFIG_HOME}/${APP_NAME}"
    [[ "${CONFIG_DIR}" != "${production_config}" ]] ||
      die "AUTO_MODEL_SWITCHER_SKIP_AUTH requires an isolated CONFIG_DIR"
    umask 077
    printf "OPENROUTER_API_KEY='installer-test-key'\n" > "${secrets}"
    warn "Skipping OpenRouter authorization (test key written)"
    return
  fi
  if [[ -s "${secrets}" ]] \
    && grep -Eq "^OPENROUTER_API_KEY='sk-or-[A-Za-z0-9._-]+'$" "${secrets}"; then
    chmod 600 "${secrets}"
    info "Keeping existing OpenRouter API key"
    return
  fi

  if [[ -e "${secrets}" ]]; then
    warn "Stored OpenRouter credential is invalid; authorization is required"
  fi

  info "Opening OpenRouter authorization"
  if ! node "${INSTALL_DIR}/scripts/openrouter-auth.mjs" "${secrets}"; then
    warn "Browser authorization failed. Starting manual key entry"
    "${INSTALL_DIR}/bin/auto-model-switcher" configure --manual
  fi
}

install_service() {
  info "Installing background service and daily model refresh"
  run_sanitized "Registering systemd/launchd service" \
    "${INSTALL_DIR}/bin/auto-model-switcher" install-service
}

install_vscode_extension() {
  if ! command -v code >/dev/null 2>&1; then
    warn "VS Code CLI not found. Later run: auto-model-switcher install-vscode"
    return
  fi
  info "Installing VS Code language-model provider"
  run_sanitized "Building and installing VS Code provider" \
    "${INSTALL_DIR}/bin/auto-model-switcher" install-vscode
}

# Read active tier model ids from models.json (no secrets).
read_active_tiers() {
  local meta="${CONFIG_DIR}/models.json"
  [[ -f "${meta}" ]] || { printf '(unknown)'; return; }
  node -e '
    try {
      const m = require(process.argv[1]);
      const tiers = ["simple","medium","complex","reasoning"];
      const out = tiers.map(t => (m.tiers && m.tiers[t] && m.tiers[t].primary) ? m.tiers[t].primary : "?").join(", ");
      process.stdout.write(out);
    } catch { process.stdout.write("(unknown)"); }
  ' "${meta}" 2>/dev/null || printf '(unknown)'
}

extension_version() {
  node -e '
    try {
      process.stdout.write(require(process.argv[1]).version ?? "unknown");
    } catch { process.stdout.write("unknown"); }
  ' "${INSTALL_DIR}/vscode-extension/package.json" 2>/dev/null || printf 'unknown'
}

service_status_text() {
  case "$(uname -s)" in
    Linux)
      if systemctl --user --quiet is-active "${APP_NAME}.service" 2>/dev/null; then
        printf 'running (systemd)'
      else
        printf 'installed (systemd, not active)'
      fi
      ;;
    Darwin)
      if launchctl print "gui/$(id -u)/io.github.auto-model-switcher.router" >/dev/null 2>&1; then
        printf 'installed (launchd)'
      else
        printf 'installed (launchd, not loaded)'
      fi
      ;;
    *) printf 'unknown' ;;
  esac
}

health_verify() {
  info "Verifying installation health"
  run_sanitized "Running installation doctor" \
    "${INSTALL_DIR}/bin/auto-model-switcher" doctor
  success "Health check passed"
}

main() {
  # Prepare log directory early so the trap can reference it.
  prepare_install_log

  # Wire up the ERR trap. AMS_FAILED_STAGE is set before each stage so the
  # diagnostic points at the right place.
  trap 'rc=$?; cmd="${BASH_COMMAND}"; ams_err_trap "${rc}" "${cmd}" "${LINENO}"' ERR
  trap cleanup_presentation EXIT
  trap 'cleanup_presentation; exit 130' INT
  trap 'cleanup_presentation; exit 143' TERM

  local os arch tiers router_url config_path service_status

  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v git >/dev/null 2>&1 || die "git is required"

  ams_logo
  ams_welcome

  AMS_FAILED_STAGE="System check";             stage_header "System check"
  os="$(platform)"
  arch="$(architecture)"
  info "OS: ${os} / ${arch}; shell: ${BASH_VERSION%%-*}"

  AMS_FAILED_STAGE="Runtime installation";     stage_header "Runtime installation"
  install_node_runtime
  command -v npm >/dev/null 2>&1 || die "npm is missing from the managed Node.js runtime"

  AMS_FAILED_STAGE="Application files";        stage_header "Application files"
  copy_application
  capture_network_environment

  AMS_FAILED_STAGE="FreeRouter build";         stage_header "FreeRouter build"
  export PATH="${RUNTIME_DIR}/node/bin:${BIN_DIR}:${PATH}"
  install_freerouter

  AMS_FAILED_STAGE="OpenRouter authorization"; stage_header "OpenRouter authorization"
  configure_key

  AMS_FAILED_STAGE="Free-model discovery";     stage_header "Free-model discovery"
  info "Discovering free OpenRouter models"
  run_sanitized "Ranking free models into tiers" \
    node "${INSTALL_DIR}/scripts/update-models.mjs" --config-dir "${CONFIG_DIR}"

  AMS_FAILED_STAGE="Background service";       stage_header "Background service"
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_SERVICE:-0}" != "1" ]]; then
    install_service
  else
    warn "Skipping background service (AUTO_MODEL_SWITCHER_SKIP_SERVICE=1)"
  fi

  AMS_FAILED_STAGE="VS Code extension";        stage_header "VS Code extension"
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_VSCODE:-0}" != "1" ]]; then
    install_vscode_extension
  else
    warn "Skipping VS Code extension (AUTO_MODEL_SWITCHER_SKIP_VSCODE=1)"
  fi

  AMS_FAILED_STAGE="Health verification";      stage_header "Health verification"
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_SERVICE:-0}" != "1" ]]; then
    health_verify
  else
    warn "Skipping router health check because service installation was skipped"
  fi

  tiers="$(read_active_tiers)"
  router_url="http://127.0.0.1:${AUTO_MODEL_SWITCHER_PORT:-18800}"
  config_path="${CONFIG_DIR}"
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_SERVICE:-0}" == "1" ]]; then
    service_status="skipped"
  else
    service_status="$(service_status_text)"
  fi

  ams_summary "$(extension_version)" "${tiers}" "${router_url}" "${config_path}" "${service_status}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

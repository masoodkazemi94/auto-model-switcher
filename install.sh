#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="auto-model-switcher"
NODE_VERSION="22.17.0"
FREEROUTER_REPOSITORY="https://github.com/openfreerouter/freerouter.git"
FREEROUTER_COMMIT="641623e0315f1a62cfb4a46e4ce3471746012f72"

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
INSTALL_DIR="${DATA_HOME}/${APP_NAME}"
CONFIG_DIR="${CONFIG_HOME}/${APP_NAME}"
BIN_DIR="${HOME}/.local/bin"
RUNTIME_DIR="${INSTALL_DIR}/runtime"

log() { printf '[auto-model-switcher] %s\n' "$*"; }
die() { printf '[auto-model-switcher] error: %s\n' "$*" >&2; exit 1; }

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
    return
  fi

  local os arch archive base_url expected actual tmp_dir
  os="$(platform)"
  arch="$(architecture)"
  archive="node-v${NODE_VERSION}-${os}-${arch}.tar.xz"
  base_url="https://nodejs.org/dist/v${NODE_VERSION}"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/auto-model-switcher-node.XXXXXX")"

  log "Installing private Node.js ${NODE_VERSION} runtime"
  curl -fsSL "${base_url}/SHASUMS256.txt" -o "${tmp_dir}/SHASUMS256.txt"
  curl -fL "${base_url}/${archive}" -o "${tmp_dir}/${archive}"
  expected="$(awk -v file="${archive}" '$2 == file {print $1}' "${tmp_dir}/SHASUMS256.txt")"
  [[ -n "${expected}" ]] || die "Node.js checksum not found"
  actual="$(sha256_file "${tmp_dir}/${archive}")"
  [[ "${actual}" == "${expected}" ]] || die "Node.js checksum mismatch"

  rm -rf -- "${RUNTIME_DIR}/node"
  mkdir -p "${RUNTIME_DIR}/node"
  tar -xJf "${tmp_dir}/${archive}" --strip-components=1 -C "${RUNTIME_DIR}/node"
  export PATH="${RUNTIME_DIR}/node/bin:${PATH}"
  rm -rf -- "${tmp_dir}"
}

copy_application() {
  log "Installing application files"
  mkdir -p "${INSTALL_DIR}" "${CONFIG_DIR}" "${BIN_DIR}"
  for path in bin scripts patches README.md LICENSE; do
    rm -rf -- "${INSTALL_DIR:?}/${path}"
    cp -R "${SOURCE_DIR}/${path}" "${INSTALL_DIR}/${path}"
  done
  rm -rf -- "${INSTALL_DIR}/vscode-extension"
  mkdir -p "${INSTALL_DIR}/vscode-extension"
  for path in extension.js package.json package-lock.json LICENSE .vscodeignore src; do
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
  else
    rm -f -- "${temporary}"
  fi
}

install_freerouter() {
  local target="${INSTALL_DIR}/freerouter"
  local staging="${INSTALL_DIR}/freerouter.new"
  log "Installing FreeRouter at pinned commit ${FREEROUTER_COMMIT:0:12}"
  rm -rf -- "${staging}"
  git clone --quiet "${FREEROUTER_REPOSITORY}" "${staging}"
  git -C "${staging}" checkout --quiet --detach "${FREEROUTER_COMMIT}"
  git -C "${staging}" apply --check "${INSTALL_DIR}/patches/freerouter-vscode.patch"
  git -C "${staging}" apply "${INSTALL_DIR}/patches/freerouter-vscode.patch"
  # Upstream's lockfile is currently stale. npm install reconciles it inside the
  # managed dependency checkout; the git commit still pins all source code.
  npm --prefix "${staging}" install --ignore-scripts
  npm --prefix "${staging}" install --ignore-scripts --save-exact undici@7.28.0
  npm --prefix "${staging}" run build --if-present
  if [[ ! -f "${staging}/dist/server.js" ]]; then
    (cd "${staging}" && npx tsc)
  fi
  [[ -f "${staging}/dist/server.js" ]] || die "FreeRouter build did not produce dist/server.js"
  rm -rf -- "${target}"
  mv "${staging}" "${target}"
}

configure_key() {
  local secrets="${CONFIG_DIR}/secrets.env"
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_AUTH:-0}" == "1" ]]; then
    umask 077
    printf "OPENROUTER_API_KEY='installer-test-key'\n" > "${secrets}"
    return
  fi
  if [[ -s "${secrets}" ]] && grep -q '^OPENROUTER_API_KEY=' "${secrets}"; then
    log "Keeping existing OpenRouter API key"
    return
  fi

  log "Opening OpenRouter authorization"
  if ! node "${INSTALL_DIR}/scripts/openrouter-auth.mjs" "${secrets}"; then
    log "Browser authorization failed. Starting manual key entry"
    "${INSTALL_DIR}/bin/auto-model-switcher" configure --manual
  fi
}

install_service() {
  log "Installing background service and daily model refresh"
  "${INSTALL_DIR}/bin/auto-model-switcher" install-service
}

install_vscode_extension() {
  if ! command -v code >/dev/null 2>&1; then
    log "VS Code CLI not found. Later run: auto-model-switcher install-vscode"
    return
  fi
  log "Installing VS Code language-model provider"
  "${INSTALL_DIR}/bin/auto-model-switcher" install-vscode
}

main() {
  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v git >/dev/null 2>&1 || die "git is required"
  install_node_runtime
  copy_application
  capture_network_environment
  export PATH="${RUNTIME_DIR}/node/bin:${BIN_DIR}:${PATH}"
  install_freerouter
  configure_key
  node "${INSTALL_DIR}/scripts/update-models.mjs" --config-dir "${CONFIG_DIR}"
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_SERVICE:-0}" != "1" ]]; then
    install_service
  fi
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_VSCODE:-0}" != "1" ]]; then
    install_vscode_extension
  fi
  if [[ "${AUTO_MODEL_SWITCHER_SKIP_SERVICE:-0}" != "1" ]]; then
    "${INSTALL_DIR}/bin/auto-model-switcher" doctor
  fi

  log "Installed. Add ${BIN_DIR} to PATH if needed."
  log "Open VS Code Chat and select 'Auto Model Switcher'."
}

main "$@"

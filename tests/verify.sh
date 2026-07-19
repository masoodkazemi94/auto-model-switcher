#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "${ROOT}/install.sh" "${ROOT}/bin/auto-model-switcher" \
  "${ROOT}/scripts/run-freerouter.sh"
"${ROOT}/tests/installer.test.sh"
node --test "${ROOT}/tests/update-models.test.mjs"
node --test "${ROOT}/vscode-extension/test/openai.test.js"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/ams-patch-test.XXXXXX")"
trap 'rm -rf -- "${tmp_dir}"' EXIT
git clone --quiet https://github.com/openfreerouter/freerouter.git "${tmp_dir}/freerouter"
git -C "${tmp_dir}/freerouter" checkout --quiet --detach 641623e0315f1a62cfb4a46e4ce3471746012f72
git -C "${tmp_dir}/freerouter" apply --check "${ROOT}/patches/freerouter-vscode.patch"
git -C "${tmp_dir}/freerouter" apply "${ROOT}/patches/freerouter-vscode.patch"
npm --prefix "${tmp_dir}/freerouter" install --ignore-scripts
npm --prefix "${tmp_dir}/freerouter" install --ignore-scripts --save-exact undici@7.28.0
npm --prefix "${tmp_dir}/freerouter" run build
node "${ROOT}/tests/freerouter-integration.mjs" "${tmp_dir}/freerouter/dist/server.js"

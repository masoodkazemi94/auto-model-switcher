#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="$1"
CONFIG_DIR="$2"

set -a
# shellcheck disable=SC1090
source "${CONFIG_DIR}/secrets.env"
set +a

export FREEROUTER_CONFIG="${CONFIG_DIR}/freerouter.config.json"
export PATH="${INSTALL_DIR}/runtime/node/bin:${PATH}"
exec node "${INSTALL_DIR}/freerouter/dist/server.js"

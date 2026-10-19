#!/usr/bin/env bash
# Copies shared/ into every *-service/shared (gitignored). tsc, vitest and the Docker
# build context read it from there, so run this after editing anything in shared/.
set -euo pipefail
cd "$(dirname "$0")/.."
for dir in *-service; do
  rm -rf "$dir/shared"
  cp -a shared "$dir/shared"
done

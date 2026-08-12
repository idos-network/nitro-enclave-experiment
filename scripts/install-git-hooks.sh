#!/usr/bin/env bash
# Symlink committed hooks into .git/hooks (keeps Git LFS hooksPath intact).
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p .git/hooks
ln -sfn ../../.githooks/pre-commit .git/hooks/pre-commit
echo "Installed .git/hooks/pre-commit -> .githooks/pre-commit"

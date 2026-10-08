#!/usr/bin/env bash
# Installs a service EIF built by GitHub Actions into $NITRO_CLI_ARTIFACTS, prints its
# sha256 + PCRs to compare with the run's job summary, then restarts the enclave with it.
# Usage: ./update-from-github.sh <enclave|entropy|facesign> [run-id]   (default: latest successful run)
# Needs: gh logged in with a PAT that has Actions: Read on the repo.
set -euo pipefail

SERVICE=${1:-}
case "$SERVICE" in
  enclave|entropy) EIF=idos-$SERVICE.eif ;;
  facesign)        EIF=idos-facetec.eif ;;   # matches facesign-service/scripts/enclave-run.ash
  *) echo "Usage: $0 <enclave|entropy|facesign> [run-id]" >&2; exit 1 ;;
esac

REPO=idos-network/nitro-enclave-experiment
WORKFLOW=$SERVICE-eif-staging.yml   # .github/workflows/<service>-eif-staging.yml
INFO=${EIF%.eif}-info.json
DEST=${NITRO_CLI_ARTIFACTS:-/var/lib/nitro_enclaves}

RUN=${2:-$(gh run list -R "$REPO" --workflow "$WORKFLOW" --status success -L1 --json databaseId -q '.[0].databaseId')}
[[ -n "$RUN" ]] || { echo "No successful run of $WORKFLOW found" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading https://github.com/$REPO/actions/runs/$RUN"
gh run download "$RUN" -R "$REPO" -D "$TMP"

SRC=$(dirname "$(find "$TMP" -name "$EIF" -print -quit)")
[[ -f "$SRC/$EIF" && -f "$SRC/$INFO" ]] || { echo "Run $RUN has no $EIF + $INFO artifact" >&2; exit 1; }

# PCRs recomputed from the downloaded file must equal what GHA measured.
echo "Verifying PCRs of $(du -h "$SRC/$EIF" | cut -f1) $EIF (describe-eif hashes the whole file)"
EXPECTED=$(jq -S .Measurements "$SRC/$INFO")
ACTUAL=$(sudo nitro-cli describe-eif --eif-path "$SRC/$EIF" | jq -S .Measurements)
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "PCR mismatch between $INFO and the downloaded $EIF, not installing" >&2
  diff <(echo "$EXPECTED") <(echo "$ACTUAL") >&2 || true
  exit 1
fi

echo "Terminating running enclaves"
sudo nitro-cli terminate-enclave --all >/dev/null || true   # fails when nothing is running

sudo install -m 0644 "$SRC/$EIF" "$SRC/$INFO" "$DEST/"

echo "Installed $DEST/$EIF from run $RUN. Compare with the job summary:"
echo "sha256 = $(sha256sum "$SRC/$EIF" | cut -d' ' -f1)"
jq -r '.Measurements | to_entries[] | "\(.key)   = \(.value)"' "$SRC/$INFO"

# Same run script the manual flow uses (allocator memory/CPU + run-enclave --attach-console).
RUN_SCRIPT=$HOME/$SERVICE-service/scripts/enclave-run.ash
echo "Starting $SERVICE enclave via $RUN_SCRIPT"
rm -rf "$TMP"   # exec skips the EXIT trap
exec bash "$RUN_SCRIPT"

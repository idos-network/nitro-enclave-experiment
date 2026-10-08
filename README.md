# Nitro experiment

## Git hooks

```bash
bash scripts/install-git-hooks.sh
```

Pre-commit runs `pnpm types`, `pnpm format`, and `pnpm test` in each `*-service`, then `npx cspell`.

## Enclave EIF from GitHub Actions

[`enclave-eif-staging.yml`](.github/workflows/enclave-eif-staging.yml) builds the
`enclave-service` EIF with the custom kernel from `aws-nitro-kernel/blobs` on every
push to `deploy_to_staging` (or manually via *Run workflow*). It uses
[idos-network/nitro-enclaves-eif-build-action](https://github.com/idos-network/nitro-enclaves-eif-build-action).

Each run uploads `idos-enclave.eif` + `idos-enclave-info.json` as the artifact
`idos-enclave-eif-<commit sha>` and prints the EIF sha256 and PCR0-2 in the job summary.
The PCRs belong to that exact file, so deploy the file, don't rebuild on the host.

### Download to the EC2 host

One-time: install `gh` and log in with a fine-grained PAT scoped to this repo with
*Actions: Read*.

```bash
sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo && sudo dnf install -y gh
gh auth login --with-token   # paste the token
```

Fetch the latest successful build into `$NITRO_CLI_ARTIFACTS` (use a run id from the
run URL instead of `$RUN` for a specific build):

```bash
RUN=$(gh run list -R idos-network/nitro-enclave-experiment --workflow "Enclave EIF (staging)" --status success -L1 --json databaseId -q '.[0].databaseId')
gh run download "$RUN" -R idos-network/nitro-enclave-experiment -D /tmp/eif-download
mv /tmp/eif-download/*/idos-enclave.eif /tmp/eif-download/*/idos-enclave-info.json "$NITRO_CLI_ARTIFACTS/"
rm -rf /tmp/eif-download
```

Verify the PCRs match the job summary, then start it with `enclave-service/scripts/enclave-run.ash`
as usual (`enclave-build.ash` is not needed on the host):

```bash
sudo nitro-cli describe-eif --eif-path "$NITRO_CLI_ARTIFACTS/idos-enclave.eif" | jq .Measurements
```

## Setting up facesign service

1. Follow up [FaceTec SDK](./facetec-sdk/README.md)
3. Run `bash sync_instance.sh EC2_IP_ADDR` from root dir.
4. `ssh ec2-user@"$(cd terraform; terraform output -raw ec2_public_ip)" bash server/facesign-service/scripts/enclave-build.ash`
5. `ssh ec2-user@"$(cd terraform; terraform output -raw ec2_public_ip)" sudo reboot`
6. `ssh ec2-user@"$(cd terraform; terraform output -raw ec2_public_ip)" bash server/facesign-service/scripts/enclave-run.ash`

This should boot the enclave in debug mode and stream its stdout.

> ⚠️💸 Warning 💸⚠️
>
> The needed instance type to get this running is pretty expensive (because we need a lot of memory to build and run the EIF). Don't let it idle mindlessly.

## Remaining TODOs

### Didn't even think about it yet
- Revisit the code changes we did in prior years to make Popeye work, and see if we want/need to forklift something into here.

### Annoyances
- There's a couple of places with `#SSH#` that were left in this repo just in case we need to debug stuff inside the enclave. This is not meant to be shipped.
- The current setup doesn't include the frontend. That's ok for the target end result, but it makes it clunky to test end-to-end.
- The image building process is very close to FaceTec's original, which has a lot of room for improvement.

### Known security concerns
- Encrypt the stuff we put on mongo with a KMS key. Use FLE: https://docs.aws.amazon.com/documentdb/latest/developerguide/field-level-encryption.html
  - There are only three biometric fields: faceScan, auditTrailImage, lowQualityAuditTrailImage. We don't store the audit images, and FaceTec has its own encryption for the faceScan (which is actually a faceVector).
  - Checked with FaceTec, and their security audit didn't flag this as a concern.
  - It would be great to encrypt everything in mongo nonetheless, but only out of a generic fear that a future update might introduce storage of new sensitive data.
- We're using hard-coded credentials for docdb. These should be gotten from Secrets Manager.
  - We tried using Secrets Manager, but we couldn't find a way to get terraform to behave on time.
  - Since we can't use SM, the operator needs access to the secret to create the docdb instance.
  - We don't think this is dangerous since it only allows an operator to get access to mongo-store data, which we know is already unusable enough.

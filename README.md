# Nitro experiment

## Git hooks

```bash
bash scripts/install-git-hooks.sh
```

Pre-commit runs `pnpm types`, `pnpm format`, and `pnpm test` in each `*-service`, then `npx cspell`.

## Shared TypeScript

The repo is a pnpm workspace: run `pnpm install` once at the root (one `pnpm-lock.yaml`).
Code used by more than one service lives in [`packages/tee-common`](packages/tee-common) and is
imported as `@idos/tee-common/<file>.ts`. It is plain `.ts` with no build step, so an edit is
picked up by every service immediately. Docker images are built with the repo root as context.

## Enclave EIF from GitHub Actions

`.github/workflows/<service>-eif-<env>.yml` builds the EIF of `enclave-service`,
`entropy-service` or `proxy-service` with the custom kernel from `aws-nitro-kernel/blobs`:
the `staging` workflows on every push to `deploy_to_staging`, the `production` ones on every
push to `master` (or manually via *Run workflow*). `facesign-service` has no workflow and is
built on the host. They use
[idos-network/nitro-enclaves-eif-build-action](https://github.com/idos-network/nitro-enclaves-eif-build-action).

Each run uploads `idos-<service>.eif` + `idos-<service>-info.json` as the artifact
`idos-<service>-eif-<commit sha>` and prints the EIF sha256 and PCR0-2 in the job summary.
The PCRs belong to that exact file, so deploy the file, don't rebuild on the host.

### Download to the EC2 host

One-time: install `gh` and log in with a fine-grained PAT scoped to this repo with
*Actions: Read*.

```bash
sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo && sudo dnf install -y gh
gh auth login --with-token   # paste the token
```

Then, on the host (the `sync_*.sh` scripts copy it to `~/`):

```bash
./update-from-github.sh enclave                       # latest successful staging run
./update-from-github.sh enclave production            # latest successful production run
./update-from-github.sh enclave staging 123456789     # a specific run id from the run URL
```

The first argument is `enclave`, `entropy` or `proxy`, the second `staging` (default)
or `production`; together they pick the workflow `.github/workflows/<service>-eif-<env>.yml`
and the EIF name the service's `enclave-run.ash` expects. The script downloads the artifact, checks that `describe-eif`
of the downloaded file gives the same PCRs as the info JSON from GHA, installs both into
`$NITRO_CLI_ARTIFACTS`, prints the sha256 + PCRs to compare with the job summary,
terminates any running enclave and starts the new one via the service's
`scripts/enclave-run.ash` (console attached, like the manual flow).
`enclave-build.ash` is not needed on the host.

## Proxy service

`proxy-service` keeps vendor API credentials inside the TEE so the main app only holds what it
is allowed to call. `POST /arm` (one of the `ARM_TOKENS` from `config.env` as bearer) stores a host
Ed25519 public key, the vendor (`api: "iron" | "moonpay" | "persona" | "sumsub" | "kalshi"`) with its credentials (`auth`), the
vendor `environment` (`production` | `sandbox`, mapped to a vendor origin baked into the image) and an
allowlist of `{ method, path }` (Express route syntax) as one FLE blob, and returns
an `id`; `DELETE /arm/{id}` disarms. The host then calls `ANY /proxy/{id}/<vendor path>` with
`Authorization: Bearer <EdDSA JWS>` over `{ method, path, bodySha256, iat, exp }`; the enclave
checks the allowlist, builds the vendor authorization (`proxy-service/providers/vendors/`) and
passes the vendor response through. Call examples: [`proxy-service/README.md`](proxy-service/README.md).

## KMS decrypt with Nitro attestation (enclave-service, proxy-service)

The enclave has no AWS identity of its own: it borrows the host's instance role over the
IMDS vsock proxy. A plain `kms:Decrypt` with those credentials works from the host just as
well, so whoever controls the host could decrypt the LUKS password and the FLE keys. To stop
that, enclave-service decrypts with an attestation document, and the KMS key policy
(infra, `lib/enclave-tee/kms.tf`, `enclave_measurements`) can require the PCRs of our EIF.

### How the enclave gets and uses its attestation

- `@idos/nitro-nsm` (`packages/nitro-nsm`) asks the Nitro Secure Module (`/dev/nsm`, from
  the `nsm.ko` our kernel blobs load) for an attestation document. Node has no ioctl, so that
  one call is a Rust addon (`src/lib.rs`, a napi wrapper around AWS's
  [aws-nitro-enclaves-nsm-api](https://github.com/aws/aws-nitro-enclaves-nsm-api) crate,
  trimmed from [aws-nitro-enclaves-nsm-node](https://github.com/PrivadoID/aws-nitro-enclaves-nsm-node)).
  The `nsm` stage of `enclave-service/Dockerfile` builds it with `cargo build --locked`;
  `Cargo.lock` pins every crate with its checksum. The hypervisor signs the document, and it
  contains PCR0-2 of the running EIF plus a fresh RSA public key generated inside the enclave.
- That document goes into `kms:Decrypt` as `Recipient`. KMS checks the signature, evaluates
  `kms:RecipientAttestation:PCR0/1/2` from the key policy and returns no plaintext, only
  `CiphertextForRecipient` (a CMS envelope) encrypted to that RSA key, which
  `packages/nitro-nsm/kms-decrypt.ts` opens inside the enclave with `openssl cms`.
- The host credentials still authenticate the call (the AWS SDK's default provider chain).
  Once the policy requires PCRs, they're useless without an attestation from our EIF.
- The call takes the same route as every other AWS call from the enclave: the in-enclave
  socat to the host's vsock proxy. The host side only forwards TCP; TLS to
  `kms.<region>.amazonaws.com` terminates inside the enclave.
- An enclave in **debug mode** (`nitro-cli run-enclave --debug-mode`, which
  `--attach-console` implies) gets attestations with all-zero PCRs. A PCR-restricted key
  therefore only decrypts for a non-debug enclave, see the rollout below.

What decrypts this way (`kms_decrypt` in `shared/aws.ash`, which runs `packages/nitro-nsm/aws.ts`):

- LUKS password, `enclave/luks_entropy_password.enc` (`shared/nbd.ash`). The key file gets the
  same bytes as before, so existing volumes keep opening. Like the generate-once secrets it
  is uploaded with `If-None-Match: *`, so a failed download can't replace the password of an
  existing disk and the bucket policy can require the header on every `PutObject`.
- FLE master key, `enclave/fle_master_key.enc` (`enclave-service/scripts/run.ash`). libmongocrypt's
  `aws` provider can't send a Recipient, so field-level encryption now uses the `local` KMS
  provider. Its 96-byte master key is generated once, KMS-encrypted with the FLE key
  (`AWS_KMS_FLE_ARN`), stored in S3 with `If-None-Match: *` (a failed download never
  overwrites it), decrypted at boot into `/run/secrets` (enclave RAM, not the NBD disk), and
  passed only to the express service as `FLE_MASTER_KEY`.
- Session-signing key, `enclave/signing_key.enc` (`providers/signing.ts`). KMS `Sign` can't
  carry a Recipient, so with a KMS signing key the host role could mint session JWS chains.
  Instead an Ed25519 key (PKCS#8 PEM) is generated once the same way as the FLE master key,
  but KMS-encrypted with its own symmetric key (`AWS_KMS_SIGNING_WRAP_ARN` in `config.env`),
  decrypted at boot into `/run/secrets/signing_key` and passed to express as `SIGNING_KEY`.
  The FLE key has to allow a plain decrypt for the data-key rewrap below; a separate key
  gets its PCR condition independently of that migration and keeps the two secrets under
  separate policies.
  Signing happens in-process; `AWS_KMS_SIGNING_KEY_ARN`, the asymmetric KMS signing key, is
  no longer read. The JWKS `kid` is
  the key's RFC 7638 thumbprint, so it changes with the key; verifiers resolve keys through
  `jku`, and jose fetches the JWKS again on an unknown `kid`. There is no rotation: one key,
  kept for as long as `signing_key.enc` exists.
- proxy-service does the same for its LUKS password (`proxy/luks_entropy_password.enc`) and FLE
  master key (`proxy/fle_master_key.enc`, `proxy-service/scripts/run.ash`), wrapped by its own
  `AWS_KMS_FLE_ARN` from `proxy/config.env`. It was never deployed with the `aws` provider, so its
  vault starts with a `local` data key and there is nothing to rewrap. It has no signing key.
- Images without the addon (entropy-service, facesign-service) keep the plain host-role
  `aws kms decrypt` in `kms_decrypt`. Their keys live in other infra modules
  (`lib/entropy-tee`, `lib/facesign-tee`) and aren't PCR-restricted.

On boot, `createFle` (`packages/tee-common/fle.ts`, `localMasterKey`) checks the data key
(`enclave-enclave-key`). If it's still wrapped
by `aws`, it calls `rewrapManyDataKey({"masterKey.provider": "aws"}, {provider: "local"})`
once. That needs the old plain decrypt, so it must run before the PCR condition exists. The
key `_id` stays the same, so existing encrypted session fields keep decrypting. After the
rewrap, an older EIF (with only the `aws` provider) can't read the data keys anymore.
Sessions expire within an hour, so the impact is limited, but plan rollbacks accordingly. Losing
`fle_master_key.enc` (or the FLE KMS key) makes all stored sessions unreadable.

### Attestation endpoint

`GET /attestation?nonce=<base64url, up to 64 bytes>` returns `{ "attestation": <base64> }`,
the COSE_Sign1 document from `/dev/nsm` (`getAttestationDocument` of `@idos/nitro-nsm`). It carries the EIF's `pcrs`, the caller's `nonce`
and, as `public_key`, the signing key from `/.well-known/jwks.json` (SubjectPublicKeyInfo
DER). A verifier checks the certificate chain up to the AWS Nitro root, the PCRs against the
GHA job summary, the nonce, and that `public_key` matches the JWK it verifies `jwtChain`
with. Attestation requires the NSM: outside an enclave the endpoint answers 500. The route is
rate limited to 100 requests per client address in 15 minutes (429 beyond that), the same
window the other services use.

proxy-service serves the same route without `public_key` (it has no key of its own): the
document proves which EIF answered on that TLS connection, nothing more.

### Trust assumption: who writes the generate-once secrets

Attestation gates only the decrypt. The encrypted files in S3 are not authenticated: whoever can
call `kms:Encrypt` on the key and write `enclave/*.enc` chooses the secret the enclave boots
with. Today that is the instance role, which the host holds too. A host operator can delete
`signing_key.enc` or `fle_master_key.enc`, upload the ciphertext of a key they know, and the
next boot decrypts it under a valid attestation. With the signing key they can then forge
session `jwtChain`s that verify against the JWKS key the attestation binds to the PCRs.
`If-None-Match: *` only protects an object that still exists.

So until infra closes this, the PCR condition keeps the secrets confidential from the host
but doesn't prove where they came from. To close it (`lib/enclave-tee`):

- Deny the instance role `s3:DeleteObject` on `enclave/*.enc` and every `s3:PutObject` that
  isn't a conditional create, and turn on bucket versioning or Object Lock, so an existing
  ciphertext can't be replaced.
- Drop `kms:Encrypt` from the instance role once the secrets exist, and grant it again only
  for a planned regeneration.
- The first write stays trust on first use: nothing distinguishes the enclave's first boot
  from the host writing the object before it.

### Rollout

0. Infra: create the KMS key that wraps the signing key, put its ARN into `config.env` as
   `AWS_KMS_SIGNING_WRAP_ARN`, let the instance role read and write
   `enclave/fle_master_key.enc` and `enclave/signing_key.enc` (below) and apply. Without
   this the new EIF fails at boot.
1. Deploy the new EIF with `enclave_measurements` still empty (no PCR condition). The boot
   log should show `fle_master_key` and `signing_key` fetched or generated, and the express
   log `FLE data keys rewrapped from aws to local` with `rewrapped: 1`. Check that sessions
   created before the deploy still decrypt, that `/.well-known/jwks.json` serves the new
   `kid` and that `/attestation` returns a document whose `public_key` matches it.
   Those older sessions keep the `jwtChain` the KMS key signed, and the JWKS no longer
   serves that key: a verifier rejects them until they expire, within the one hour session
   TTL. Deploy when that is acceptable, or have clients create a new session.
2. Switch `enclave-service/scripts/enclave-run.ash` to a non-debug run (drop
   `--attach-console`, read logs through Loki/vector), redeploy, and check that boot still
   works. Then add that EIF's PCR0/1/2 from the GHA job summary to `enclave_measurements` in
   `aws-staging-tee` / `aws-production-tee`.
3. `terraform plan` + apply. From now on, add each new EIF's PCRs to `enclave_measurements`
   before deploying it, and drop the old ones afterwards.

### Infra changes this needs

`lib/enclave-tee/iam.tf`, `aws_iam_role_policy.enclave_s3_access`: add
`"${var.secrets_bucket_arn}/enclave/fle_master_key.enc"` and
`"${var.secrets_bucket_arn}/enclave/signing_key.enc"` to `ReadConfigAndSecrets`
(`s3:GetObject`) and `WriteGenerateOnceSecrets` (`s3:PutObject`). The FLE key policy needs
nothing new: `kms:Encrypt` (generate-once) and `kms:Decrypt` (attested, plus the one-off
rewrap before PCRs) are already granted to the instance role.

`lib/enclave-tee/kms.tf`: a new symmetric key (`ENCRYPT_DECRYPT`) for the signing key, with
`kms:Encrypt` and `kms:Decrypt` for the instance role and the same `enclave_measurements`
PCR condition on `kms:Decrypt`. Its ARN goes into `enclave/config.env` as
`AWS_KMS_SIGNING_WRAP_ARN`. The KMS Ed25519 signing key (`AWS_KMS_SIGNING_KEY_ARN`) and its
`kms:Sign`/`kms:GetPublicKey` grant can go once no verifier still trusts the old `kid`.

### Infra for proxy-service (`lib/proxy-tee` or wherever its keys live)

Before the first deploy: let the instance role `s3:GetObject` and conditional `s3:PutObject`
`proxy/fle_master_key.enc` (next to `proxy/luks_entropy_password.enc`), and give it
`kms:Encrypt` + `kms:Decrypt` on `AWS_KMS_FLE_ARN` and `AWS_KMS_LUKS_ARN` from `proxy/config.env`.
No rewrap means the FLE key never needs a plain decrypt, so both keys can get the PCR condition on
`kms:Decrypt` as soon as there is a non-debug EIF to measure (`proxy-service/scripts/enclave-run.ash`
still runs with `--attach-console`, i.e. debug mode with all-zero PCRs). The trust assumption above
applies to `proxy/*.enc` the same way.

### Open decisions

- **entropy-service** has the same `aws` FLE provider and host-callable keys
  (`lib/entropy-tee`). It's untouched here. Hardening it means the same three steps: the `nsm`
  stage and `@idos/nitro-nsm` in its image, the `local` provider with rewrap, and PCR conditions in its key policy.

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

# Nitro experiment

## Setting up

1. Download the custom server SDK from <https://dev.facetec.com/configuration-wizard?platform=custom-server>, extract it into `facetec-sdk`.
    - Wizard config
        - MongoDB
        - No debug logging
        - SFTP usage logs
        - No postman init
2. On `facetec-sdk/facetec_usage_logs_server/config.yml`, set the `sftpConfig.privateKey` field to the right key (that needs to have been configured in FaceTec beforehand).
2. Add your ssh key to `terraform/terraform.tfvars`.
2. Apply the terraform in the `terraform` folder. You'll need to `aws configure sso` and choose the `nitro-enclave` account.
3. Run `bash sync_instance.sh` from root dir.
4. `ssh ec2-user@"$(cd terraform; terraform output -raw ec2_public_ip)" bash custom-server/build.ash`
4. `ssh ec2-user@"$(cd terraform; terraform output -raw ec2_public_ip)" sudo reboot`
4. `ssh ec2-user@"$(cd terraform; terraform output -raw ec2_public_ip)" bash custom-server/run.ash`

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

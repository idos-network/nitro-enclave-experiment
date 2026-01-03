# FaceTec SDK

1. Download the custom server SDK from <https://dev.facetec.com/configuration-wizard?platform=server>, extract it into `facetec-sdk`.
    - Wizard config
        - MongoDB
        - No debug logging
        - SFTP usage logs
        - No postman init
2. On `facetec-sdk/FaceTec-Usage-Log-Server/config.yml`, set the `sftpConfig.privateKey` field to the right key (that needs to have been configured in FaceTec beforehand).
3. Run `bash sync.sh` in `facetec-sdk` to prepare templates on S3.
4. Update `FACETEC_SDK_VERSION` variable in `facesign-service/scripts/enclave-build.ash`

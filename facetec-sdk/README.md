# FaceTec SDK

1. Download the custom server SDK from <https://dev.facetec.com/configuration-wizard?platform=server>, extract it into `facetec-sdk`.
    - Wizard config
        - MongoDB
        - No debug logging
        - HTTPS usage logs
        - No postman init
2. Run `bash sync.sh` in `facetec-sdk` to prepare templates on S3.
3. Update `FACETEC_SDK_VERSION` variable in `facesign-service/scripts/enclave-build.ash`
4. Follow next steps in `facesign` repo to create patches for FLE and other required stuff.

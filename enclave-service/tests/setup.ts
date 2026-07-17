process.env.NODE_ENV ??= "test";
process.env.MONGO_URI ??= "mongodb://localhost:27017";
process.env.AWS_REGION ??= "eu-central-1";
process.env.AWS_KMS_FLE_ARN ??= "arn:aws:kms:eu-central-1:000000000000:key/fle-test";
process.env.AWS_KMS_SIGNING_KEY_ARN ??= "arn:aws:kms:eu-central-1:000000000000:key/signing-test";
process.env.BASE_URL = "https://test.root.com";

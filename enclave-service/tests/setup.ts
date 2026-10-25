process.env.NODE_ENV ??= "test";
process.env.MONGO_URI ??= "mongodb://localhost:27017";
process.env.AWS_REGION ??= "eu-central-1";
process.env.FLE_MASTER_KEY ??= Buffer.alloc(96).toString("base64");
process.env.AWS_KMS_SIGNING_KEY_ARN ??= "arn:aws:kms:eu-central-1:000000000000:key/signing-test";
process.env.BASE_URL = "https://test.root.com";
process.env.SESSION_TOKENS ??= "session-token-one, session-token-two";

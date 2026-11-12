process.env.NODE_ENV ??= "test";
process.env.MONGO_URI ??= "mongodb://localhost:27017";
process.env.AWS_REGION ??= "eu-central-1";
process.env.FLE_MASTER_KEY ??= Buffer.alloc(96).toString("base64");
process.env.ARM_TOKENS ??= "arm-token-one, arm-token-two";

import { type ApiKeyAuth, ApiKeyAuthSchema, type Vendor } from "./vendor.ts";

// One host; sandbox and production differ by the key.
export class Moonpay implements Vendor<typeof ApiKeyAuthSchema> {
  readonly auth = ApiKeyAuthSchema;
  readonly origins = {
    production: "https://api.moonpay.com",
    sandbox: "https://api.moonpay.com",
  };

  async authorize(auth: ApiKeyAuth) {
    return { "x-api-key": auth.apiKey };
  }
}

import { type ApiKeyAuth, ApiKeyAuthSchema, type Vendor } from "./vendor.ts";

// X-API-Version is not a secret; the host sends it like any other header.
export class Iron implements Vendor<typeof ApiKeyAuthSchema> {
  readonly auth = ApiKeyAuthSchema;
  readonly origins = {
    production: "https://api.iron.xyz",
    sandbox: "https://api.sandbox.iron.xyz",
  };

  async authorize(auth: ApiKeyAuth) {
    return { "X-API-Key": auth.apiKey };
  }
}

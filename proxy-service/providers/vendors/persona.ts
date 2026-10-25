import { type ApiKeyAuth, ApiKeyAuthSchema, type Vendor } from "./vendor.ts";

// Persona-Version and Key-Inflection are not secrets; the host sends them. One host, key per env.
export class Persona implements Vendor<typeof ApiKeyAuthSchema> {
  readonly auth = ApiKeyAuthSchema;
  readonly origins = {
    production: "https://api.withpersona.com",
    sandbox: "https://api.withpersona.com",
  };

  async authorize(auth: ApiKeyAuth) {
    return { Authorization: `Bearer ${auth.apiKey}` };
  }
}

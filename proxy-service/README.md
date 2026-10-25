# proxy-service

TEE proxy that keeps vendor API credentials inside the enclave. The host (kraken) is
"armed" once per vendor + client and afterwards can only call the allowlisted endpoints,
signing every request with its own Ed25519 key. API reference: [openapi.yaml](./openapi.yaml)
(served at `/docs` when running).

```
host ──(1) POST /arm  {hostPublicKey, api, environment, auth, allow}──▶ enclave ──▶ Mongo (FLE blob)
host ◀─────────────────────── { id } ─────────────────────────────┘
host ──(2) GET /proxy/{id}/api/identifications/123 + Bearer <JWS> ─▶ enclave ──(auth added)──▶ vendor
host ◀───────────────── vendor status + body ──────────────────────┘
```

## 1. Host key pair (once per host)

```bash
node -e '
const { generateKeyPairSync } = require("node:crypto");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
console.log("hostPublicKey:", publicKey.export({ format: "jwk" }).x);
console.log(privateKey.export({ format: "pem", type: "pkcs8" }));
'
```

Keep the private key in the host, send only `hostPublicKey` to the enclave.

## 2. Arm

`ARM_TOKENS` (comma separated) lives in the enclave `config.env`. One of them goes in the
`Authorization` header. `environment` (`production` | `sandbox`) picks the vendor origin baked into
`providers/vendors/`; the host never supplies a URL. `allow[].path` uses Express 5 route
syntax (`path-to-regexp`): `:id` matches one segment, `*rest` the remainder. It is matched against the
pathname after URL normalization, case-sensitively; the query string is not checked. A pathname with an
encoded `/`, `\` or `%` (`%2F`, `%5C`, `%25`) is rejected, since a vendor might decode it into segments the
allowlist never saw.

```bash
curl -sS -X POST "$PROXY_URL/arm" \
  -H "Authorization: Bearer $ARM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "api": "iron",
    "hostPublicKey": "<hostPublicKey from step 1>",
    "environment": "sandbox",
    "auth": { "apiKey": "<iron api key>" },
    "allow": [
      { "method": "GET",  "path": "/api/customers/:id" },
      { "method": "GET",  "path": "/api/customers/:id/external" },
      { "method": "POST", "path": "/api/customers/:id/identifications/v2" },
      { "method": "GET",  "path": "/api/identifications/:id" },
      { "method": "PUT",  "path": "/api/identifications/:id/archive" }
    ]
  }'
# => {"id":"6d1f…"}
```

Other vendors differ only in `api` + `auth`:

```jsonc
{ "api": "moonpay", "auth": { "apiKey": "<moonpay api key>" } }
{ "api": "persona", "auth": { "apiKey": "<persona api key>" } }
{ "api": "sumsub",  "auth": { "appToken": "<sumsub app token>", "secretKey": "<sumsub secret key>" } }
{ "api": "kalshi",  "auth": { "apiKeyId": "<key id>", "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n…" } }
{ "api": "mock",    "auth": { "apiKey": "<any secret>", "delayMs": 200 } } // load tests: no upstream, answers locally after delayMs
```

## 3. Sign a request

Every proxied call carries `Authorization: Bearer <JWS>`, EdDSA-signed with the host private key:

| claim        | value                                                                 |
| ------------ | --------------------------------------------------------------------- |
| `method`     | HTTP method, upper case                                               |
| `path`       | everything after `/proxy/{id}`, including the query string            |
| `bodySha256` | base64url SHA-256 of the raw body bytes (of `""` when there is none)  |
| `iat`, `exp` | both required; `iat` may be at most 5 minutes old                     |

```js
// sign.mjs — run from proxy-service/ so `jose` resolves
import { createHash, createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";

const [path, method = "GET", body = ""] = process.argv.slice(2);
const key = createPrivateKey(process.env.HOST_PRIVATE_KEY_PEM);

const jws = await new SignJWT({
  method,
  path,
  bodySha256: createHash("sha256").update(body).digest("base64url"),
})
  .setProtectedHeader({ alg: "EdDSA" })
  .setIssuedAt()
  .setExpirationTime("2m")
  .sign(key);

console.log(jws);
```

## 4. Call the vendor through the proxy

```bash
ARMED_ID=6d1f…
PATH_=/api/identifications/ident-123
JWS=$(node sign.mjs "$PATH_")

curl -sS "$PROXY_URL/proxy/$ARMED_ID$PATH_" \
  -H "Authorization: Bearer $JWS" \
  -H "IDEMPOTENCY-KEY: $(uuidgen)" \
  -H "X-API-Version: 2026-08-01"
```

With a body, hash exactly the bytes you send:

```bash
BODY='{"customer_type":"Person","email":"a@b.c","external_id":"u-1"}'
PATH_=/api/customers/customer-1/identifications/v2
JWS=$(node sign.mjs "$PATH_" POST "$BODY")

curl -sS -X POST "$PROXY_URL/proxy/$ARMED_ID$PATH_" \
  -H "Authorization: Bearer $JWS" \
  -H "Content-Type: application/json" \
  -H "IDEMPOTENCY-KEY: $(uuidgen)" \
  -H "X-API-Version: 2026-08-01" \
  --data-raw "$BODY"
```

The enclave forwards your headers except `Authorization`, adds the vendor authorization
(`X-API-Key`, `x-api-key`, `Authorization: Bearer`, the `X-App-Access-*` HMAC or the
`KALSHI-ACCESS-*` signature) and returns the vendor status,
content type and body unchanged.

| status | meaning                                              |
| ------ | ---------------------------------------------------- |
| 401    | missing/invalid/expired JWS, or method/path/body mismatch |
| 403    | method + path not in the allowlist                   |
| 404    | unknown armed id                                     |
| 502    | vendor unreachable or timed out (30 s)               |
| other  | passed through from the vendor                       |

## 5. Disarm

```bash
curl -sS -X DELETE "$PROXY_URL/arm/$ARMED_ID" -H "Authorization: Bearer $ARM_TOKEN"
# => 204
```

Rotate a vendor key by arming again and disarming the old id.

## Local run

```bash
pnpm install
MONGO_URI=… AWS_REGION=… AWS_KMS_FLE_ARN=… ARM_TOKENS=dev-token pnpm start
```

`pnpm test` runs without Mongo or KMS (both mocked).

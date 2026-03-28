# FaceSign service

Node/Express service that fronts FaceTec (`process-request` and related APIs), runs FaceSign login/confirmation, and exposes idOS issuer metadata.

## API specification

Check [ReDoc pages](https://idos-network.github.io/nitro-enclave-experiment/) or you can go directly into **[openapi.yaml](./openapi.yaml)** (OpenAPI 3.0.3). It is maintained to match `server.ts` and the `routes/` handlers.

View or lint locally:

```bash
npx @redocly/cli preview-docs openapi.yaml
# or
npx @redocly/cli lint openapi.yaml
```

### Published docs (GitHub Pages)

On pushes to `main` / `master` that change `openapi.yaml`, [FaceSign API docs (GitHub Pages)](../.github/workflows/facesign-api-docs.yml) builds a standalone Redoc `index.html` and deploys it.

**One-time setup:** in the GitHub repo go to **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”). After the first successful run, the site URL is shown on the workflow run and under **Settings → Pages** (typically `https://<owner>.github.io/<repo>/`).

**If deploy fails with `HttpError: Not Found`:** the Pages API returns 404 when Actions-based publishing is not active for this repository. Fix it by opening **Settings → Pages**, choosing **GitHub Actions** under **Build and deployment**, and saving (you may need to pick a suggested workflow once; ours will run from `.github/workflows/facesign-api-docs.yml`). Also confirm the repo is allowed to use GitHub Pages: **public** repos can use Pages on the free plan; **private** repos need a plan that includes Pages ([GitHub Pages docs](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). On **GitHub Enterprise Server**, older instances need different action versions—see [deploy-pages issues](https://github.com/actions/deploy-pages/issues).

### Endpoints (summary)

| Area | Methods |
|------|---------|
| Health | `GET /`, `GET /health` |
| Relay | `POST /relay/liveness`, `POST /relay/uniqueness`, `POST /relay/match`, `POST /relay/match-id-doc`, `GET /relay/selfie/{selfieId}` |
| FaceSign | `POST /facesign`, `POST /facesign/confirmation` |
| idOS VC | `GET /idos/issuers/1`, `GET /idos/keys/1` |

### Status codes (FaceTec-facing routes)

- **200** — FaceTec session continuation: JSON includes `responseBlob` (and in this service also `sessionStart`, `launchId` — see `SessionStartResponse` in the spec).
- **201** — Successful completion for that operation (enrollment, match, ID-doc match, etc.).
- **400** — Recoverable error (liveness/match failure, bad confirmation token, etc.).
- **409** — Non-recoverable conflict (e.g. duplicate face-vector on uniqueness, user already exists on confirmation).
- **500** — FaceTec API error or internal error (see `FaceTecErrorBody` / generic error schemas in the spec).

Optional header: **`x-request-id`** — correlation id; omitted values are replaced with a generated UUID per request.

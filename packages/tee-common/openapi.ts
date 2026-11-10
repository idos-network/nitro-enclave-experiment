import { readFileSync } from "node:fs";
import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";

/**
 * Serves ./openapi.yaml (relative to the service's working directory) as
 * /docs, /openapi.json and /openapi.yaml. Skipped under test.
 */
export function mountOpenApi(app: Express) {
  if (process.env.NODE_ENV === "test") return;

  const file = readFileSync("./openapi.yaml", "utf8");
  const swaggerDocument = YAML.parse(file);

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  app.get("/openapi.json", (_req, res) => {
    res.json(swaggerDocument);
  });
  app.get("/openapi.yaml", (_req, res) => {
    res.type("text/yaml");
    res.send(file);
  });
}

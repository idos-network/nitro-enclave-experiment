import { setTimeout as sleep } from "node:timers/promises";
import { annotateSpan, traced } from "@idos/tee-common/telemetry.ts";
import type { Request } from "express";
import { match } from "path-to-regexp";
import { UPSTREAM_TIMEOUT_MS } from "../env.ts";
import type { ArmRequest } from "../utils/dto.ts";
import type { Armed } from "./db.ts";
import { authorize } from "./vendors/index.ts";

// Never forwarded: hop-by-hop headers, the host's proxy credential and anything fetch derives itself.
const DROPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "expect", // undici refuses it; Node already answered the 100-continue itself
  "host",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-request-id",
]);

// Encoded `/`, `\` and `%`: a vendor may decode them into segments the allowlist never saw.
const ENCODED_DELIMITER = /%(2f|5c|25)/i;

/**
 * Absolute vendor URL for `path` under `origin`. The URL parser does the resolving and
 * dot-segment normalization; only the origin has to stay put.
 */
export function resolveUpstreamUrl(origin: string, path: string): URL | null {
  const url = new URL(path, origin);
  return url.origin === origin && !ENCODED_DELIMITER.test(url.pathname) ? url : null;
}

export function isAllowed(allow: ArmRequest["allow"], method: string, pathname: string): boolean {
  return allow.some(
    (entry) =>
      entry.method === method && match(entry.path, { sensitive: true })(pathname) !== false,
  );
}

type Upstream = { status: number; contentType: string | null; body: Buffer };

// annotated: the inferred type would reference express' internal Request generics
export const forward: (armed: Armed, req: Request, url: URL) => Promise<Upstream> = traced(
  "upstream.forward",
  async (armed: Armed, req: Request, url: URL): Promise<Upstream> => {
    // vendor and environment come from the arm allowlist, never from the request
    annotateSpan({ "proxy.api": armed.api, "proxy.environment": armed.environment });
    const headers = new Headers();
    // Headers named by Connection are hop-by-hop too (RFC 9110 §7.6.1).
    const nominated = new Set(
      String(req.headers.connection ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    );
    for (const [name, value] of Object.entries(req.headers)) {
      if (DROPPED_REQUEST_HEADERS.has(name) || nominated.has(name) || value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }

    const body = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;

    // Vendor auth headers win over anything the host sent under the same name.
    const authHeaders = await authorize(armed, { method: req.method, url, body });
    for (const [name, value] of Object.entries(authHeaders)) {
      headers.set(name, value);
    }

    if (armed.api === "mock") {
      await sleep(armed.auth.delayMs);
      const echo = { method: req.method, path: `${url.pathname}${url.search}`, ...authHeaders };
      return {
        status: 200,
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(echo)),
      };
    }

    const response = await fetch(url.toString(), {
      method: req.method,
      headers,
      ...(body ? { body } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    annotateSpan({ "http.response.status_code": response.status });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: Buffer.from(await response.arrayBuffer()),
    };
  },
);

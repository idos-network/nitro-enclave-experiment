import type { Request } from "express";
import { match } from "path-to-regexp";
import { UPSTREAM_TIMEOUT_MS } from "../env.ts";
import type { ArmRequest } from "../utils/dto.ts";
import type { Armed } from "./db.ts";
import { authorize } from "./vendors.ts";

// Never forwarded: hop-by-hop headers, the host's proxy credential and anything fetch derives itself.
const DROPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
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

/**
 * Absolute vendor URL for `path`. `baseUrl` is an origin (enforced at arm time), so the URL
 * parser does the resolving and dot-segment normalization; only the origin has to stay put.
 */
export function resolveUpstreamUrl(baseUrl: string, path: string): URL | null {
  const url = new URL(path, baseUrl);
  return url.origin === new URL(baseUrl).origin ? url : null;
}

export function isAllowed(allow: ArmRequest["allow"], method: string, pathname: string): boolean {
  return allow.some((entry) => entry.method === method && match(entry.path)(pathname) !== false);
}

export async function forward(
  armed: Armed,
  req: Request,
  url: URL,
): Promise<{ status: number; contentType: string | null; body: Buffer }> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (DROPPED_REQUEST_HEADERS.has(name) || value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  const body = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;

  // Vendor auth headers win over anything the host sent under the same name.
  const authHeaders = await authorize(armed, { method: req.method, url, body });
  for (const [name, value] of Object.entries(authHeaders)) {
    headers.set(name, value);
  }

  const response = await fetch(url.toString(), {
    method: req.method,
    headers,
    ...(body ? { body } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

import { describe, expect, it } from "vitest";
import { isAllowed, resolveUpstreamUrl } from "../providers/proxy.ts";

describe("resolveUpstreamUrl", () => {
  it("joins the path (with query) onto the base url", () => {
    expect(resolveUpstreamUrl("https://iron.example.com", "/api/x?a=1")?.toString()).toBe(
      "https://iron.example.com/api/x?a=1",
    );
  });

  it("lets the URL parser normalize dot segments, so the allowlist sees the real path", () => {
    expect(
      resolveUpstreamUrl("https://iron.example.com", "/api/%2e%2e/%2e%2e/admin")?.pathname,
    ).toBe("/admin");
    expect(resolveUpstreamUrl("https://iron.example.com", "/api/../x")?.pathname).toBe("/x");
  });

  it("rejects paths that resolve to another origin", () => {
    expect(resolveUpstreamUrl("https://iron.example.com", "//evil.example.com/x")).toBeNull();
    expect(resolveUpstreamUrl("https://iron.example.com", "https://evil.example.com/x")).toBeNull();
  });

  it("keeps userinfo-looking paths on the base origin", () => {
    expect(resolveUpstreamUrl("https://iron.example.com", "/@evil.example.com/x")?.origin).toBe(
      "https://iron.example.com",
    );
  });
});

describe("isAllowed (Express route syntax)", () => {
  const allow = [{ method: "GET" as const, path: "/api/identifications/:id" }];

  it("matches a single path parameter", () => {
    expect(isAllowed(allow, "GET", "/api/identifications/abc")).toBe(true);
    expect(isAllowed(allow, "GET", "/api/identifications/abc%2F123")).toBe(true);
    // Sumsub-style matrix segment
    expect(isAllowed(allow, "GET", "/api/identifications/-;externalUserId=u-1")).toBe(true);
  });

  it("does not match extra segments, a bare prefix or other methods", () => {
    expect(isAllowed(allow, "GET", "/api/identifications/abc/archive")).toBe(false);
    expect(isAllowed(allow, "GET", "/api/identifications")).toBe(false);
    expect(isAllowed(allow, "GET", "/api/identifications/")).toBe(false);
    expect(isAllowed(allow, "PUT", "/api/identifications/abc")).toBe(false);
  });

  it("supports wildcards like Express routes", () => {
    const wild = [{ method: "GET" as const, path: "/platform/v1/customers/*rest" }];
    expect(isAllowed(wild, "GET", "/platform/v1/customers/c1/files")).toBe(true);
    expect(isAllowed(wild, "GET", "/platform/v1/orders/c1")).toBe(false);
  });
});

import jwt from "jsonwebtoken";
import { privateKey } from "./test-keys.ts";

export const GROUP_NAME = "pinocchio-users";

type TokenOptions = {
  sub: string;
  action?: string;
  iat?: number;
  key?: string | Buffer;
};

export function makeConfirmationToken({
  sub,
  action = "confirmation",
  iat = Math.floor(Date.now() / 1000),
  key = privateKey,
}: TokenOptions) {
  return jwt.sign({ sub, action, iat }, key, { algorithm: "ES512" });
}

type Mock3dDbOptions = {
  searchResults?: Array<{ identifier: string; matchLevel: number }>;
};

export function mock3dDbFetch({ searchResults = [] }: Mock3dDbOptions = {}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (url) => {
    if (url.toString().endsWith("3d-db/search")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          results: searchResults,
        }),
      } as any;
    }

    return {
      ok: true,
      json: async () => ({
        success: true,
      }),
    } as any;
  });
}

type MockFetchResponse = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
  text?: string;
};

type MockFetchHandler = {
  endsWith: string;
  response: MockFetchResponse;
};

export function mockFetchByEndpoint(
  handlers: MockFetchHandler[],
  fallback?: MockFetchResponse,
) {
  return vi.spyOn(global, "fetch").mockImplementation(async (url) => {
    const match = handlers.find((handler) => url.toString().endsWith(handler.endsWith));
    const response = match?.response ?? fallback;

    if (!response) {
      return undefined as any;
    }

    return {
      ok: response.ok ?? true,
      status: response.status,
      statusText: response.statusText,
      json: async () => response.json,
      text: async () => response.text ?? "",
    } as any;
  });
}

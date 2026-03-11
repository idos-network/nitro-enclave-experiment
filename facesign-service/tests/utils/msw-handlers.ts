import { HttpResponse, http } from "msw";

const FACETEC_SERVER = "http://127.0.0.1:5000/";

// Request capture for verifying API calls
export type CapturedRequest = {
  url: string;
  method: string;
  body: unknown;
};

class RequestCapture {
  private requests: CapturedRequest[] = [];

  capture(url: string, method: string, body: unknown) {
    this.requests.push({ url, method, body });
  }

  getAll() {
    return this.requests;
  }

  getByEndpoint(endsWith: string) {
    return this.requests.filter((r) => r.url.endsWith(endsWith));
  }

  getLastByEndpoint(endsWith: string) {
    const matches = this.getByEndpoint(endsWith);
    return matches[matches.length - 1];
  }

  clear() {
    this.requests = [];
  }
}

export const requestCapture = new RequestCapture();

// biome-ignore lint/suspicious/noExplicitAny: MSW types are complex
type ResolverResult = HttpResponse<any> | Record<string, unknown>;

// Helper to create a POST handler with automatic request capture
function postHandler(endpoint: string, resolver: (body: unknown) => ResolverResult) {
  return http.post(`${FACETEC_SERVER}${endpoint}`, async ({ request }) => {
    const body = await request.json();
    requestCapture.capture(request.url, request.method, body);
    const result = resolver(body);
    return result instanceof HttpResponse ? result : HttpResponse.json(result);
  });
}

// Default responses
const defaults = {
  processRequest: {
    success: true,
    result: { livenessProven: true },
    didError: false,
    responseBlob: "mock-scan-result-blob",
  },
  search: {
    success: true,
    results: [] as Array<{ identifier: string; matchLevel: number }>,
  },
  enroll: { success: true },
  launchId: crypto.randomUUID(),
  status: {
    running: true,
    success: true,
    serverInfo: {
      coreServerSDKVersion: "1.0.0",
      facetecServerWebserviceVersion: "1.0.0",
      uptime: 1000,
      machineID: "test-machine",
      instanceID: "test-instance",
      notice: "Test server",
    },
  },
};

// Default handlers
export const handlers = [
  postHandler("process-request", () => defaults.processRequest),
  postHandler("3d-db/search", () => defaults.search),
  postHandler("3d-db/enroll", () => defaults.enroll),
  http.get(`${FACETEC_SERVER}status`, ({ request }) => {
    requestCapture.capture(request.url, request.method, null);
    return HttpResponse.json(defaults.status);
  }),
];

// Handler factories
type ProcessRequestResponse = {
  launchId?: string;
  success?: boolean;
  result?: { livenessProven: boolean; matchLevel?: number };
  didError?: boolean;
  responseBlob?: string;
};

export const processRequestHandler = (
  response: ProcessRequestResponse = {},
  defaultResult = true,
) =>
  postHandler("process-request", () => ({
    ...(defaultResult ? defaults.processRequest : {}),
    ...response,
  }));

export const processRequestErrorHandler = (status: number, text: string) =>
  postHandler("process-request", () => new HttpResponse(text, { status }));

export const sessionStartHandler = (responseBlob = "mock-session-result-blob") =>
  postHandler("process-request", () => ({ responseBlob }));

type SearchResult = { identifier: string; matchLevel: number };

export const searchHandler = (results: SearchResult[] = []) =>
  postHandler("3d-db/search", () => ({ success: true, results }));

export const searchHandlerWithBodyCheck = (
  matcher: (body: { groupName?: string }) => boolean,
  results: SearchResult[],
  fallbackResults: SearchResult[] = [],
) =>
  postHandler("3d-db/search", (body) => ({
    success: true,
    results: matcher(body as { groupName?: string }) ? results : fallbackResults,
  }));

export const enrollHandler = (success = true) => postHandler("3d-db/enroll", () => ({ success }));

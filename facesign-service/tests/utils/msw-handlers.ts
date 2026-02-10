import { http, HttpResponse } from "msw";

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

// Default successful responses
export const defaultProcessRequestResponse = {
  success: true,
  result: { livenessProven: true },
  didError: false,
  responseBlob: "mock-scan-result-blob",
};

export const defaultSearchResponse = {
  success: true,
  results: [] as Array<{ identifier: string; matchLevel: number }>,
};

export const defaultEnrollResponse = {
  success: true,
};

export const defaultSessionResponse = {
  responseBlob: "mock-session-result-blob",
};

// Default handlers - return success responses
export const handlers = [
  http.post(`${FACETEC_SERVER}process-request`, async ({ request }) => {
    const body = await request.json();
    requestCapture.capture(request.url, request.method, body);
    return HttpResponse.json(defaultProcessRequestResponse);
  }),

  http.post(`${FACETEC_SERVER}3d-db/search`, async ({ request }) => {
    const body = await request.json();
    requestCapture.capture(request.url, request.method, body);
    return HttpResponse.json(defaultSearchResponse);
  }),

  http.post(`${FACETEC_SERVER}3d-db/enroll`, async ({ request }) => {
    const body = await request.json();
    requestCapture.capture(request.url, request.method, body);
    return HttpResponse.json(defaultEnrollResponse);
  }),

  http.get(`${FACETEC_SERVER}status`, ({ request }) => {
    requestCapture.capture(request.url, request.method, null);
    return HttpResponse.json({
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
    });
  }),
];

// Helper to create process-request handler with custom response
export function processRequestHandler(response: {
  success?: boolean;
  result?: { livenessProven: boolean; matchLevel?: number };
  didError?: boolean;
  responseBlob?: string;
}) {
  return http.post(`${FACETEC_SERVER}process-request`, async ({ request }) => {
    const body = await request.json();
    requestCapture.capture(request.url, request.method, body);
    return HttpResponse.json({
      ...defaultProcessRequestResponse,
      ...response,
    });
  });
}

// Helper to create process-request handler that returns error
export function processRequestErrorHandler(status: number, body: string) {
  return http.post(`${FACETEC_SERVER}process-request`, async ({ request }) => {
    const reqBody = await request.json();
    requestCapture.capture(request.url, request.method, reqBody);
    return new HttpResponse(body, { status });
  });
}

// Helper for session start response (no success field, just responseBlob)
export function sessionStartHandler(responseBlob = "mock-session-result-blob") {
  return http.post(`${FACETEC_SERVER}process-request`, async ({ request }) => {
    const body = await request.json();
    requestCapture.capture(request.url, request.method, body);
    return HttpResponse.json({ responseBlob });
  });
}

// Helper to create 3d-db/search handler with custom results
export function searchHandler(
  results: Array<{ identifier: string; matchLevel: number }> = [],
) {
  return http.post(`${FACETEC_SERVER}3d-db/search`, async ({ request }) => {
    const body = await request.json();
    requestCapture.capture(request.url, request.method, body);
    return HttpResponse.json({
      success: true,
      results,
    });
  });
}

// Helper for search handler that checks request body (for conditional responses)
export function searchHandlerWithBodyCheck(
  matcher: (body: { groupName?: string }) => boolean,
  results: Array<{ identifier: string; matchLevel: number }>,
  fallbackResults: Array<{ identifier: string; matchLevel: number }> = [],
) {
  return http.post(`${FACETEC_SERVER}3d-db/search`, async ({ request }) => {
    const body = (await request.json()) as { groupName?: string };
    requestCapture.capture(request.url, request.method, body);
    const matchedResults = matcher(body) ? results : fallbackResults;
    return HttpResponse.json({
      success: true,
      results: matchedResults,
    });
  });
}

// Helper to create 3d-db/enroll handler
export function enrollHandler(success = true) {
  return http.post(`${FACETEC_SERVER}3d-db/enroll`, async ({ request }) => {
    const body = await request.json();
    requestCapture.capture(request.url, request.method, body);
    return HttpResponse.json({ success });
  });
}

import { privateKey } from "./helper.ts";
import { requestCapture } from "./msw-handlers.ts";
import { server } from "./msw-server.ts";

vi.mock("../../providers/db.ts", () => ({
  insertMember: vi.fn(),
  countMembersInGroup: vi.fn(),
  getMembers: vi.fn(),
  getOldestFaceSignUserId: vi.fn(),
}));

vi.mock("../../providers/agent.ts", () => ({
  default: {
    writeLog: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock("fs", async () => {
  const actualFs = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actualFs,
    readFileSync: vi.fn(() => privateKey),
  };
});

// Start MSW server before all tests
// Use "bypass" for unhandled requests to allow supertest requests to the Express app
beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});

// Reset handlers and captured requests after each test
afterEach(() => {
  server.resetHandlers();
  requestCapture.clear();
});

// Close MSW server after all tests
afterAll(() => {
  server.close();
});

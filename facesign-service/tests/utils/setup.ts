import { privateKey } from "./test-keys.ts";

vi.mock("../../providers/db.ts", () => ({
  insertMember: vi.fn(),
  countMembersInGroup: vi.fn(),
  getMembers: vi.fn(),
  getOldestFaceSignUserId: vi.fn(),
}));

vi.mock("fs", async () => {
  const actualFs = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actualFs,
    readFileSync: vi.fn(() => privateKey),
  };
});
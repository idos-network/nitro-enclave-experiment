import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Armed } from "../providers/db.ts";
import type { ArmRequest } from "../utils/dto.ts";
import { ARM_TOKEN, armBody } from "./helpers.ts";

const mocks = vi.hoisted(() => {
  const armed = new Map<string, ArmRequest>();

  return {
    armed,
    storeArmed: vi.fn(async (id: string, data: ArmRequest) => {
      armed.set(id, data);
    }),
    deleteArmed: vi.fn(async (id: string) => armed.delete(id)),
    getArmed: vi.fn(async (id: string): Promise<Armed | null> => {
      const stored = armed.get(id);
      if (!stored) return null;

      return { id, ...stored };
    }),
  };
});

vi.mock("../providers/db.ts", () => ({
  storeArmed: mocks.storeArmed,
  getArmed: mocks.getArmed,
  deleteArmed: mocks.deleteArmed,
  connectDB: vi.fn(),
}));

const { default: app } = await import("../server.ts");

app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  } else {
    next();
  }
});

export { app };

let fetchMock: Mock<typeof fetch>;

export function resetMocks() {
  mocks.armed.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();

  fetchMock = vi.fn<typeof fetch>(async (input) => {
    throw new Error(`Unexpected upstream fetch in test: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** The mocked upstream (vendor) `fetch`. */
export const upstream = () => fetchMock;

export async function arm(body: ArmRequest = armBody()): Promise<string> {
  const res = await request(app)
    .post("/arm")
    .set("Authorization", `Bearer ${ARM_TOKEN}`)
    .send(body)
    .expect(200);

  return res.body.id;
}

/** Accessors — vitest forbids exporting `vi.hoisted` bindings directly. */
export const storeArmed = () => mocks.storeArmed;
export const getArmed = () => mocks.getArmed;
export const deleteArmed = () => mocks.deleteArmed;
export const armed = () => mocks.armed;

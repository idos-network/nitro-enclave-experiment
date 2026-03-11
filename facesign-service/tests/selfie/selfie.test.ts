// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../../providers/agent.ts";
import * as db from "../../providers/db.ts";
import app from "../../server.ts";

function binaryParser(res: any, callback: any) {
  const chunks: Buffer[] = [];

  res.on("data", (chunk: Uint8Array | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  res.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });

  res.on("error", (error: Error) => {
    callback(error, Buffer.alloc(0));
  });
}

describe("Selfie API", () => {
  it("returns selfie image", async () => {
    const imageBuffer = Buffer.from("test-image-data");
    const getAuditTrailImageSpy = vi.spyOn(db, "getAuditTrailImage").mockResolvedValue(imageBuffer);
    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app)
      .get("/relay/selfie/test-external-id")
      .buffer(true)
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/image\/jpeg/);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.equals(imageBuffer)).toBe(true);

    expect(getAuditTrailImageSpy).toHaveBeenCalledWith("test-external-id");
    expect(agentSpy).toHaveBeenCalledWith("selfie-request", {
      selfieId: "test-external-id",
    });
  });

  it("returns 400 when audit trail image is missing", async () => {
    const getAuditTrailImageSpy = vi.spyOn(db, "getAuditTrailImage").mockResolvedValue(null);
    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).get("/relay/selfie/test-external-id");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      errorMessage: "Selfie image not found.",
    });

    expect(getAuditTrailImageSpy).toHaveBeenCalledWith("test-external-id");
    expect(agentSpy).toHaveBeenCalledWith("selfie-failed", {
      selfieId: "test-external-id",
      error: "No selfie image found for test-external-id",
    });
  });
});

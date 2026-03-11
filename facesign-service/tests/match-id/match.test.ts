// biome-ignore-all lint/suspicious/noExplicitAny: Test files often need any
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import agent from "../../providers/agent.ts";
import app from "../../server.ts";
import { match3d2dIdHandler, requestCapture } from "../utils/msw-handlers.ts";
import { server } from "../utils/msw-server.ts";

describe("Match ID document API", () => {
  it("image match (level 7) - success", async () => {
    server.use(
      match3d2dIdHandler({
        success: true,
        result: { matchLevel: 7 },
        didError: false,
      }),
    );

    const agentSpy = vi.spyOn(agent, "writeLog").mockImplementation(() => {});

    const response = await request(app).post("/relay/match-id-doc").send({
      userId: "test-user-id",
      image: "test-image",
      minMatchLevel: 7,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      didError: false,
      launchId: expect.any(String),
      result: { matchLevel: 7 },
      success: true,
    });

    expect(agentSpy).toHaveBeenCalledWith("match-id-request", {
      userId: "test-user-id",
      minMatchLevel: 7,
    });

    // Verify FaceTec API calls
    const match3d2dId = requestCapture.getLastByEndpoint("/match-3d-2d-3rdparty-idphoto");
    expect(match3d2dId?.body).toMatchObject({
      externalDatabaseRefID: "test-user-id",
      image: "test-image",
      minMatchLevel: 7,
    });
  });
});

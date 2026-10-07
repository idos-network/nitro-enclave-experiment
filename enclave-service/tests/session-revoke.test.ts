import request from "supertest";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { app, createSession, deleteSession, resetMocks } from "./app.ts";
import { audience, sessionBody } from "./helpers.ts";

describe("POST /session/revoke", () => {
  beforeEach(resetMocks);

  it("revokes the session so it can no longer be used", async () => {
    const session = await createSession();
    const { session: proof } = sessionBody(session, nacl.randomBytes(32), audience);

    await request(app).post("/session/revoke").send({ session: proof }).expect(204);
    expect(deleteSession()).toHaveBeenCalledWith(session.id);

    await request(app)
      .post("/session/public-key")
      .send(sessionBody(session, nacl.randomBytes(32), audience))
      .expect(404);
  });

  it("returns 404 without deleting when the caller can't prove the client key", async () => {
    const session = await createSession();
    session.sessionClientKeyPair = nacl.box.keyPair();
    const { session: proof } = sessionBody(session, nacl.randomBytes(32), audience);

    await request(app).post("/session/revoke").send({ session: proof }).expect(404);
    expect(deleteSession()).not.toHaveBeenCalled();
  });
});

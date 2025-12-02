import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import { GROUP_NAME, JWT_PRIVATE_KEY } from "../env.ts";
import agent from "../providers/agent.ts";
import {
  convertToVector,
  enrollment3d,
  enrollUser,
  searchForDuplicates,
} from "../providers/api.ts";
import { countMembersInGroup, getOldestFaceSignUserId, insertMember } from "../providers/db.ts";

// Pinocchio 3D Login
export default async function handler(req: Request, res: Response) {
  let faceSignUserId: string = crypto.randomUUID();

  const { requestBlob, faceVector = true } = req.body;

  try {
    // First check if liveness is proven
    const { success, livenessProven, responseBlob } = await enrollment3d(
      faceSignUserId,
      requestBlob,
    );

    // If there is "just" a response blob, we should return it to client
    // this is used when session starts or it's wrong image.
    // This looks like a replacement of the previous "challenge" mechanism.
    if (responseBlob && success === undefined) {
      agent.writeLog("pinnocchio-enrollment-response-blob", {});

      return res.status(200).json({
        responseBlob,
      });
    }

    if (!success || !livenessProven) {
      agent.writeLog("pinocchio-enrollment-failed", { success, livenessProven });

      return res.status(400).json({
        success,
        livenessProven,
        error: true,
        errorMessage: "Liveness check or enrollment 3D failed and was not processed.",
      });
    }

    // Search for 3d-db duplicates
    let results: { identifier: string; matchLevel: number }[] = [];

    const searchResult = await searchForDuplicates(faceSignUserId, GROUP_NAME);

    if (searchResult.success) {
      results = searchResult.results;
    } else if (
      searchResult.error &&
      searchResult.errorMessage?.includes("groupName when that groupName does not exist")
    ) {
      // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
      const memberCount = await countMembersInGroup(GROUP_NAME);
      if (memberCount > 0) {
        throw new Error("Group exists in our DB, but not in 3d-db, this should never happen.");
      }

      console.log("Group does not exist, creating one by enrolling first user.");
      results = [];
    } else {
      throw new Error("Failed to search for duplicates, check application logs.");
    }

    const newUser = results.length === 0;

    if (newUser) {
      // Brand new user, let's enroll in 3d-db#users
      agent.writeLog("pinocchio-new-user", { identifier: faceSignUserId });

      if (faceVector) {
        await convertToVector(faceSignUserId);
      }

      await enrollUser(faceSignUserId, GROUP_NAME);
      await insertMember(GROUP_NAME, faceSignUserId);
    } else {
      // This is a difference from normal /login route
      agent.writeLog("pinocchio-duplicate", {
        identifiers: results.map((x) => x.identifier),
        count: results.length,
      });

      // Choose the "first" one (oldest one)
      // TODO: Check this ...
      faceSignUserId = await getOldestFaceSignUserId(results.map((x) => x.identifier));
    }

    // Issue JWT token
    const token = jwt.sign(
      { sub: faceSignUserId },
      readFileSync(JWT_PRIVATE_KEY, "utf-8"),
      { algorithm: "ES512" }, // Token contains "iat" which is used in entropy-service to check token age
    );

    return res.status(200).json({
      success,
      livenessProven,
      error: false,
      faceSignUserId,
      token,
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      agent.writeLog("pinocchio-error", { message: "Unknown error in /login", error });
    } else {
      agent.writeLog("pinocchio-error", { message: error.message, stack: error.stack });
    }

    return res.status(500).json({
      success: false,
      livenessProven: false,
      error: true,
      // biome-ignore lint/suspicious/noExplicitAny: We want to show the message even if error is not an instance of Error
      errorMessage: `Login process failed, check server logs: ${(error as any).message}`,
    });
  }
}

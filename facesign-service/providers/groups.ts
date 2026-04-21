import agent from "./agent.ts";
import { enrollUser, searchForDuplicates } from "./api.ts";
import { countMembersInGroup, getOldestFaceSignUserId, insertMember } from "./db.ts";
import { FFRError, InternalServerError } from "./errors.ts";

export async function findOrEnrollInGroup({
  userId,
  groupName,
  launchId,
  process,
  enrollIfNew,
  minMatchLevel,
}: {
  userId: string;
  groupName: string;
  launchId: string;
  minMatchLevel: number;
  enrollIfNew: boolean;
  process: "uniqueness" | "facesign";
}): Promise<{
  groupUserId: string;
  newUser: boolean;
}> {
  // Try to onboard into provided group name (deduplication)
  let results: { identifier: string; matchLevel: number }[] = [];

  if (process === "facesign" && minMatchLevel !== 15) {
    throw new Error("Invalid combination of parameters, facesign allows minMatchLevel = 15 only.");
  }

  const searchResult = await searchForDuplicates({ userId, groupName, minMatchLevel });

  if (searchResult.success) {
    results = searchResult.results;
  } else if (
    searchResult.error &&
    searchResult.errorMessage?.includes("groupName when that groupName does not exist")
  ) {
    // Check if group exists in DB, if yes, we have a problem (most likely recovery from corrupted FS)
    const memberCount = await countMembersInGroup(groupName);
    if (memberCount > 0) {
      agent.writeLog("group-resolution-db-inconsistent", {
        process,
        userId,
        groupName,
        launchId,
      });
      throw new InternalServerError(
        "Group exists in our DB, but not in 3d-db, this should never happen.",
      );
    }

    agent.writeLog("group-resolution-bootstrap-group", {
      process,
      userId,
      groupName,
      launchId,
    });
    results = [];
  } else {
    throw new InternalServerError("Failed to search for duplicates, check application logs.");
  }

  const newUser = results.length === 0;

  if (newUser && enrollIfNew) {
    // Brand new user, let's enroll in 3d-db#users
    agent.writeLog("group-resolution-new-user-enrolled", {
      process,
      userId,
      groupName,
      launchId,
      minMatchLevel,
    });

    await enrollUser({ userId, groupName });
    await insertMember({ groupName, userId });

    return { groupUserId: userId, newUser: true };
  }

  if (newUser && !enrollIfNew) {
    // Brand new user, but we don't want to enroll it
    agent.writeLog("group-resolution-new-user-deferred", {
      process,
      userId,
      groupName,
      launchId,
      minMatchLevel,
    });

    return { groupUserId: userId, newUser: true };
  }

  if (results.length > 1 && process === "uniqueness") {
    // FFRs are not allowed in uniqueness process
    agent.writeLog("group-resolution-ffr-rejected", {
      process,
      userId,
      matchedUserIds: results.map((x) => x.identifier),
      count: results.length,
      groupName,
      launchId,
      minMatchLevel,
    });

    // The audit trail will be deleted in 14 days by cron job

    // Non-recoverable error
    throw new FFRError(
      "Enrollment process failed, multiple users found with the same face-vector.",
    );
  }

  if (results.length > 1 && process === "facesign") {
    // FFRs are allowed in facesign process
    const matchedUserIds = results.map((x) => x.identifier);

    const resolvedUserId = await getOldestFaceSignUserId(matchedUserIds);

    agent.writeLog("group-resolution-ffr-resolved", {
      process,
      userId,
      resolvedUserId,
      matchedUserIds,
      count: results.length,
      groupName,
      launchId,
      minMatchLevel,
    });

    return { groupUserId: resolvedUserId, newUser: false };
  }

  if (results.length === 1) {
    const resolvedUserId = results[0]?.identifier;

    if (!resolvedUserId) {
      throw new InternalServerError(
        "Group search identifier is empty in the results, check server logs.",
      );
    }

    agent.writeLog("group-resolution-existing-user", {
      process,
      userId,
      resolvedUserId,
      matchedUserIds: results.map((x) => x.identifier),
      count: results.length,
      groupName,
      launchId,
      minMatchLevel,
    });

    return {
      groupUserId: resolvedUserId,
      newUser: false,
    };
  }

  throw new InternalServerError("Group resolution failed, check server logs.");
}

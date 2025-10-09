import { FACETEC_SERVER } from "../env.ts";

export async function getSessionToken(key: string, deviceIdentifier: string) {
  const response = await fetch(`${FACETEC_SERVER}session-token`, {
    method: "GET",
    headers: {
      "X-Device-Key": key,
      "X-Device-Identifier": deviceIdentifier,
    },
  });

  if (!response.ok) {
    console.error("Failed to get session token, status:", response.status);
    console.error("Response text:", response.text);
    throw new Error(`Failed to get session token, status: ${response.status}`);
  }

  const { sessionToken } = (await response.json()) as { sessionToken: string };

  return sessionToken;
}

export async function enrollment3d(
  externalDatabaseRefID: string,
  faceScan: string,
  auditTrailImage: string,
  lowQualityAuditTrailImage: string,
  key: string,
  deviceIdentifier: string,
  sessionId: string,
  storeAsFaceVector: boolean,
) {
  const enrollmentResponse = await fetch(`${FACETEC_SERVER}enrollment-3d`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Key": key,
      "X-Device-Identifier": deviceIdentifier,
    },
    body: JSON.stringify({
      faceScan,
      auditTrailImage,
      lowQualityAuditTrailImage,
      externalDatabaseRefID,
      sessionId,
      storeAsFaceVector,
    }),
  });

  if (!enrollmentResponse.ok) {
    console.error("Failed to enroll, status:", enrollmentResponse.status);
    console.error("Response text:", await enrollmentResponse.text());
    throw new Error("Failed to enroll, check for logs.");
  }

  return enrollmentResponse.json() as Promise<{
    success: boolean;
    wasProcessed: boolean;
    scanResultBlob?: string;
    error?: string;
    errorMessage?: string;
  }>;
}

export async function match3d3d(
  externalDatabaseRefID: string,
  faceScan: string,
  auditTrailImage: string,
  lowQualityAuditTrailImage: string,
  key: string,
  deviceIdentifier: string,
  sessionId: string,
) {
  const matchResponse = await fetch(`${FACETEC_SERVER}match-3d-3d`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Key": key,
      "X-Device-Identifier": deviceIdentifier,
    },
    body: JSON.stringify({
      faceScan,
      auditTrailImage,
      lowQualityAuditTrailImage,
      externalDatabaseRefID,
      sessionId,
    }),
  });

  if (!matchResponse.ok) {
    console.error("Failed to match, status:", matchResponse.status);
    console.error("Response text:", await matchResponse.text());
    throw new Error("Failed to match, check for logs.");
  }

  return matchResponse.json() as Promise<{
    success: boolean;
    wasProcessed: boolean;
    matchLevel?: number;
    retryScreenEnumInt?: number;
    scanResultBlob?: string;
    error?: string;
    errorMessage?: string;
    faceScanSecurityChecks: {
      replayCheckSucceeded: boolean;
      sessionTokenCheckSucceeded: boolean;
      auditTrailVerificationCheckSucceeded: boolean;
      faceScanLivenessCheckSucceeded: boolean;
    };
  }>;
}

export async function searchForDuplicates(
  externalDatabaseRefID: string,
  key: string,
  groupName: string,
  deviceIdentifier?: string,
) {
  const response = await fetch(`${FACETEC_SERVER}3d-db/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Key": key,
      "X-Device-Identifier": deviceIdentifier,
    },
    body: JSON.stringify({
      externalDatabaseRefID,
      groupName,
      minMatchLevel: 15,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to search for duplicates, check application logs.");
  }

  return response.json() as Promise<{
    success: boolean;
    results: Array<{ identifier: string; matchLevel: number }>;
    error?: string;
    errorMessage?: string;
  }>;
}

export async function enrollUser(externalDatabaseRefID: string, groupName: string, key: string) {
  const response = await fetch(`${FACETEC_SERVER}3d-db/enroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Key": key,
    },
    body: JSON.stringify({
      externalDatabaseRefID,
      groupName,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to enroll user into 3d-db, check application logs.");
  }

  return response.json();
}

import { FACETEC_SERVER } from "../env.ts";

export async function getStatus() {
  // https://dev.facetec.com/api-guide#status
  const response = await fetch(`${FACETEC_SERVER}status`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Failed to get status, status: ${response.status}`);
  }

  const data = (await response.json()) as { running: boolean, success: boolean, error?: string, serverInfo: any };

  return data;
}

export async function enrollment3d(
  requestBlob: string,
  externalDatabaseRefID: string,
) {
  const enrollmentResponse = await fetch(`${FACETEC_SERVER}process-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // TODO: MISSING STORE AS VECTOR!
      externalDatabaseRefID,
      requestBlob,
    }),
  });

  if (!enrollmentResponse.ok) {
    console.error("Failed to enroll, status:", enrollmentResponse.status);
    console.error("Response text:", await enrollmentResponse.text());
    throw new Error("Failed to enroll, check for logs.");
  }

  return enrollmentResponse.json() as Promise<{
    livenessProven: boolean,
    success: boolean;
  }>;
}

export async function match3d3d(
  externalDatabaseRefID: string,
  requestBlob: string,
) {
  const matchResponse = await fetch(`${FACETEC_SERVER}process-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID,
      requestBlob,
    }),
  });

  if (!matchResponse.ok) {
    console.error("Failed to match, status:", matchResponse.status);
    console.error("Response text:", await matchResponse.text());
    throw new Error("Failed to match, check for logs.");
  }

  return matchResponse.json() as Promise<{
    livenessProven: boolean;
    matchLevel?: number;
    success: boolean;
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

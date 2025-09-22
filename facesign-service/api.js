import { FACETEC_SERVER } from "./env.js";

export async function getSessionToken(key, deviceIdentifier) {
  const response = await fetch(`${FACETEC_SERVER}session-token`, {
    method: 'GET',
    headers: {
      'X-Device-Key': key,
      'X-Device-Identifier': deviceIdentifier,
    },
  });

  if (!response.ok) {
    console.error("Failed to get session token, status:", response.status);
    console.error("Response text:", response.text);
    throw new Error(`Failed to get session token, status: ${response.status}`);
  }

  const { sessionToken } = await response.json();

  return sessionToken;
}

export async function enrollment3d(externalDatabaseRefID, faceScan, auditTrailImage, lowQualityAuditTrailImage, key, deviceIdentifier, sessionId) {
  const enrollmentResponse = await fetch(`${FACETEC_SERVER}enrollment-3d`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Key': key,
      'X-Device-Identifier': deviceIdentifier,
    },
    body: JSON.stringify({
      faceScan,
      auditTrailImage,
      lowQualityAuditTrailImage,
      externalDatabaseRefID,
      sessionId,
      storeAsFaceVector: true,
    }),
  });

  if (!enrollmentResponse.ok) {
    console.error("Failed to enroll, status:", enrollmentResponse.status);
    console.error("Response text:", await enrollmentResponse.text());
    throw new Error('Failed to enroll, check for logs.');
  }

  return enrollmentResponse.json();
}

export async function searchForDuplicates(externalDatabaseRefID, key, groupName, deviceIdentifier) {
  const response = await fetch(`${FACETEC_SERVER}3d-db/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Key': key,
      'X-Device-Identifier': deviceIdentifier,
    },
    body: JSON.stringify({
      externalDatabaseRefID,
      groupName,
      minMatchLevel: 10, // Adjust as needed
    }),
  });

  if (!response.ok) {
    return res.status(500).json({
      success: false,
      message: 'Failed to search for duplicates, check application logs.',
    });
  }

  return response.json();
}

export async function enrollUser(externalDatabaseRefID, groupName, key) {
  const response = await fetch(`${FACETEC_SERVER}3d-db/enroll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Key': key,
    },
    body: JSON.stringify({
      externalDatabaseRefID,
      groupName,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to enroll user into 3d-db, check application logs.');
  }

  return response.json();
}

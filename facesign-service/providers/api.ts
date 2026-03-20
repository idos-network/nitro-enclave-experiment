import { FACETEC_SERVER } from "../env.ts";
import { Enrollment3DRecoverableError, FaceTecError, SessionStartError } from "./errors.ts";

export interface StatusResponse {
  coreServerSDKVersion: string;
  facetecServerWebserviceVersion: string;
  uptime: number;
  machineID: string;
  instanceID: string;
  notice: string;
}

export interface Enrollment3DResponseData {
  success: boolean;
  responseBlob: string;
  didError: boolean;
  additionalSessionData: {
    platform: string;
    deviceModel: string;
    userAgent: string;
  };
  result: {
    livenessProven: boolean;
  };
}

function checkSessionStartResponse(response: ProcessRequestResponse) {
  if (response.success === undefined && response.responseBlob !== undefined) {
    throw new SessionStartError(response.responseBlob, response.launchId);
  }
}

function checkEnrollment3dRecoverableError(response: ProcessRequestResponse) {
  if (
    response.success === false ||
    response.result?.livenessProven === false ||
    response.didError === true
  ) {
    throw new Enrollment3DRecoverableError(response);
  }
}

export async function getStatus() {
  // https://dev.facetec.com/api-guide#status
  const response = await fetch(`${FACETEC_SERVER}status`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Failed to get status, status: ${response.status}`);
  }

  const data = (await response.json()) as {
    running: boolean;
    success: boolean;
    error?: string;
    serverInfo: StatusResponse;
  };

  return data;
}

export interface ProcessRequestResponse {
  externalDatabaseRefID: string;
  additionalSessionData: {
    platform: string;
    appID: string;
    installationID: string;
    deviceModel: string;
    deviceSDKVersion: string;
    userAgent: string;
    sessionID: string;
  };
  success: boolean;
  responseBlob: string;
  result: {
    livenessProven: boolean;
    ageV2GroupEnumInt?: number;
    matchLevel?: number;
  };
  isLikelyOnFraudList: boolean;
  isLikelyDuplicate: boolean;
  enrollForSearchAllUserListResult: boolean;
  launchId: string;
  httpCallInfo: {
    tid: string;
    path: "/process-request";
    date: string;
    epochSecond: number;
    requestMethod: "POST";
  };
  didError: boolean;
  serverInfo: StatusResponse;
}

export async function enrollment3d({
  userId,
  requestBlob,
  faceVector,
  storeSelfie,
}: {
  userId: string;
  requestBlob: string;
  faceVector: boolean;
  storeSelfie: boolean;
}) {
  const enrollmentResponse = await fetch(`${FACETEC_SERVER}process-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID: userId,
      requestBlob,
      storeAsFaceVector: faceVector,
      storeAuditTrailImages: storeSelfie,
      storeIdImage: false,
    }),
  });

  if (!enrollmentResponse.ok) {
    throw new FaceTecError(
      "enrollment3d",
      {
        code: enrollmentResponse.status,
        body: await enrollmentResponse.text(),
      },
      {
        userId,
      },
    );
  }

  const response = (await enrollmentResponse.json()) as ProcessRequestResponse;

  checkSessionStartResponse(response);
  checkEnrollment3dRecoverableError(response);

  return response;
}

export async function match3d3d(
  {
  userId,
  requestBlob,
  storeSelfie,
}: {
  userId: string;
  requestBlob: string;
  storeSelfie: boolean;
  }
) {
  const matchResponse = await fetch(`${FACETEC_SERVER}process-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID: userId,
      requestBlob,
      storeAuditTrailImages: storeSelfie,
      storeIdImage: false,
    }),
  });

  if (!matchResponse.ok) {
    throw new FaceTecError(
      "match3d3d",
      {
        code: matchResponse.status,
        body: await matchResponse.text(),
      },
      {
        userId,
      },
    );
  }

  const response = (await matchResponse.json()) as ProcessRequestResponse;

  checkSessionStartResponse(response);

  return response;
}

export async function match3d2dId({
  userId,
  image,
  minMatchLevel,
}: {
  userId: string;
  image: string;
  minMatchLevel: number;
}) {
  const matchIdDocResponse = await fetch(`${FACETEC_SERVER}match-3d-2d-3rdparty-idphoto`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID: userId,
      image,
      minMatchLevel,
    }),
  });

  if (!matchIdDocResponse.ok) {
    throw new FaceTecError("match3d2dId", {
      code: matchIdDocResponse.status,
      body: await matchIdDocResponse.text(),
    });
  }

  const response = (await matchIdDocResponse.json()) as ProcessRequestResponse;

  checkSessionStartResponse(response);

  return response;
}

export async function searchForDuplicates({
  userId,
  groupName,
}: {
  userId: string;
  groupName: string;
}) {
  const response = await fetch(`${FACETEC_SERVER}3d-db/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID: userId,
      groupName,
      minMatchLevel: 15,
    }),
  });

  if (!response.ok) {
    throw new FaceTecError(
      "search-3d-db",
      {
        code: response.status,
        body: await response.text(),
      },
      {
        userId,
        groupName,
      },
    );
  }

  return response.json() as Promise<{
    success: boolean;
    results: Array<{ identifier: string; matchLevel: number }>;
    error?: string;
    errorMessage?: string;
  }>;
}

export async function enrollUser({ userId, groupName }: { userId: string; groupName: string }) {
  const response = await fetch(`${FACETEC_SERVER}3d-db/enroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID: userId,
      groupName,
    }),
  });

  if (!response.ok) {
    throw new FaceTecError(
      "enroll-user",
      {
        code: response.status,
        body: await response.text(),
      },
      {
        userId,
        groupName,
      },
    );
  }

  return response.json();
}

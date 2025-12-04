import { FACETEC_SERVER } from "../env.ts";

export interface StatusResponse {
  coreServerSDKVersion: string;
  facetecServerWebserviceVersion: string;
  uptime: number;
  machineID: string;
  instanceID: string;
  notice: string;
}

export class SessionStartError extends Error {
  public readonly responseBody: string;

  constructor(responseBody: string) {
    super("Session Start Response");
    this.responseBody = responseBody;
  }
}

export class FaceTecError extends Error {
  public readonly methodName: string;
  public readonly response: {
    code: number;
    body: string;
  };
  public readonly others: Record<string, unknown> = {};

  constructor(
    methodName: string,
    response: {
      code: number;
      body: string;
    },
    others: Record<string, unknown> = {},
  ) {
    super("Unexpected FaceTec API Error");
    this.methodName = methodName;
    this.response = response;
    this.others = others;
  }
}

function checkSessionStartResponse(response: ProcessRequestResponse) {
  if (response.success === undefined && response.responseBlob !== undefined) {
    throw new SessionStartError(response.responseBlob);
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

export async function enrollment3d(externalDatabaseRefID: string, requestBlob: string) {
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
    throw new FaceTecError(
      "enrollment3d",
      {
        code: enrollmentResponse.status,
        body: await enrollmentResponse.text(),
      },
      {
        externalDatabaseRefID,
      },
    );
  }

  const response = (await enrollmentResponse.json()) as ProcessRequestResponse;

  checkSessionStartResponse(response);

  console.log(response);

  return response;
}

export async function convertToVector(externalDatabaseRefID: string) {
  const convertToVectorResponse = await fetch(`${FACETEC_SERVER}convert-facemap-to-face-vector`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID,
    }),
  });

  if (!convertToVectorResponse.ok) {
    throw new FaceTecError(
      "convertToVector",
      {
        code: convertToVectorResponse.status,
        body: await convertToVectorResponse.text(),
      },
      {
        externalDatabaseRefID,
      },
    );
  }

  return convertToVectorResponse.json() as Promise<{
    success: boolean;
  }>;
}

export async function match3d3d(externalDatabaseRefID: string, requestBlob: string) {
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
    throw new FaceTecError(
      "match3d3d",
      {
        code: matchResponse.status,
        body: await matchResponse.text(),
      },
      {
        externalDatabaseRefID,
      },
    );
  }

  const response = (await matchResponse.json()) as ProcessRequestResponse;

  checkSessionStartResponse(response);

  return response;
}

export async function searchForDuplicates(externalDatabaseRefID: string, groupName: string) {
  const response = await fetch(`${FACETEC_SERVER}3d-db/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID,
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
        externalDatabaseRefID,
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

export async function enrollUser(externalDatabaseRefID: string, groupName: string) {
  const response = await fetch(`${FACETEC_SERVER}3d-db/enroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalDatabaseRefID,
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
        externalDatabaseRefID,
        groupName,
      },
    );
  }

  return response.json();
}

import type { ProcessRequestResponse } from "./api.ts";

export class SessionStartError extends Error {
  public readonly responseBody: string;
  public readonly launchId: string;

  constructor(responseBody: string, launchId: string) {
    super("Session Start Response");
    this.responseBody = responseBody;
    this.launchId = launchId;
  }
}

export class Enrollment3DRecoverableError extends Error {
  public readonly response: ProcessRequestResponse;

  constructor(response: ProcessRequestResponse) {
    super("Liveness check or enrollment 3D failed and was not processed.");
    this.response = response;
  }
}

export class FaceTecError extends Error {
  public readonly methodName: string;
  public readonly response: {
    code: number;
    body: string;
  };
  public readonly others: Record<string, unknown>;

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

export class FFRError extends Error {}

export class InternalServerError extends Error {}

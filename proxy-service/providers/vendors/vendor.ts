import { z } from "zod";

export const ENVIRONMENTS = ["production", "sandbox"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface UpstreamCall {
  method: string;
  url: URL;
  body: Buffer | undefined;
}

/**
 * One adapter per vendor: validates the armed `auth`, owns the origins that secret may ever be
 * sent to, and builds the headers that authorize each upstream call.
 */
export interface Vendor<Auth extends z.ZodType = z.ZodType> {
  readonly auth: Auth;
  // Baked into the enclave image, so the host cannot point a secret anywhere else.
  readonly origins: Record<Environment, string>;
  authorize(auth: z.output<Auth>, call: UpstreamCall): Promise<Record<string, string>>;
}

export const ApiKeyAuthSchema = z.object({ apiKey: z.string().min(1) });
export type ApiKeyAuth = z.output<typeof ApiKeyAuthSchema>;

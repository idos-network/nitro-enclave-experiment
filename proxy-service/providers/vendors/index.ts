import type { ArmRequest } from "../../utils/dto.ts";
import { Iron } from "./iron.ts";
import { Kalshi } from "./kalshi.ts";
import { Mock } from "./mock.ts";
import { Moonpay } from "./moonpay.ts";
import { Persona } from "./persona.ts";
import { Sumsub } from "./sumsub.ts";
import type { UpstreamCall, Vendor } from "./vendor.ts";

export { ENVIRONMENTS, type Environment, type UpstreamCall, type Vendor } from "./vendor.ts";

export const vendors = {
  iron: new Iron(),
  moonpay: new Moonpay(),
  persona: new Persona(),
  sumsub: new Sumsub(),
  kalshi: new Kalshi(),
  mock: new Mock(),
};

export type Api = keyof typeof vendors;

export function authorize(armed: Pick<ArmRequest, "api" | "auth">, call: UpstreamCall) {
  // TS cannot correlate `api` with `auth` across the union; ArmRequestSchema guarantees they match.
  return (vendors[armed.api] as Vendor).authorize(armed.auth, call);
}

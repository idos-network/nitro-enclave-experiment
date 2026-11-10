import { createValidatorMiddleware } from "@idos/tee-common/validator.ts";
import { writeLog } from "../utils/logger-context.ts";

/**
 * Parse RequestSchema and return 400 on bad body
 */
export const validatorMiddleware = createValidatorMiddleware(writeLog);

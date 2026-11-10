import type { RequestHandler } from "express";

// What the middleware needs from a zod schema, so this package does not depend on zod
export interface Schema {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: { issues: { path: PropertyKey[]; code: string }[] } };
}

/**
 * Returns a middleware factory: parse the body with the given schema, put the result in
 * res.locals.validatedBody, and answer 400 on a bad body after reporting it to `onInvalid`.
 */
export function createValidatorMiddleware(onInvalid: (error: unknown) => void) {
  return (schema: Schema): RequestHandler => {
    return async (req, res, next) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        onInvalid(parsed.error);

        const issues = parsed.error.issues.map(({ path, code }) => ({
          path: path.join("."),
          code,
        }));

        return res.status(400).json({ error: "Invalid request body", details: issues });
      }

      res.locals.validatedBody = parsed.data;
      return next();
    };
  };
}

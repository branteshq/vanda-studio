import { v } from "convex/values";
import { errorCode, errorCodes, errorCopy } from "../errors";

export const errorCodeValidator = v.union(...errorCodes.map((code) => v.literal(code)));

/** Reduce any exception to catalogued copy before it crosses a durable/UI boundary. */
export const safeFailure = (cause: unknown) => {
  const code = errorCode(cause);

  return { code, message: errorCopy[code].message };
};

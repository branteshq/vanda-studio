import { v } from "convex/values";
import { errorCode, errorCopy, type ErrorCode } from "../errors";

export const errorCodeValidator = v.union(
  ...Object.keys(errorCopy).map((code) => v.literal(code as ErrorCode)),
);

/** Reduce any exception to catalogued copy before it crosses a durable/UI boundary. */
export const safeFailure = (error: unknown): { code: ErrorCode; message: string } => {
  const code = errorCode(error);
  return { code, message: errorCopy[code].message };
};

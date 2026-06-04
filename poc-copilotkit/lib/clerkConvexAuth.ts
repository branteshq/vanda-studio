import { getAuth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { loadRootEnv } from "./loadRootEnv";

loadRootEnv();

export type ClerkConvexAuth =
  | {
      status: "signed-in";
      userId: string;
      convexAuthToken: string;
    }
  | {
      status: "signed-out" | "token-error";
      userId: string | null;
      reason: string;
    };

export async function getClerkConvexAuth(req: NextRequest): Promise<ClerkConvexAuth> {
  const auth = getAuth(req);
  if (!auth.userId) {
    return {
      status: "signed-out",
      userId: null,
      reason: "No Clerk user is signed in for this POC request.",
    };
  }

  try {
    const convexAuthToken = await auth.getToken({ template: "convex" });
    if (!convexAuthToken) {
      return {
        status: "token-error",
        userId: auth.userId,
        reason: "Clerk did not return a Convex JWT from the 'convex' token template.",
      };
    }

    return {
      status: "signed-in",
      userId: auth.userId,
      convexAuthToken,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Clerk token error.";
    return {
      status: "token-error",
      userId: auth.userId,
      reason: `Failed to get Clerk Convex JWT from template 'convex': ${message}`,
    };
  }
}

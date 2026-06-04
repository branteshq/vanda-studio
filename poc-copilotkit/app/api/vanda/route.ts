import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getClerkConvexAuth } from "../../../lib/clerkConvexAuth";
import { getVandaSnapshot } from "../../../lib/vandaData";

export async function GET(req: NextRequest) {
  const auth = await getClerkConvexAuth(req);
  const snapshot = await getVandaSnapshot(undefined, {
    convexAuthToken: auth.status === "signed-in" ? auth.convexAuthToken : null,
    authFallbackReason: auth.status === "signed-in" ? null : auth.reason,
  });

  return NextResponse.json({
    ...snapshot,
    auth: {
      status: auth.status,
      userId: auth.userId,
      reason: auth.status === "signed-in" ? null : auth.reason,
    },
  });
}

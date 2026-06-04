import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { NextRequest } from "next/server";
import { getClerkConvexAuth } from "../../../lib/clerkConvexAuth";
import { createVandaAgent } from "../../../lib/copilotTools";

export const POST = async (req: NextRequest) => {
  const auth = await getClerkConvexAuth(req);
  const runtime = new CopilotRuntime({
    agents: {
      default: createVandaAgent({
        convexAuthToken: auth.status === "signed-in" ? auth.convexAuthToken : null,
        authFallbackReason: auth.status === "signed-in" ? null : auth.reason,
      }),
    },
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};

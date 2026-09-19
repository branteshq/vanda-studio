import type { ContextHandler } from "@convex-dev/agent";
import { compactInstagramHistory } from "./instagram/toolSummary";

/** Dynamic turn data follows history so it cannot invalidate the reusable prefix. */
export const turnContext =
  (clock: string): ContextHandler =>
  (_ctx, { search, recent, inputMessages, inputPrompt, existingResponses }) => [
    ...compactInstagramHistory([...search, ...recent, ...inputMessages]),
    { role: "user", content: clock },
    ...inputPrompt,
    ...existingResponses,
  ];

import type { ToolCtx } from "@convex-dev/agent";
import type { ToolExecutionOptions } from "ai";
import { internal } from "./_generated/api";
import type { CapabilityResult } from "./resourceRefs";

type ManifestToolCtx = ToolCtx & { readonly promptMessageId?: string | undefined };

/** Persist a tool's resource result without coupling it to any channel renderer. */
export const recordCapabilityResult = async <Data>(
  ctx: ManifestToolCtx,
  options: ToolExecutionOptions,
  result: CapabilityResult<Data>,
): Promise<CapabilityResult<Data>> => {
  const anchorMessageId = ctx.promptMessageId ?? ctx.messageId;
  if (
    ctx.threadId &&
    anchorMessageId &&
    (result.resources.length > 0 || result.presented.length > 0)
  ) {
    await ctx.runMutation(internal.threadResources.record, {
      threadId: ctx.threadId,
      anchorMessageId,
      toolCallId: options.toolCallId,
      resources: [...result.resources],
      presented: [...result.presented],
    });
  }
  return result;
};

"use node";

import { createDecipheriv, createHash } from "node:crypto";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { publishStoreLive, publisherLive } from "./pipeline/livePublish";
import { publishDue } from "./pipeline/publish";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/** Reverse of the AES-256-GCM token encryption in instagramGraphActions.ts. */
function decryptToken(connection: {
  readonly tokenCiphertext?: string | undefined;
  readonly tokenIv?: string | undefined;
  readonly tokenAuthTag?: string | undefined;
}): string {
  const { tokenCiphertext, tokenIv, tokenAuthTag } = connection;
  if (tokenCiphertext === undefined || tokenIv === undefined || tokenAuthTag === undefined) {
    throw new Error("connection has no stored token");
  }
  const key = createHash("sha256").update(requireEnv("INSTAGRAM_TOKEN_ENCRYPTION_KEY")).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(tokenIv, "base64"));
  decipher.setAuthTag(Buffer.from(tokenAuthTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(tokenCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Scheduler target for a due scheduled post: resolve the account's Instagram
 * connection, decrypt its token, and run the publish program against the live
 * Graph API. The program records the outcome on the scheduled-post row.
 */
export const runScheduledPost = internalAction({
  args: { scheduledPostId: v.id("scheduledPosts") },
  handler: async (ctx, { scheduledPostId }) => {
    // The credential phase (connection lookup + token decrypt) runs before
    // publishDue, so its failures are recorded here; publishDue records its own
    // publish-phase failures. Either way the row never strands at "scheduled".
    let igUserId: string;
    let token: string;
    try {
      const connection = await ctx.runQuery(internal.publishScheduled.getPublishConnection, {
        scheduledPostId,
      });
      if (connection === null) throw new Error("no_connected_account");
      igUserId = connection.igUserId;
      token = decryptToken(connection);
    } catch (error) {
      await ctx.runMutation(internal.publishScheduled.setScheduledStatus, {
        scheduledPostId,
        status: "failed",
        lastError: error instanceof Error ? error.message : "credential_error",
      });
      return;
    }
    const layer = Layer.mergeAll(publishStoreLive(ctx), publisherLive({ igUserId, token }));
    await Effect.runPromise(publishDue(scheduledPostId).pipe(Effect.provide(layer)));
  },
});

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { BrandContext } from "./brandContext";

export const brandContextLive = (ctx: ActionCtx): Layer.Layer<BrandContext> =>
  Layer.succeed(BrandContext, {
    load: (accountId) =>
      Effect.tryPromise(() => ctx.runQuery(internal.brandContext.load, { accountId })),
  });

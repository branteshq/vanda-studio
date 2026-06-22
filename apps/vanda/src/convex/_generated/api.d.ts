/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as autumn from "../autumn.js";
import type * as billing_autumn from "../billing/autumn.js";
import type * as crons from "../crons.js";
import type * as instagramGraph from "../instagramGraph.js";
import type * as instagramGraphActions from "../instagramGraphActions.js";
import type * as instagramToken from "../instagramToken.js";
import type * as observe from "../observe.js";
import type * as observeNode from "../observeNode.js";
import type * as pipeline_constants from "../pipeline/constants.js";
import type * as pipeline_discernment from "../pipeline/discernment.js";
import type * as pipeline_domain from "../pipeline/domain.js";
import type * as pipeline_liveObserve from "../pipeline/liveObserve.js";
import type * as pipeline_livePublish from "../pipeline/livePublish.js";
import type * as pipeline_memory from "../pipeline/memory.js";
import type * as pipeline_observe from "../pipeline/observe.js";
import type * as pipeline_publish from "../pipeline/publish.js";
import type * as pipeline_publisher from "../pipeline/publisher.js";
import type * as pipeline_signals from "../pipeline/signals.js";
import type * as pipeline_storage from "../pipeline/storage.js";
import type * as publishScheduled from "../publishScheduled.js";
import type * as publishScheduledNode from "../publishScheduledNode.js";
import type * as users from "../users.js";

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  autumn: typeof autumn;
  "billing/autumn": typeof billing_autumn;
  crons: typeof crons;
  instagramGraph: typeof instagramGraph;
  instagramGraphActions: typeof instagramGraphActions;
  instagramToken: typeof instagramToken;
  observe: typeof observe;
  observeNode: typeof observeNode;
  "pipeline/constants": typeof pipeline_constants;
  "pipeline/discernment": typeof pipeline_discernment;
  "pipeline/domain": typeof pipeline_domain;
  "pipeline/liveObserve": typeof pipeline_liveObserve;
  "pipeline/livePublish": typeof pipeline_livePublish;
  "pipeline/memory": typeof pipeline_memory;
  "pipeline/observe": typeof pipeline_observe;
  "pipeline/publish": typeof pipeline_publish;
  "pipeline/publisher": typeof pipeline_publisher;
  "pipeline/signals": typeof pipeline_signals;
  "pipeline/storage": typeof pipeline_storage;
  publishScheduled: typeof publishScheduled;
  publishScheduledNode: typeof publishScheduledNode;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;

export declare const components: {};

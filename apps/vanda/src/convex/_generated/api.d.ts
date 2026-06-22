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
import type * as consolidate from "../consolidate.js";
import type * as consolidateAction from "../consolidateAction.js";
import type * as crons from "../crons.js";
import type * as instagramGraph from "../instagramGraph.js";
import type * as instagramGraphActions from "../instagramGraphActions.js";
import type * as instagramToken from "../instagramToken.js";
import type * as observe from "../observe.js";
import type * as observeNode from "../observeNode.js";
import type * as pipeline_cassette from "../pipeline/cassette.js";
import type * as pipeline_consolidate from "../pipeline/consolidate.js";
import type * as pipeline_constants from "../pipeline/constants.js";
import type * as pipeline_discernment from "../pipeline/discernment.js";
import type * as pipeline_domain from "../pipeline/domain.js";
import type * as pipeline_liveConsolidate from "../pipeline/liveConsolidate.js";
import type * as pipeline_liveMemory from "../pipeline/liveMemory.js";
import type * as pipeline_liveModel from "../pipeline/liveModel.js";
import type * as pipeline_liveObserve from "../pipeline/liveObserve.js";
import type * as pipeline_livePlan from "../pipeline/livePlan.js";
import type * as pipeline_livePublish from "../pipeline/livePublish.js";
import type * as pipeline_memory from "../pipeline/memory.js";
import type * as pipeline_memoryStore from "../pipeline/memoryStore.js";
import type * as pipeline_observe from "../pipeline/observe.js";
import type * as pipeline_plan from "../pipeline/plan.js";
import type * as pipeline_publish from "../pipeline/publish.js";
import type * as pipeline_publisher from "../pipeline/publisher.js";
import type * as pipeline_signals from "../pipeline/signals.js";
import type * as pipeline_storage from "../pipeline/storage.js";
import type * as pipeline_suggestions from "../pipeline/suggestions.js";
import type * as pipeline_testLanguageModel from "../pipeline/testLanguageModel.js";
import type * as plan from "../plan.js";
import type * as planAction from "../planAction.js";
import type * as publishScheduled from "../publishScheduled.js";
import type * as publishScheduledNode from "../publishScheduledNode.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  autumn: typeof autumn;
  "billing/autumn": typeof billing_autumn;
  consolidate: typeof consolidate;
  consolidateAction: typeof consolidateAction;
  crons: typeof crons;
  instagramGraph: typeof instagramGraph;
  instagramGraphActions: typeof instagramGraphActions;
  instagramToken: typeof instagramToken;
  observe: typeof observe;
  observeNode: typeof observeNode;
  "pipeline/cassette": typeof pipeline_cassette;
  "pipeline/consolidate": typeof pipeline_consolidate;
  "pipeline/constants": typeof pipeline_constants;
  "pipeline/discernment": typeof pipeline_discernment;
  "pipeline/domain": typeof pipeline_domain;
  "pipeline/liveConsolidate": typeof pipeline_liveConsolidate;
  "pipeline/liveMemory": typeof pipeline_liveMemory;
  "pipeline/liveModel": typeof pipeline_liveModel;
  "pipeline/liveObserve": typeof pipeline_liveObserve;
  "pipeline/livePlan": typeof pipeline_livePlan;
  "pipeline/livePublish": typeof pipeline_livePublish;
  "pipeline/memory": typeof pipeline_memory;
  "pipeline/memoryStore": typeof pipeline_memoryStore;
  "pipeline/observe": typeof pipeline_observe;
  "pipeline/plan": typeof pipeline_plan;
  "pipeline/publish": typeof pipeline_publish;
  "pipeline/publisher": typeof pipeline_publisher;
  "pipeline/signals": typeof pipeline_signals;
  "pipeline/storage": typeof pipeline_storage;
  "pipeline/suggestions": typeof pipeline_suggestions;
  "pipeline/testLanguageModel": typeof pipeline_testLanguageModel;
  plan: typeof plan;
  planAction: typeof planAction;
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
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as authz from "../authz.js";
import type * as autumn from "../autumn.js";
import type * as billing_autumn from "../billing/autumn.js";
import type * as board from "../board.js";
import type * as brandContext from "../brandContext.js";
import type * as brandProfile from "../brandProfile.js";
import type * as brandProfileNode from "../brandProfileNode.js";
import type * as consolidate from "../consolidate.js";
import type * as consolidateAction from "../consolidateAction.js";
import type * as contentStudio from "../contentStudio.js";
import type * as contentStudioActions from "../contentStudioActions.js";
import type * as contentStudioNode from "../contentStudioNode.js";
import type * as contentStudioRender from "../contentStudioRender.js";
import type * as create from "../create.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as instagramGraph from "../instagramGraph.js";
import type * as instagramGraphActions from "../instagramGraphActions.js";
import type * as instagramToken from "../instagramToken.js";
import type * as instagramWebhook from "../instagramWebhook.js";
import type * as instagramWebhookNode from "../instagramWebhookNode.js";
import type * as knowledge from "../knowledge.js";
import type * as market from "../market.js";
import type * as marketActions from "../marketActions.js";
import type * as marketNode from "../marketNode.js";
import type * as modelTelemetry from "../modelTelemetry.js";
import type * as observe from "../observe.js";
import type * as observeNode from "../observeNode.js";
import type * as pipeline_brand from "../pipeline/brand.js";
import type * as pipeline_brandContext from "../pipeline/brandContext.js";
import type * as pipeline_brandProfile from "../pipeline/brandProfile.js";
import type * as pipeline_carouselRenderer from "../pipeline/carouselRenderer.js";
import type * as pipeline_cassette from "../pipeline/cassette.js";
import type * as pipeline_consolidate from "../pipeline/consolidate.js";
import type * as pipeline_constants from "../pipeline/constants.js";
import type * as pipeline_contentStudio from "../pipeline/contentStudio.js";
import type * as pipeline_create from "../pipeline/create.js";
import type * as pipeline_creativeDirector from "../pipeline/creativeDirector.js";
import type * as pipeline_discernment from "../pipeline/discernment.js";
import type * as pipeline_domain from "../pipeline/domain.js";
import type * as pipeline_embeddings from "../pipeline/embeddings.js";
import type * as pipeline_igGraph from "../pipeline/igGraph.js";
import type * as pipeline_imageGeneration from "../pipeline/imageGeneration.js";
import type * as pipeline_inputQuality from "../pipeline/inputQuality.js";
import type * as pipeline_liveBrand from "../pipeline/liveBrand.js";
import type * as pipeline_liveBrandContext from "../pipeline/liveBrandContext.js";
import type * as pipeline_liveConsolidate from "../pipeline/liveConsolidate.js";
import type * as pipeline_liveCreate from "../pipeline/liveCreate.js";
import type * as pipeline_liveMemory from "../pipeline/liveMemory.js";
import type * as pipeline_liveModel from "../pipeline/liveModel.js";
import type * as pipeline_liveObserve from "../pipeline/liveObserve.js";
import type * as pipeline_livePlan from "../pipeline/livePlan.js";
import type * as pipeline_livePublish from "../pipeline/livePublish.js";
import type * as pipeline_liveTelemetry from "../pipeline/liveTelemetry.js";
import type * as pipeline_market from "../pipeline/market.js";
import type * as pipeline_memory from "../pipeline/memory.js";
import type * as pipeline_memoryStore from "../pipeline/memoryStore.js";
import type * as pipeline_observe from "../pipeline/observe.js";
import type * as pipeline_plan from "../pipeline/plan.js";
import type * as pipeline_publish from "../pipeline/publish.js";
import type * as pipeline_publisher from "../pipeline/publisher.js";
import type * as pipeline_retrieval from "../pipeline/retrieval.js";
import type * as pipeline_signals from "../pipeline/signals.js";
import type * as pipeline_sourceUnderstanding from "../pipeline/sourceUnderstanding.js";
import type * as pipeline_storage from "../pipeline/storage.js";
import type * as pipeline_suggestions from "../pipeline/suggestions.js";
import type * as pipeline_testLanguageModel from "../pipeline/testLanguageModel.js";
import type * as pipeline_visualBrand from "../pipeline/visualBrand.js";
import type * as pipelineAdmin from "../pipelineAdmin.js";
import type * as pipelineAdminActions from "../pipelineAdminActions.js";
import type * as pipelineDiagnostics from "../pipelineDiagnostics.js";
import type * as plan from "../plan.js";
import type * as planAction from "../planAction.js";
import type * as publishScheduled from "../publishScheduled.js";
import type * as publishScheduledNode from "../publishScheduledNode.js";
import type * as steer from "../steer.js";
import type * as users from "../users.js";
import type * as visualBrand from "../visualBrand.js";
import type * as visualBrandNode from "../visualBrandNode.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  authz: typeof authz;
  autumn: typeof autumn;
  "billing/autumn": typeof billing_autumn;
  board: typeof board;
  brandContext: typeof brandContext;
  brandProfile: typeof brandProfile;
  brandProfileNode: typeof brandProfileNode;
  consolidate: typeof consolidate;
  consolidateAction: typeof consolidateAction;
  contentStudio: typeof contentStudio;
  contentStudioActions: typeof contentStudioActions;
  contentStudioNode: typeof contentStudioNode;
  contentStudioRender: typeof contentStudioRender;
  create: typeof create;
  crons: typeof crons;
  http: typeof http;
  instagramGraph: typeof instagramGraph;
  instagramGraphActions: typeof instagramGraphActions;
  instagramToken: typeof instagramToken;
  instagramWebhook: typeof instagramWebhook;
  instagramWebhookNode: typeof instagramWebhookNode;
  knowledge: typeof knowledge;
  market: typeof market;
  marketActions: typeof marketActions;
  marketNode: typeof marketNode;
  modelTelemetry: typeof modelTelemetry;
  observe: typeof observe;
  observeNode: typeof observeNode;
  "pipeline/brand": typeof pipeline_brand;
  "pipeline/brandContext": typeof pipeline_brandContext;
  "pipeline/brandProfile": typeof pipeline_brandProfile;
  "pipeline/carouselRenderer": typeof pipeline_carouselRenderer;
  "pipeline/cassette": typeof pipeline_cassette;
  "pipeline/consolidate": typeof pipeline_consolidate;
  "pipeline/constants": typeof pipeline_constants;
  "pipeline/contentStudio": typeof pipeline_contentStudio;
  "pipeline/create": typeof pipeline_create;
  "pipeline/creativeDirector": typeof pipeline_creativeDirector;
  "pipeline/discernment": typeof pipeline_discernment;
  "pipeline/domain": typeof pipeline_domain;
  "pipeline/embeddings": typeof pipeline_embeddings;
  "pipeline/igGraph": typeof pipeline_igGraph;
  "pipeline/imageGeneration": typeof pipeline_imageGeneration;
  "pipeline/inputQuality": typeof pipeline_inputQuality;
  "pipeline/liveBrand": typeof pipeline_liveBrand;
  "pipeline/liveBrandContext": typeof pipeline_liveBrandContext;
  "pipeline/liveConsolidate": typeof pipeline_liveConsolidate;
  "pipeline/liveCreate": typeof pipeline_liveCreate;
  "pipeline/liveMemory": typeof pipeline_liveMemory;
  "pipeline/liveModel": typeof pipeline_liveModel;
  "pipeline/liveObserve": typeof pipeline_liveObserve;
  "pipeline/livePlan": typeof pipeline_livePlan;
  "pipeline/livePublish": typeof pipeline_livePublish;
  "pipeline/liveTelemetry": typeof pipeline_liveTelemetry;
  "pipeline/market": typeof pipeline_market;
  "pipeline/memory": typeof pipeline_memory;
  "pipeline/memoryStore": typeof pipeline_memoryStore;
  "pipeline/observe": typeof pipeline_observe;
  "pipeline/plan": typeof pipeline_plan;
  "pipeline/publish": typeof pipeline_publish;
  "pipeline/publisher": typeof pipeline_publisher;
  "pipeline/retrieval": typeof pipeline_retrieval;
  "pipeline/signals": typeof pipeline_signals;
  "pipeline/sourceUnderstanding": typeof pipeline_sourceUnderstanding;
  "pipeline/storage": typeof pipeline_storage;
  "pipeline/suggestions": typeof pipeline_suggestions;
  "pipeline/testLanguageModel": typeof pipeline_testLanguageModel;
  "pipeline/visualBrand": typeof pipeline_visualBrand;
  pipelineAdmin: typeof pipelineAdmin;
  pipelineAdminActions: typeof pipelineAdminActions;
  pipelineDiagnostics: typeof pipelineDiagnostics;
  plan: typeof plan;
  planAction: typeof planAction;
  publishScheduled: typeof publishScheduled;
  publishScheduledNode: typeof publishScheduledNode;
  steer: typeof steer;
  users: typeof users;
  visualBrand: typeof visualBrand;
  visualBrandNode: typeof visualBrandNode;
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

export declare const components: {
  autumn: import("@useautumn/convex/_generated/component.js").ComponentApi<"autumn">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};

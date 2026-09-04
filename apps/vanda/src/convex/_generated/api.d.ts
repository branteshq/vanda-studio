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
import type * as agentModels from "../agentModels.js";
import type * as authz from "../authz.js";
import type * as autumn from "../autumn.js";
import type * as billing_autumn from "../billing/autumn.js";
import type * as billing_customerLookup from "../billing/customerLookup.js";
import type * as billing_plans from "../billing/plans.js";
import type * as brandContext from "../brandContext.js";
import type * as brandProfile from "../brandProfile.js";
import type * as brandProfileNode from "../brandProfileNode.js";
import type * as caetano from "../caetano.js";
import type * as caetanoAgent from "../caetanoAgent.js";
import type * as caetanoData from "../caetanoData.js";
import type * as caetanoNode from "../caetanoNode.js";
import type * as calendar from "../calendar.js";
import type * as capabilityTools from "../capabilityTools.js";
import type * as chat from "../chat.js";
import type * as codeRuns from "../codeRuns.js";
import type * as codeRunsData from "../codeRunsData.js";
import type * as gallery from "../gallery.js";
import type * as imageModels from "../imageModels.js";
import type * as imageUploads from "../imageUploads.js";
import type * as images from "../images.js";
import type * as imagesData from "../imagesData.js";
import type * as instagram_cache from "../instagram/cache.js";
import type * as instagram_costs from "../instagram/costs.js";
import type * as instagram_live from "../instagram/live.js";
import type * as instagram_providers_apify from "../instagram/providers/apify.js";
import type * as instagram_providers_uploadpost from "../instagram/providers/uploadpost.js";
import type * as instagram_service from "../instagram/service.js";
import type * as instagram_types from "../instagram/types.js";
import type * as instagramActions from "../instagramActions.js";
import type * as instagramData from "../instagramData.js";
import type * as market from "../market.js";
import type * as marketActions from "../marketActions.js";
import type * as marketNode from "../marketNode.js";
import type * as modelTelemetry from "../modelTelemetry.js";
import type * as openaiSub from "../openaiSub.js";
import type * as openaiSubNode from "../openaiSubNode.js";
import type * as pipeline_brand from "../pipeline/brand.js";
import type * as pipeline_brandContext from "../pipeline/brandContext.js";
import type * as pipeline_brandProfile from "../pipeline/brandProfile.js";
import type * as pipeline_codeExecution from "../pipeline/codeExecution.js";
import type * as pipeline_codex from "../pipeline/codex.js";
import type * as pipeline_constants from "../pipeline/constants.js";
import type * as pipeline_creativeDirector from "../pipeline/creativeDirector.js";
import type * as pipeline_imageBytes from "../pipeline/imageBytes.js";
import type * as pipeline_imageGeneration from "../pipeline/imageGeneration.js";
import type * as pipeline_inputQuality from "../pipeline/inputQuality.js";
import type * as pipeline_liveBrand from "../pipeline/liveBrand.js";
import type * as pipeline_liveBrandContext from "../pipeline/liveBrandContext.js";
import type * as pipeline_liveModel from "../pipeline/liveModel.js";
import type * as pipeline_livePublish from "../pipeline/livePublish.js";
import type * as pipeline_liveTelemetry from "../pipeline/liveTelemetry.js";
import type * as pipeline_market from "../pipeline/market.js";
import type * as pipeline_publish from "../pipeline/publish.js";
import type * as pipeline_publisher from "../pipeline/publisher.js";
import type * as pipeline_sourceUnderstanding from "../pipeline/sourceUnderstanding.js";
import type * as pipeline_storage from "../pipeline/storage.js";
import type * as pipeline_testLanguageModel from "../pipeline/testLanguageModel.js";
import type * as posts from "../posts.js";
import type * as publishScheduled from "../publishScheduled.js";
import type * as publishScheduledNode from "../publishScheduledNode.js";
import type * as publisher_uploadpost from "../publisher/uploadpost.js";
import type * as publisherConnect from "../publisherConnect.js";
import type * as resourceRefs from "../resourceRefs.js";
import type * as skills_catalog from "../skills/catalog.js";
import type * as skills_generated from "../skills/generated.js";
import type * as skills_types from "../skills/types.js";
import type * as threadResources from "../threadResources.js";
import type * as tools_instagram from "../tools/instagram.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";
import type * as vanda from "../vanda.js";
import type * as visualBrand from "../visualBrand.js";
import type * as workspace_brandKit from "../workspace/brandKit.js";
import type * as workspace_documents from "../workspace/documents.js";
import type * as workspace_index from "../workspace/index.js";
import type * as workspace_mounts_brand from "../workspace/mounts/brand.js";
import type * as workspace_mounts_images from "../workspace/mounts/images.js";
import type * as workspace_mounts_instagram from "../workspace/mounts/instagram.js";
import type * as workspace_mounts_market from "../workspace/mounts/market.js";
import type * as workspace_mounts_memory from "../workspace/mounts/memory.js";
import type * as workspace_mounts_posts from "../workspace/mounts/posts.js";
import type * as workspace_mounts_runs from "../workspace/mounts/runs.js";
import type * as workspace_mounts_skills from "../workspace/mounts/skills.js";
import type * as workspace_mounts_templates from "../workspace/mounts/templates.js";
import type * as workspace_resolveImage from "../workspace/resolveImage.js";
import type * as workspace_types from "../workspace/types.js";
import type * as workspaceData from "../workspaceData.js";
import type * as workspacePublic from "../workspacePublic.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  agentModels: typeof agentModels;
  authz: typeof authz;
  autumn: typeof autumn;
  "billing/autumn": typeof billing_autumn;
  "billing/customerLookup": typeof billing_customerLookup;
  "billing/plans": typeof billing_plans;
  brandContext: typeof brandContext;
  brandProfile: typeof brandProfile;
  brandProfileNode: typeof brandProfileNode;
  caetano: typeof caetano;
  caetanoAgent: typeof caetanoAgent;
  caetanoData: typeof caetanoData;
  caetanoNode: typeof caetanoNode;
  calendar: typeof calendar;
  capabilityTools: typeof capabilityTools;
  chat: typeof chat;
  codeRuns: typeof codeRuns;
  codeRunsData: typeof codeRunsData;
  gallery: typeof gallery;
  imageModels: typeof imageModels;
  imageUploads: typeof imageUploads;
  images: typeof images;
  imagesData: typeof imagesData;
  "instagram/cache": typeof instagram_cache;
  "instagram/costs": typeof instagram_costs;
  "instagram/live": typeof instagram_live;
  "instagram/providers/apify": typeof instagram_providers_apify;
  "instagram/providers/uploadpost": typeof instagram_providers_uploadpost;
  "instagram/service": typeof instagram_service;
  "instagram/types": typeof instagram_types;
  instagramActions: typeof instagramActions;
  instagramData: typeof instagramData;
  market: typeof market;
  marketActions: typeof marketActions;
  marketNode: typeof marketNode;
  modelTelemetry: typeof modelTelemetry;
  openaiSub: typeof openaiSub;
  openaiSubNode: typeof openaiSubNode;
  "pipeline/brand": typeof pipeline_brand;
  "pipeline/brandContext": typeof pipeline_brandContext;
  "pipeline/brandProfile": typeof pipeline_brandProfile;
  "pipeline/codeExecution": typeof pipeline_codeExecution;
  "pipeline/codex": typeof pipeline_codex;
  "pipeline/constants": typeof pipeline_constants;
  "pipeline/creativeDirector": typeof pipeline_creativeDirector;
  "pipeline/imageBytes": typeof pipeline_imageBytes;
  "pipeline/imageGeneration": typeof pipeline_imageGeneration;
  "pipeline/inputQuality": typeof pipeline_inputQuality;
  "pipeline/liveBrand": typeof pipeline_liveBrand;
  "pipeline/liveBrandContext": typeof pipeline_liveBrandContext;
  "pipeline/liveModel": typeof pipeline_liveModel;
  "pipeline/livePublish": typeof pipeline_livePublish;
  "pipeline/liveTelemetry": typeof pipeline_liveTelemetry;
  "pipeline/market": typeof pipeline_market;
  "pipeline/publish": typeof pipeline_publish;
  "pipeline/publisher": typeof pipeline_publisher;
  "pipeline/sourceUnderstanding": typeof pipeline_sourceUnderstanding;
  "pipeline/storage": typeof pipeline_storage;
  "pipeline/testLanguageModel": typeof pipeline_testLanguageModel;
  posts: typeof posts;
  publishScheduled: typeof publishScheduled;
  publishScheduledNode: typeof publishScheduledNode;
  "publisher/uploadpost": typeof publisher_uploadpost;
  publisherConnect: typeof publisherConnect;
  resourceRefs: typeof resourceRefs;
  "skills/catalog": typeof skills_catalog;
  "skills/generated": typeof skills_generated;
  "skills/types": typeof skills_types;
  threadResources: typeof threadResources;
  "tools/instagram": typeof tools_instagram;
  usage: typeof usage;
  users: typeof users;
  vanda: typeof vanda;
  visualBrand: typeof visualBrand;
  "workspace/brandKit": typeof workspace_brandKit;
  "workspace/documents": typeof workspace_documents;
  "workspace/index": typeof workspace_index;
  "workspace/mounts/brand": typeof workspace_mounts_brand;
  "workspace/mounts/images": typeof workspace_mounts_images;
  "workspace/mounts/instagram": typeof workspace_mounts_instagram;
  "workspace/mounts/market": typeof workspace_mounts_market;
  "workspace/mounts/memory": typeof workspace_mounts_memory;
  "workspace/mounts/posts": typeof workspace_mounts_posts;
  "workspace/mounts/runs": typeof workspace_mounts_runs;
  "workspace/mounts/skills": typeof workspace_mounts_skills;
  "workspace/mounts/templates": typeof workspace_mounts_templates;
  "workspace/resolveImage": typeof workspace_resolveImage;
  "workspace/types": typeof workspace_types;
  workspaceData: typeof workspaceData;
  workspacePublic: typeof workspacePublic;
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
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  autumn: import("@useautumn/convex/_generated/component.js").ComponentApi<"autumn">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};

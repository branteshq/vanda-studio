import { createOpenAI } from "@ai-sdk/openai";
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import { loadRootEnv } from "./loadRootEnv";
import {
  bestInstagramPosts,
  currentStats,
  latestInstagramPost,
  listProjects,
  summarizePerformance,
  type VandaDataOptions,
} from "./vandaData";

loadRootEnv();

const optionalProjectParams = z.object({
  projectId: z.string().optional().describe("Optional Convex project id. Omit to use DEMO_PROJECT_ID or the first available project."),
});

export function createVandaTools(options: VandaDataOptions) {
  return [
    defineTool({
      name: "listVandaProjects",
      description: "List available Vanda projects and the selected demo/live project.",
      parameters: z.object({}),
      execute: async () => listProjects(options),
    }),
    defineTool({
      name: "fetchLatestInstagramPost",
      description: "Fetch the latest imported Instagram/social post for a Vanda project.",
      parameters: optionalProjectParams,
      execute: async ({ projectId }) => latestInstagramPost(projectId, options),
    }),
    defineTool({
      name: "fetchBestPerformingInstagramPosts",
      description: "Fetch the best performing imported Instagram/social posts, ranked by engagement score or engagement counts.",
      parameters: optionalProjectParams.extend({
        limit: z.number().min(1).max(10).optional().describe("Number of posts to return."),
      }),
      execute: async ({ projectId, limit }) => bestInstagramPosts(projectId, limit ?? 3, options),
    }),
    defineTool({
      name: "fetchCurrentInstagramStats",
      description: "Fetch current account/project stats such as followers, follower delta, post count, and average engagement.",
      parameters: optionalProjectParams,
      execute: async ({ projectId }) => currentStats(projectId, options),
    }),
    defineTool({
      name: "summarizeRecentInstagramPerformance",
      description: "Summarize recent Instagram performance using project stats, latest post, and top recent post.",
      parameters: optionalProjectParams,
      execute: async ({ projectId }) => summarizePerformance(projectId, options),
    }),
  ];
}

function resolveModel() {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
    return openrouter.chat(process.env.COPILOTKIT_MODEL ?? "openai/gpt-4o-mini");
  }

  return process.env.COPILOTKIT_MODEL ?? "openai:gpt-4o-mini";
}

export function createVandaAgent(options: VandaDataOptions = {}) {
  return new BuiltInAgent({
    model: resolveModel(),
    maxSteps: 5,
    tools: createVandaTools(options),
    prompt:
      "You are Vanda, an agentic social media operator POC. Use the provided tools for questions about Instagram posts, stats, projects, and performance. Always say whether the answer is using live Convex data or demo fallback data. Do not claim you can publish, schedule, reply to comments, or change data in this POC.",
  });
}

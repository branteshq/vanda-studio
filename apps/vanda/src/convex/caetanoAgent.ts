import { Agent } from "@convex-dev/agent";
import { components } from "./_generated/api";
import type { AgentCtx } from "./agentContext";
import { resolveCaetanoModel } from "./agentModels";
import { chatUsageHandler, openrouterChatModel } from "./chatModel";
import { systemPrompt, vanda, vandaToolDiscovery } from "./vanda";

export const caetanoLanguageModel = (preferred?: string | null) =>
  openrouterChatModel(resolveCaetanoModel(preferred));

export const caetanoSystemPrompt = (): string => systemPrompt("caetano");

export const caetanoToolDiscovery = vandaToolDiscovery;

export const caetano = new Agent<AgentCtx>(components.agent, {
  ...vanda.options,
  name: "caetano",
  languageModel: caetanoLanguageModel(),
  usageHandler: chatUsageHandler("caetano_chat"),
  instructions: caetanoSystemPrompt(),
});

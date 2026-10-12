import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import { agentAccount, type AgentCtx } from "../agentContext";

type GuideToolCtx = ToolCtx & AgentCtx;

export const guideTools = {
  brand_guide_finish: createTool({
    description:
      'Encerra o guia da marca depois que o dono aprovou o seu resumo ("fechou", "tá certo", "pode seguir"). Confirma de uma vez o que ficou como (Vanda) no arquivo da marca, vira (dono), e a tela do dono mostra o guia pronto. Só funciona na conversa do guia; nunca chame sem a aprovação explícita do dono.',
    inputSchema: z.object({}),
    execute: async (
      ctx: GuideToolCtx,
    ): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> =>
      ctx.runMutation(internal.brandProfile.finishGuide, {
        accountId: await agentAccount(ctx),
        threadId: ctx.threadId ?? "",
      }),
  }),
};

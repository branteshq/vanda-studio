import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { agentAccount, type AgentCtx } from "../agentContext";
import { autopilotPostTypes } from "../autopilotModel";
import type { AutopilotOverview } from "../autopilotData";
import { renderAuditMarkdown, renderPlanMarkdown, renderScheduleText } from "../autopilotText";
import { recordCapabilityResult } from "../capabilityTools";
import { postPurposes } from "../postPurposes";
import { capabilityResult, capabilityResultSchema, type ThreadResource } from "../resourceRefs";

/**
 * Vanda and Caetano's hands on the autopilot's posts. Reads are free; every
 * write runs the same mutation as the Piloto automático view and only on the
 * owner's explicit request. On/off and the cadence are settings
 * (autopilot.enabled, autopilot.cadence) changed with settings_set.
 */

type AutopilotCtx = ToolCtx & AgentCtx;

type CapabilityOutput = z.infer<typeof capabilityResultSchema>;

const slotIdInput = z.string().describe("slotId do post do piloto (veja autopilot_read)");

const weekday = z.number().int().min(0).max(6).describe("0 = domingo, 1 = segunda … 6 = sábado");

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe("HH:mm, horário de Brasília");

const OWNER_ONLY =
  "Use SOMENTE quando o dono pedir explicitamente essa mudança no piloto automático.";

const weekResources = (overview: AutopilotOverview): ThreadResource[] =>
  overview.weeks
    .filter((week) => week.slots.length > 0)
    .map((week) => ({
      kind: "autopilotWeek",
      accountId: overview.accountId,
      weekStart: week.weekStart,
    }));

/** What the call did, reported next to the resulting state. */
interface ReportExtra {
  readonly audit?: string;
  readonly updated?: string;
  readonly status?: string;
  readonly skipped?: string;
  readonly restored?: string;
  readonly regenerating?: string;
  readonly reanalyzing?: boolean;
  readonly approved?: string;
  readonly rejected?: string;
  readonly forgotten?: string;
}

/** The state after any call: text for the model/WhatsApp, the week card for the chat. */
const report = async (
  ctx: AutopilotCtx,
  options: Parameters<typeof recordCapabilityResult>[1],
  accountId: Id<"accounts">,
  extra: ReportExtra = {},
): Promise<CapabilityOutput> => {
  const overview = await ctx.runQuery(internal.autopilotData.overviewInternal, {
    accountId,
    now: Date.now(),
  });

  const resources = weekResources(overview);

  return recordCapabilityResult(
    ctx,
    options,
    capabilityResult(
      {
        ...extra,
        enabled: overview.enabled,
        connected: overview.connected,
        cadence: overview.cadenceSummary,
        approval: overview.approval === "required" ? "pedir aceite" : "publicar sem aceite",
        awaitingApproval: overview.weeks
          .flatMap((week) => week.slots)
          .filter((slot) => slot.status === "awaiting_approval")
          .map((slot) => ({ slotId: slot.slotId, hook: slot.hook, scheduledFor: slot.scheduledFor })),
        learnedRules: overview.rules.map((rule) => ({ ruleId: rule.feedbackId, rule: rule.rule })),
        whatsapp: renderScheduleText(overview),
        plan: renderPlanMarkdown(overview),
        page: "/piloto",
      },
      { resources, presented: resources },
    ),
  );
};

export const autopilotTools = {
  autopilot_read: createTool({
    description:
      "Mostra o piloto automático de posts de feed: se está ligado, a cadência da semana (ligado e cadência são as configurações autopilot.enabled e autopilot.cadence, de settings_set), a programação desta semana e da próxima (cada post com slotId, dia, horário, formato, slides, propósito, gancho e estado) e, com includeAudit, o diagnóstico da conta. Na conversa, a programação aparece como cartão com os dias da semana; no WhatsApp, responda com o texto de `whatsapp`.",
    inputSchema: z.object({ includeAudit: z.boolean().optional() }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, { includeAudit }, options): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);

      if (!includeAudit) return report(ctx, options, accountId);

      const overview = await ctx.runQuery(internal.autopilotData.overviewInternal, {
        accountId,
        now: Date.now(),
      });

      return report(ctx, options, accountId, { audit: renderAuditMarkdown(overview) });
    },
  }),
  autopilot_update_slot: createTool({
    description: `Altera um post do piloto automático: dia, horário, formato, slides, propósito, tema, ângulo, gancho ou o que a legenda deve dizer. Mudar só o horário mantém o post pronto; mudar o conteúdo gera de novo. ${OWNER_ONLY}`,
    inputSchema: z.object({
      slotId: slotIdInput,
      weekday: weekday.optional(),
      time: time.optional(),
      type: z.enum(autopilotPostTypes).optional(),
      slideCount: z.number().int().min(1).max(10).optional(),
      purpose: z.enum(postPurposes).optional(),
      theme: z.string().min(1).optional(),
      angle: z.string().min(1).optional(),
      hook: z.string().min(1).optional(),
      captionBrief: z.string().min(1).optional(),
    }),
    outputSchema: capabilityResultSchema,
    execute: async (
      ctx: AutopilotCtx,
      { slotId, ...change },
      options,
    ): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);

      const status = await ctx.runMutation(internal.autopilotData.updateSlotInternal, {
        accountId,
        // SAFETY: updateSlotInternal checks the slot belongs to this account.
        slotId: slotId as Id<"autopilotSlots">,
        change: Object.fromEntries(
          Object.entries(change).filter(([, value]) => value !== undefined),
        ),
      });

      return report(ctx, options, accountId, { updated: slotId, status });
    },
  }),
  autopilot_skip_slot: createTool({
    description: `Pula um post do piloto automático: ele não será publicado (com restore: true, reativa um post pulado). ${OWNER_ONLY}`,
    inputSchema: z.object({ slotId: slotIdInput, restore: z.boolean().optional() }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, { slotId, restore }, options): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);
      // SAFETY: the mutations check the slot belongs to this account.
      const args = { accountId, slotId: slotId as Id<"autopilotSlots"> };

      if (restore) await ctx.runMutation(internal.autopilotData.restoreSlotInternal, args);
      else await ctx.runMutation(internal.autopilotData.skipSlotInternal, args);

      return report(ctx, options, accountId, restore ? { restored: slotId } : { skipped: slotId });
    },
  }),
  autopilot_approve_slot: createTool({
    description: `Aprova um post do piloto automático que está aguardando aceite: ele é agendado para o horário dele. ${OWNER_ONLY}`,
    inputSchema: z.object({ slotId: slotIdInput }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, { slotId }, options): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);

      await ctx.runMutation(internal.autopilotData.approveSlotInternal, {
        accountId,
        // SAFETY: approveSlotInternal checks the slot belongs to this account.
        slotId: slotId as Id<"autopilotSlots">,
      });

      return report(ctx, options, accountId, { approved: slotId });
    },
  }),
  autopilot_reject_slot: createTool({
    description: `Recusa um post do piloto automático já gerado (aguardando aceite ou agendado). O motivo do dono é OBRIGATÓRIO e literal: se ele recusar sem dizer por quê, pergunte o motivo antes de chamar. O motivo é analisado para virar regra geral dos próximos posts ou valer só para este, e o post é refeito com ele. ${OWNER_ONLY}`,
    inputSchema: z.object({
      slotId: slotIdInput,
      reason: z.string().min(8).describe("o motivo da recusa, nas palavras do dono"),
    }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, { slotId, reason }, options): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);

      const status = await ctx.runMutation(internal.autopilotData.rejectSlotInternal, {
        accountId,
        // SAFETY: rejectSlotInternal checks the slot belongs to this account.
        slotId: slotId as Id<"autopilotSlots">,
        reason,
      });

      return report(ctx, options, accountId, { rejected: slotId, status });
    },
  }),
  autopilot_forget_rule: createTool({
    description: `Desativa uma regra que o piloto automático aprendeu com uma recusa (veja as regras em autopilot_read). ${OWNER_ONLY}`,
    inputSchema: z.object({ ruleId: z.string().describe("id da regra (feedbackId) em autopilot_read") }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, { ruleId }, options): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);

      await ctx.runMutation(internal.autopilotData.forgetRuleInternal, {
        accountId,
        // SAFETY: forgetRuleInternal checks the rule belongs to this account.
        feedbackId: ruleId as Id<"autopilotFeedback">,
      });

      return report(ctx, options, accountId, { forgotten: ruleId });
    },
  }),
  autopilot_regenerate_slot: createTool({
    description: `Gera de novo, agora, um post do piloto automático com o briefing atual. ${OWNER_ONLY}`,
    inputSchema: z.object({ slotId: slotIdInput }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, { slotId }, options): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);

      await ctx.runMutation(internal.autopilotData.regenerateSlotInternal, {
        accountId,
        // SAFETY: regenerateSlotInternal checks the slot belongs to this account.
        slotId: slotId as Id<"autopilotSlots">,
      });

      return report(ctx, options, accountId, { regenerating: slotId });
    },
  }),
  autopilot_reanalyze: createTool({
    description: `Refaz o diagnóstico da conta e replaneja os posts do piloto que ainda não foram gerados nem fixados pelo dono. Leva alguns minutos; o resultado aparece na página Piloto automático. ${OWNER_ONLY}`,
    inputSchema: z.object({}),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, _args, options): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);

      await ctx.runMutation(internal.autopilotData.reanalyzeInternal, { accountId });

      return report(ctx, options, accountId, { reanalyzing: true });
    },
  }),
};

export const autopilotDiscovery = {
  autopilot_read: {
    keywords:
      "piloto automático automatico autopilot programação programacao cronograma semanal semana automáticos cadência cadencia diagnóstico diagnostico análise nota perfil weekly plan audit",
    effect: "read",
  },
  autopilot_update_slot: {
    keywords:
      "piloto automático alterar horário dia gancho tema propósito slides programação autopilot edit slot",
    effect: "write",
  },
  autopilot_skip_slot: {
    keywords: "piloto automático pular vetar reativar autopilot skip veto restore",
    effect: "write",
  },
  autopilot_approve_slot: {
    keywords: "piloto automático aprovar aprovo aceite aceitar autopilot approve accept",
    effect: "write",
  },
  autopilot_reject_slot: {
    keywords:
      "piloto automático recusar recuso negar não gostei rejeitar motivo justificativa autopilot reject deny",
    effect: "write",
  },
  autopilot_forget_rule: {
    keywords: "piloto automático esquecer regra aprendida desativar remover autopilot forget rule",
    effect: "write",
  },
  autopilot_regenerate_slot: {
    keywords: "piloto automático refazer gerar de novo regenerar autopilot regenerate",
    effect: "write",
  },
  autopilot_reanalyze: {
    keywords:
      "piloto automático reanalisar diagnóstico análise da conta replanejar autopilot reanalyze audit replan",
    effect: "write",
  },
} as const;

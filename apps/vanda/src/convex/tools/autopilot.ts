import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { agentAccount, type AgentCtx } from "../agentContext";
import { MAX_WEEKLY_POSTS, autopilotPostTypes, type AutopilotJob } from "../autopilotModel";
import { definedOnly, formatHour, purposeLabels, slidesLabel } from "../pipeline/autopilot";
import { renderAuditSummary } from "../pipeline/autopilotAgent";
import { renderAuditMarkdown, renderPlanMarkdown, renderScheduleText } from "../autopilotText";
import { recordCapabilityResult } from "../capabilityTools";
import { postPurposes } from "../postPurposes";
import { capabilityResult, capabilityResultSchema } from "../resourceRefs";

/**
 * Vanda and Caetano's hands on the autopilot's posts. Reads are free; every
 * write runs the same mutation as the Posts automáticos view and only on the
 * owner's explicit request. On/off and the cadence are settings
 * (autopilot.enabled, autopilot.cadence) changed with settings_set.
 */

type AutopilotCtx = ToolCtx & AgentCtx;

type CapabilityOutput = z.infer<typeof capabilityResultSchema>;

const slotIdInput = z.string().describe("slotId do post automático (veja autopilot_read)");

const weekday = z.number().int().min(0).max(6).describe("0 = domingo, 1 = segunda … 6 = sábado");

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe("HH:mm, horário de Brasília");

const OWNER_ONLY =
  "Use SOMENTE quando o dono pedir explicitamente essa mudança nos posts automáticos.";

/** Save tools only run inside the matching posts automáticos work turn. */
const jobOf = (ctx: AutopilotCtx, kind: AutopilotJob["kind"]): AutopilotJob => {
  const job = ctx.autopilotJob;

  if (job?.kind !== kind)
    throw new Error(
      "esta ferramenta só funciona num trabalho dos posts automáticos; para refazer, use autopilot_reanalyze ou autopilot_regenerate_slot",
    );

  return job;
};

/** A plan job always names its week (requestPlan sets it). */
const weekOf = (job: AutopilotJob): number => {
  if (job.weekStart === undefined) throw new Error("trabalho de plano sem semana");

  return job.weekStart;
};

/** The plan turn's brief: cadence by index (fixed ones marked), diagnosis, recent themes. */
const planningText = async (ctx: AutopilotCtx, job: AutopilotJob): Promise<string> => {
  const inputs = await ctx.runQuery(internal.autopilotData.planInputs, {
    accountId: job.accountId,
    weekStart: weekOf(job),
  });

  const fixed = new Map(inputs.fixed.map((item) => [item.index, item.brief]));

  return [
    "Cadência (um item de autopilot_save_plan por índice):",
    ...inputs.cadence.map((entry, index) => {
      const brief = fixed.get(index);
      const base = `${index}. dia ${entry.weekday} ${formatHour(entry.time)} · ${entry.type} · ${slidesLabel(entry.slideCount)}`;

      return brief
        ? `${base} · FIXADO PELO DONO: ${purposeLabels[brief.purpose]} — "${brief.hook}" (mantenha)`
        : base;
    }),
    "",
    "Diagnóstico:",
    inputs.audit ? renderAuditSummary(inputs.audit) : "(sem diagnóstico ainda)",
    "",
    "Temas das duas últimas semanas (não repita):",
    ...(inputs.recentThemes.length > 0
      ? inputs.recentThemes.map((theme) => `- ${theme}`)
      : ["(nenhum)"]),
  ].join("\n");
};

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
  /** In a plan work turn: everything the week's plan starts from. */
  readonly planning?: string | undefined;
  /** What the agent must do right after, in the same turn. */
  readonly next?: string | undefined;
}

const REMEMBER_GENERAL =
  "Recusa geral: grave agora o aprendizado em /brand/marca.md (leia, acrescente em Preferências ou Nunca fazer com a origem (dono) e grave o arquivo inteiro com write). Só diga que aprendeu depois que a gravação der certo.";

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
          .map((slot) => ({
            slotId: slot.slotId,
            hook: slot.hook,
            scheduledFor: slot.scheduledFor,
          })),
        whatsapp: renderScheduleText(overview),
        plan: renderPlanMarkdown(overview),
        page: "/posts-automaticos",
      },
      // No chat card: the planning card on Posts automáticos is the one place the week shows.
    ),
  );
};

export const autopilotTools = {
  autopilot_read: createTool({
    description:
      "Mostra os posts automáticos de feed que o Caetano cuida: se está ligado, a cadência da semana (ligado e cadência são as configurações autopilot.enabled e autopilot.cadence, de settings_set), a programação desta semana e da próxima (cada post com slotId, dia, horário, formato, slides, propósito, gancho e estado) e, com includeAudit, o diagnóstico da conta. No WhatsApp, responda com o texto de `whatsapp`; na página Posts automáticos o planejamento já aparece no card.",
    inputSchema: z.object({ includeAudit: z.boolean().optional() }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, { includeAudit }, options): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);
      const planJob = ctx.autopilotJob?.kind === "plan" ? ctx.autopilotJob : null;

      if (planJob)
        return report(ctx, options, accountId, { planning: await planningText(ctx, planJob) });

      if (!includeAudit) return report(ctx, options, accountId);

      const overview = await ctx.runQuery(internal.autopilotData.overviewInternal, {
        accountId,
        now: Date.now(),
      });

      return report(ctx, options, accountId, { audit: renderAuditMarkdown(overview) });
    },
  }),
  autopilot_measure_account: createTool({
    description:
      "Mede a conta de Instagram conectada para o diagnóstico dos posts automáticos: seguidores, mediana de alcance, salvos e envios por alcance, frequência, desempenho por formato e por dia/hora, e os melhores e piores posts como múltiplo da mediana (com id). Números calculados pela plataforma: interprete, não refaça contas. Só num trabalho de diagnóstico.",
    inputSchema: z.object({}),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, _args, options): Promise<CapabilityOutput> => {
      const job = jobOf(ctx, "audit");

      const measured = await ctx.runAction(internal.autopilotNode.measureForAudit, {
        accountId: job.accountId,
      });

      return recordCapabilityResult(ctx, options, capabilityResult(measured));
    },
  }),
  autopilot_save_audit: createTool({
    description:
      "Grava o diagnóstico da conta depois de autopilot_measure_account, seguindo a habilidade instagram-account-audit: rubrica só com itens observáveis (a nota do perfil sai dela), por que cada melhor e pior post foi assim (postNotes com o id), achados com evidência, o que parar, fazer mais e do que a conta precisa, e a cadência recomendada de 3 a 5 posts de feed por semana. Só num trabalho de diagnóstico.",
    inputSchema: z.object({
      rubric: z
        .array(
          z.object({
            item: z
              .string()
              .max(40)
              .describe("nome curto do item da rubrica, ex.: Bio, Nome, Destaques"),
            score: z.number(),
            max: z.number().positive(),
            fix: z.string().optional().describe("a correção concreta, quando faltar ponto"),
            observed: z
              .boolean()
              .describe(
                "false quando a leitura não mostrou o item: ele aparece à parte e não entra na nota",
              ),
          }),
        )
        .min(1),
      postNotes: z.array(z.object({ postId: z.string(), why: z.string() })),
      findings: z.array(
        z.object({ claim: z.string(), evidence: z.string(), n: z.number().optional() }),
      ),
      stop: z.array(z.string()),
      doMore: z.array(z.string()),
      needs: z.array(z.string()),
      summary: z.string().min(20),
      recommendedCadence: z
        .array(
          z.object({
            weekday,
            time,
            type: z.enum(autopilotPostTypes),
            slideCount: z.number().int().min(1).max(10),
          }),
        )
        .min(1)
        .max(MAX_WEEKLY_POSTS),
      cadenceRationale: z.string().min(10),
    }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, input, options): Promise<CapabilityOutput> => {
      const job = jobOf(ctx, "audit");

      const profileScore = await ctx.runMutation(internal.autopilotData.saveAuditJudgement, {
        accountId: job.accountId,
        ...input,
        rubric: input.rubric.map((item) => definedOnly(item)),
        findings: input.findings.map((finding) => definedOnly(finding)),
      });

      return report(ctx, options, job.accountId, { audit: `nota do perfil ${profileScore}/100` });
    },
  }),
  autopilot_save_plan: createTool({
    description:
      "Grava o plano da semana dos posts automáticos seguindo a habilidade instagram-weekly-plan: um item por índice da cadência (veja autopilot_read), com propósito, tema, ângulo, gancho da capa (até 6 palavras), roteiro com uma linha por slide e o que a legenda deve dizer. Slots fixados pelo dono ficam como estão. Nunca o mesmo propósito em slots seguidos. Só num trabalho de plano.",
    inputSchema: z.object({
      strategy: z.string().min(10).describe("uma frase explicando a lógica da semana para o dono"),
      slots: z
        .array(
          z.object({
            index: z.number().int().min(0),
            purpose: z.enum(postPurposes),
            theme: z.string().min(1),
            angle: z.string().min(1),
            hook: z.string().min(1),
            slideOutline: z.array(z.string()).min(1),
            captionBrief: z.string().min(1),
          }),
        )
        .min(1),
    }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: AutopilotCtx, { strategy, slots }, options): Promise<CapabilityOutput> => {
      const job = jobOf(ctx, "plan");

      const created = await ctx.runMutation(internal.autopilotData.savePlanFromJob, {
        accountId: job.accountId,
        weekStart: weekOf(job),
        strategy,
        slots,
      });

      return report(ctx, options, job.accountId, { updated: `${created} posts planejados` });
    },
  }),
  autopilot_update_slot: createTool({
    description: `Altera um post automático: dia, horário, formato, slides, propósito, tema, ângulo, gancho ou o que a legenda deve dizer. Mudar só o horário mantém o post pronto; mudar o conteúdo gera de novo. ${OWNER_ONLY}`,
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
    description: `Pula um post automático: ele não será publicado (com restore: true, reativa um post pulado). ${OWNER_ONLY}`,
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
    description: `Aprova um post automático que está aguardando aceite: ele é agendado para o horário dele. ${OWNER_ONLY}`,
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
    description: `Recusa um post automático já gerado (aguardando aceite ou agendado) e o refaz com o motivo. O motivo do dono é OBRIGATÓRIO e literal. ANTES de chamar, pergunte ao dono se o motivo vale para TODOS os próximos posts (scope "geral") ou SÓ para este post/imagem (scope "post"); use a resposta dele. Uma recusa geral vira memória: grave-a em /brand/marca.md (Preferências ou Nunca fazer, origem (dono)) com write. Se for sobre uma imagem do carrossel, diga qual slide no motivo. ${OWNER_ONLY}`,
    inputSchema: z.object({
      slotId: slotIdInput,
      reason: z.string().min(8).describe("o motivo da recusa, nas palavras do dono"),
      scope: z
        .enum(["geral", "post"])
        .describe(
          "resposta do dono: vale para todos os próximos posts (geral) ou só para este (post)",
        ),
    }),
    outputSchema: capabilityResultSchema,
    execute: async (
      ctx: AutopilotCtx,
      { slotId, reason, scope },
      options,
    ): Promise<CapabilityOutput> => {
      const accountId = await agentAccount(ctx);

      const status = await ctx.runMutation(internal.autopilotData.rejectSlotInternal, {
        accountId,
        // SAFETY: rejectSlotInternal checks the slot belongs to this account.
        slotId: slotId as Id<"autopilotSlots">,
        reason,
        scope,
      });

      return report(ctx, options, accountId, {
        rejected: slotId,
        status,
        next: scope === "geral" ? REMEMBER_GENERAL : undefined,
      });
    },
  }),
  autopilot_regenerate_slot: createTool({
    description: `Gera de novo, agora, um post automático com o briefing atual. ${OWNER_ONLY}`,
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
    description: `Refaz o diagnóstico da conta e replaneja os posts automáticos que ainda não foram gerados nem fixados pelo dono. Leva alguns minutos; o resultado aparece na página Posts automáticos. ${OWNER_ONLY}`,
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
      "posts automáticos caetano piloto automático automatico autopilot programação programacao cronograma semanal semana automáticos cadência cadencia diagnóstico diagnostico análise nota perfil weekly plan audit",
    effect: "read",
  },
  autopilot_update_slot: {
    keywords:
      "posts automáticos caetano piloto automático alterar horário dia gancho tema propósito slides programação autopilot edit slot",
    effect: "write",
  },
  autopilot_skip_slot: {
    keywords:
      "posts automáticos caetano piloto automático pular vetar reativar autopilot skip veto restore",
    effect: "write",
  },
  autopilot_approve_slot: {
    keywords:
      "posts automáticos caetano piloto automático aprovar aprovo aceite aceitar autopilot approve accept",
    effect: "write",
  },
  autopilot_reject_slot: {
    keywords:
      "posts automáticos caetano piloto automático recusar recuso negar não gostei rejeitar motivo justificativa autopilot reject deny",
    effect: "write",
  },
  autopilot_measure_account: {
    keywords:
      "posts automáticos caetano diagnóstico diagnostico medir medição melhores piores autopilot measure audit",
    effect: "read",
  },
  autopilot_save_audit: {
    keywords:
      "posts automáticos caetano gravar salvar diagnóstico diagnostico rubrica nota perfil cadência recomendada autopilot save audit",
    effect: "write",
  },
  autopilot_save_plan: {
    keywords:
      "posts automáticos caetano gravar salvar plano planejamento semana pautas propósito gancho roteiro autopilot save weekly plan",
    effect: "write",
  },
  autopilot_regenerate_slot: {
    keywords:
      "posts automáticos caetano piloto automático refazer gerar de novo regenerar autopilot regenerate",
    effect: "write",
  },
  autopilot_reanalyze: {
    keywords:
      "posts automáticos caetano piloto automático reanalisar diagnóstico análise da conta replanejar autopilot reanalyze audit replan",
    effect: "write",
  },
} as const;

import { getThreadMetadata, saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { overviewOf } from "./autopilotData";
import { PRODUCE_AHEAD_LABEL, weekdayNames } from "./autopilotModel";
import {
  formatHour,
  formatScheduleText,
  localSlot,
  purposeLabels,
  slidesLabel,
} from "./pipeline/autopilot";
import type { ThreadResource } from "./resourceRefs";
import { upsertManifest } from "./threadResources";
import { activeConnection, notifyOwner } from "./whatsappData";

/**
 * Posts automáticos news reach the owner where they already talk: a short note
 * in the account's latest Vanda conversation, and Caetano's own thread (plus
 * WhatsApp when linked), so a reply like "pula esse" lands with context and he
 * acts with the autopilot tools.
 */

const accountLabel = (account: { name?: string; handle?: string } | null): string =>
  account?.name ?? (account?.handle ? `@${account.handle}` : "seu negócio");

/**
 * Caetano: the text in his thread (seen on the Posts automáticos page) and, when
 * the owner linked WhatsApp, there too. `context` is appended only in the
 * thread (ids the tools need).
 */
const tellCaetano = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  key: string,
  text: string,
  resources: ThreadResource[],
  context = "",
): Promise<void> => {
  const account = await ctx.db.get(accountId);
  const owner = account?.ownerUserId ? await ctx.db.get(account.ownerUserId) : null;

  if (!owner) return;

  const threadId = owner.caetanoThreadId;

  const metadata = threadId
    ? await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null)
    : null;

  if (threadId && metadata?.userId === `caetano:${owner._id}`) {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      agentName: "caetano",
      message: { role: "assistant", content: context ? `${text}\n\n${context}` : text },
    });

    await upsertManifest(ctx, {
      threadId,
      anchorMessageId: messageId,
      toolCallId: key,
      resources,
      presented: resources,
    });
  }

  if (await activeConnection(ctx, owner._id)) await notifyOwner(ctx, owner._id, text);
};

/** The account's most recent Vanda conversation, where in-app notices land. */
const tellVanda = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  key: string,
  text: string,
  resources: ThreadResource[],
): Promise<void> => {
  const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
    userId: String(accountId),
    order: "desc",
    paginationOpts: { cursor: null, numItems: 5 },
  });

  const thread = threads.page.find((item) => item.status === "active");

  if (!thread) return;

  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: thread._id,
    agentName: "vanda",
    message: { role: "assistant", content: text },
  });

  await upsertManifest(ctx, {
    threadId: thread._id,
    anchorMessageId: messageId,
    toolCallId: key,
    resources,
    presented: resources,
  });
};

/** A new week is planned: a line to Vanda, the week as text to Caetano; the page shows the plan. */
export const announcePlan = internalMutation({
  args: { accountId: v.id("accounts"), weekStart: v.number() },
  handler: async (ctx, { accountId, weekStart }): Promise<void> => {
    const overview = await overviewOf(ctx, accountId, Date.now());
    const week = overview.weeks.find((item) => item.weekStart === weekStart);

    if (!week || week.slots.length === 0) return;

    const intro = `O Caetano planejou os posts automáticos da semana de ${week.label}: ${overview.cadenceSummary}.`;

    const approval = overview.approval === "required";

    await tellVanda(
      ctx,
      accountId,
      `autopilot:${accountId}:${weekStart}`,
      `${intro} Cada post é gerado cerca de ${PRODUCE_AHEAD_LABEL} antes${approval ? " e espera o seu aceite para publicar" : " e publica sozinho; você pode editar ou pular até lá"}. Veja em Posts automáticos.`,
      [],
    );

    const account = await ctx.db.get(accountId);

    await tellCaetano(
      ctx,
      accountId,
      `autopilot:${accountId}:${weekStart}`,
      `${formatScheduleText(week.slots, `Planejei seus posts da semana de ${week.label} (${accountLabel(account)})`)}\n\nMe diga se quer mudar algum post.`,
      [],
    );
  },
});

const slotLine = (
  slot: Pick<Doc<"autopilotSlots">, "scheduledFor" | "type" | "slideCount" | "purpose" | "hook">,
): string => {
  const { weekday, time } = localSlot(slot.scheduledFor);

  return `${weekdayNames[weekday]} ${formatHour(time)} · ${slot.type === "carousel" ? "carrossel" : "imagem"} · ${slidesLabel(slot.slideCount)} · ${purposeLabels[slot.purpose]} — "${slot.hook}"`;
};

/**
 * A post is produced. With approval required it waits for "aprovar" or a
 * rejection with its reason; otherwise it is armed and the veto window starts.
 */
export const notifyProduced = internalMutation({
  args: { slotId: v.id("autopilotSlots") },
  handler: async (ctx, { slotId }): Promise<void> => {
    const slot = await ctx.db.get(slotId);

    if (!slot || !slot.postId) return;

    if (slot.status !== "scheduled" && slot.status !== "awaiting_approval") return;

    const account = await ctx.db.get(slot.accountId);
    const waiting = slot.status === "awaiting_approval";
    const post: ThreadResource = { kind: "post", accountId: slot.accountId, postId: slot.postId };

    const text = waiting
      ? `Preparei um post para o seu aceite (${accountLabel(account)}): ${slotLine(slot)}.\nResponda "aprovo" que eu publico no horário, ou diga o que não gostou: o motivo é obrigatório e me ensina para os próximos posts. Sem o seu aceite até o horário, eu não publico.`
      : `Preparei um post (${accountLabel(account)}): ${slotLine(slot)}.\nPublico sozinho no horário. Se quiser mudar, refazer ou pular, me diga.`;

    const context = `Post automático — slotId: ${slotId}. Aceite: autopilot_approve_slot. Recusa: autopilot_reject_slot com o motivo do dono (pergunte o motivo se ele não disser).`;

    const forChat = waiting
      ? `O Caetano preparou um post para o seu aceite: ${slotLine(slot)}. Aprove ou recuse dizendo o motivo — sem aceite até o horário, ele não publica.`
      : `O Caetano preparou um post: ${slotLine(slot)}. Ele publica no horário; dá para recusar ou pular até lá.`;

    await tellVanda(ctx, slot.accountId, `autopilot:produced:${slotId}`, forChat, [post]);
    await tellCaetano(ctx, slot.accountId, `autopilot:produced:${slotId}`, text, [post], context);
  },
});

/** Production gave up: the owner hears it from Caetano instead of finding a gap. */
export const notifyFailed = internalMutation({
  args: { slotId: v.id("autopilotSlots") },
  handler: async (ctx, { slotId }): Promise<void> => {
    const slot = await ctx.db.get(slotId);

    if (!slot || slot.status !== "failed") return;

    const account = await ctx.db.get(slot.accountId);

    await tellCaetano(
      ctx,
      slot.accountId,
      `autopilot:failed:${slotId}`,
      `Não consegui preparar um post automático (${accountLabel(account)}): ${slotLine(slot)}.${slot.lastError ? `\nMotivo: ${slot.lastError}` : ""}\nQuer que eu tente de novo ou pule esse?`,
      [],
    );
  },
});

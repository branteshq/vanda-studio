import { getThreadMetadata, saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { overviewOf } from "./autopilotData";
import { weekdayNames } from "./autopilotModel";
import { formatHour, formatScheduleText, localSlot, purposeLabels, slidesLabel } from "./pipeline/autopilot";
import type { ThreadResource } from "./resourceRefs";
import { upsertManifest } from "./threadResources";
import { activeConnection, notifyOwner } from "./whatsappData";

/**
 * The autopilot speaks through the same channels as everything else: the
 * account's latest Vanda conversation shows the week card, and Caetano tells
 * the owner on WhatsApp — saving the same words in his own thread, so a reply
 * like "pula esse" lands with context and he can act with the autopilot tools.
 */

const accountLabel = (account: { name?: string; handle?: string } | null): string =>
  account?.name ?? (account?.handle ? `@${account.handle}` : "seu negócio");

/** Caetano: WhatsApp message plus the same text in his thread, when the owner is linked. */
const tellCaetano = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  key: string,
  text: string,
  resources: ThreadResource[],
): Promise<void> => {
  const account = await ctx.db.get(accountId);
  const owner = account?.ownerUserId ? await ctx.db.get(account.ownerUserId) : null;

  if (!owner || !(await activeConnection(ctx, owner._id))) return;

  const threadId = owner.caetanoThreadId;

  const metadata = threadId
    ? await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null)
    : null;

  if (threadId && metadata?.userId === `caetano:${owner._id}`) {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      agentName: "caetano",
      message: { role: "assistant", content: text },
    });

    await upsertManifest(ctx, {
      threadId,
      anchorMessageId: messageId,
      toolCallId: key,
      resources,
      presented: resources,
    });
  }

  await notifyOwner(ctx, owner._id, text);
};

/** A new week is planned: the card in the latest conversation, the text on WhatsApp. */
export const announcePlan = internalMutation({
  args: { accountId: v.id("accounts"), weekStart: v.number() },
  handler: async (ctx, { accountId, weekStart }): Promise<void> => {
    const overview = await overviewOf(ctx, accountId, Date.now());
    const week = overview.weeks.find((item) => item.weekStart === weekStart);

    if (!week || week.slots.length === 0) return;

    const resource: ThreadResource = { kind: "autopilotWeek", accountId, weekStart };
    const intro = `Planejei a semana de ${week.label} no piloto automático: ${overview.cadenceSummary}.`;

    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: String(accountId),
      order: "desc",
      paginationOpts: { cursor: null, numItems: 5 },
    });

    const thread = threads.page.find((item) => item.status === "active");

    if (thread) {
      const { messageId } = await saveMessage(ctx, components.agent, {
        threadId: thread._id,
        agentName: "vanda",
        message: {
          role: "assistant",
          content: `${intro} Cada post é gerado cerca de 24 horas antes e publica sozinho; você pode editar ou pular até lá.`,
        },
      });

      await upsertManifest(ctx, {
        threadId: thread._id,
        anchorMessageId: messageId,
        toolCallId: `autopilot:${accountId}:${weekStart}`,
        resources: [resource],
        presented: [resource],
      });
    }

    const account = await ctx.db.get(accountId);

    await tellCaetano(
      ctx,
      accountId,
      `autopilot:${accountId}:${weekStart}`,
      `${formatScheduleText(week.slots, `Piloto automático (${accountLabel(account)}) — semana de ${week.label}`)}\n\nMe diga se quer mudar algum post.`,
      [resource],
    );
  },
});

const slotLine = (
  slot: Pick<Doc<"autopilotSlots">, "scheduledFor" | "type" | "slideCount" | "purpose" | "hook">,
): string => {
  const { weekday, time } = localSlot(slot.scheduledFor);

  return `${weekdayNames[weekday]} ${formatHour(time)} · ${slot.type === "carousel" ? "carrossel" : "imagem"} · ${slidesLabel(slot.slideCount)} · ${purposeLabels[slot.purpose]} — "${slot.hook}"`;
};

/** A post is produced and armed: the owner's veto window starts now. */
export const notifyProduced = internalMutation({
  args: { slotId: v.id("autopilotSlots") },
  handler: async (ctx, { slotId }): Promise<void> => {
    const slot = await ctx.db.get(slotId);

    if (!slot || slot.status !== "scheduled" || !slot.postId) return;

    const account = await ctx.db.get(slot.accountId);

    await tellCaetano(
      ctx,
      slot.accountId,
      `autopilot:produced:${slotId}`,
      `Post do piloto automático pronto (${accountLabel(account)}): ${slotLine(slot)}.\nPublica sozinho no horário. Se quiser mudar, refazer ou pular, me diga.`,
      [{ kind: "post", accountId: slot.accountId, postId: slot.postId }],
    );
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
      `Não consegui preparar um post do piloto automático (${accountLabel(account)}): ${slotLine(slot)}.${slot.lastError ? `\nMotivo: ${slot.lastError}` : ""}\nQuer que eu tente de novo ou pule esse?`,
      [],
    );
  },
});

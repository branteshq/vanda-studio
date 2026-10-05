import { saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { overviewOf } from "./autopilotData";
import { formatScheduleText } from "./pipeline/autopilot";
import type { ThreadResource } from "./resourceRefs";
import { upsertManifest } from "./threadResources";
import { notifyOwner } from "./whatsappData";

/**
 * Tells the owner a new autopilot week is planned: the "Programação da semana"
 * card in the account's most recent conversation, and the text version on
 * WhatsApp when Caetano is linked.
 */
export const announcePlan = internalMutation({
  args: { accountId: v.id("accounts"), weekStart: v.number() },
  handler: async (ctx, { accountId, weekStart }): Promise<void> => {
    const overview = await overviewOf(ctx, accountId, Date.now());
    const week = overview.weeks.find((item) => item.weekStart === weekStart);

    if (!week || week.slots.length === 0) return;

    const intro = `Planejei a semana de ${week.label} no piloto automático: ${overview.cadenceSummary}.`;

    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: String(accountId),
      order: "desc",
      paginationOpts: { cursor: null, numItems: 5 },
    });

    const thread = threads.page.find((item) => item.status === "active");

    if (thread) {
      const resource: ThreadResource = { kind: "autopilotWeek", accountId, weekStart };

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

    if (account?.ownerUserId) {
      const label = account.name ?? (account.handle ? `@${account.handle}` : "seu negócio");

      await notifyOwner(
        ctx,
        account.ownerUserId,
        `${formatScheduleText(week.slots, `Piloto automático (${label}) — semana de ${week.label}`)}\n\nMe diga se quer mudar algum post.`,
      );
    }
  },
});

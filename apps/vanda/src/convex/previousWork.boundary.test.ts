// @vitest-environment edge-runtime
import { createThread, saveMessage, updateThreadMetadata } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  agentComponent.register(t);

  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "ana",
      name: "Ana",
      email: "ana@example.com",
      createdAt: 1,
      updatedAt: 1,
    });

    const foreignUserId = await ctx.db.insert("users", {
      clerkId: "bia",
      name: "Bia",
      email: "bia@example.com",
      createdAt: 1,
      updatedAt: 1,
    });

    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      name: "Café",
      createdAt: 1,
      updatedAt: 1,
    });

    const otherAccountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      name: "Loja",
      createdAt: 1,
      updatedAt: 1,
    });

    const foreignAccountId = await ctx.db.insert("accounts", {
      ownerUserId: foreignUserId,
      name: "Outro dono",
      createdAt: 1,
      updatedAt: 1,
    });

    await ctx.db.patch(userId, { activeAccountId: accountId });
    const threadIds: string[] = [];

    for (const key of [
      accountId,
      otherAccountId,
      foreignAccountId,
      `caetano:${userId}`,
      `caetano:${foreignUserId}`,
    ]) {
      const threadId = await createThread(ctx, components.agent, {
        userId: key,
        title: `Conversa ${key}`,
      });

      threadIds.push(threadId);
      await saveMessage(ctx, components.agent, {
        threadId,
        message: { role: "user", content: `Preferência girassol da conta ${key}` },
      });
    }

    return { userId, accountId, otherAccountId, foreignAccountId, threadIds };
  });

  return { t, ...ids };
}

describe("previous work boundaries", () => {
  it("searches within the current business, supports owner history, and excludes archived threads", async () => {
    const { t, userId, accountId, foreignAccountId, threadIds } = await setup();
    // Agent tool calls have no indexed text. Production search skips them;
    // the convex-test optional-field patch must preserve that behavior.
    await t.run((ctx) =>
      saveMessage(ctx, components.agent, {
        threadId: threadIds[0]!,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "search",
              toolName: "search_conversations",
              input: { query: "girassol" },
            },
          ],
        },
      }),
    );

    const result = await t.query(internal.previousWork.searchConversations, {
      userId,
      query: "girassol",
      source: "vanda",
    });

    expect(result.matches.map((hit) => hit.threadId)).toEqual([threadIds[0]]);
    expect(result.matches[0]?.text).toContain(accountId);

    const owner = await t.query(internal.previousWork.searchConversations, {
      userId,
      query: "girassol",
      source: "caetano",
    });

    expect(owner.matches.map((hit) => hit.threadId)).toEqual([threadIds[3]]);
    await expect(
      t.query(internal.previousWork.searchConversations, {
        userId,
        accountId: foreignAccountId,
        query: "girassol",
        source: "vanda",
      }),
    ).rejects.toThrow("conta não encontrada");
    await expect(
      t.query(internal.previousWork.searchConversations, {
        accountId,
        query: "girassol",
        source: "caetano",
      }),
    ).rejects.toThrow("conversa não encontrada");
    await t.run((ctx) =>
      updateThreadMetadata(ctx, components.agent, {
        threadId: threadIds[0]!,
        patch: { status: "archived" },
      }),
    );
    expect(
      (
        await t.query(internal.previousWork.searchConversations, {
          userId,
          query: "girassol",
          source: "vanda",
        })
      ).matches,
    ).toEqual([]);
  });

  it("checks thread scope before reading and paginates messages without losing source IDs", async () => {
    const { t, userId, accountId, threadIds } = await setup();

    for (const threadId of [threadIds[1]!, threadIds[2]!, threadIds[4]!]) {
      await expect(
        t.query(internal.previousWork.readConversation, { userId, threadId }),
      ).rejects.toThrow("conversa não encontrada");
    }

    await expect(
      t.query(internal.previousWork.readConversation, { accountId, threadId: threadIds[3]! }),
    ).rejects.toThrow("conversa não encontrada");
    await t.run(async (ctx) => {
      for (let i = 0; i < 24; i++)
        await saveMessage(ctx, components.agent, {
          threadId: threadIds[0]!,
          message: { role: "user", content: `Decisão ${i}` },
        });
    });

    const first = await t.query(internal.previousWork.readConversation, {
      userId,
      threadId: threadIds[0]!,
    });

    expect(first.messages).toHaveLength(20);
    expect(first.isDone).toBe(false);

    const second = await t.query(internal.previousWork.readConversation, {
      userId,
      threadId: threadIds[0]!,
      cursor: first.continueCursor,
    });

    expect(second.messages).toHaveLength(5);
    expect(second.isDone).toBe(true);
    expect(new Set([...first.messages, ...second.messages].map((row) => row.messageId)).size).toBe(
      25,
    );
    expect(second.messages.at(-1)?.text).toContain("girassol");
  });

  it("finds media beyond an empty page and never returns another business's resources", async () => {
    const { t, userId, accountId, otherAccountId, threadIds } = await setup();

    const images = await t.run(async (ctx) => {
      const own = await ctx.db.insert("images", {
        accountId,
        name: "Xícara azul",
        origin: "uploaded",
        createdAt: 1,
      });

      const other = await ctx.db.insert("images", {
        accountId: otherAccountId,
        name: "Xícara azul",
        origin: "uploaded",
        createdAt: 1,
      });

      for (let i = 0; i < 40; i++)
        await ctx.db.insert("images", {
          accountId,
          name: "Outra foto",
          origin: "uploaded",
          createdAt: 2,
        });

      return { own, other };
    });

    const first = await t.query(internal.previousWork.searchMedia, { userId, query: "xicara" });
    expect(first.images).toEqual([]);
    expect(first.isDone).toBe(false);

    const second = await t.query(internal.previousWork.searchMedia, {
      userId,
      query: "xicara",
      cursor: first.continueCursor,
    });

    expect(second.images.map((image) => image.imageId)).toEqual([images.own]);
    await t.mutation(internal.threadResources.record, {
      threadId: threadIds[0]!,
      anchorMessageId: "anchor",
      toolCallId: "media",
      resources: [
        { kind: "image", accountId, imageId: images.own },
        { kind: "image", accountId: otherAccountId, imageId: images.other },
      ],
      presented: [],
    });

    const history = await t.query(internal.previousWork.readConversation, {
      userId,
      threadId: threadIds[0]!,
    });

    expect(history.resources).toEqual([{ kind: "image", accountId, imageId: images.own }]);
  });
});

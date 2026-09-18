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

  it("overfetches excluded conversation candidates and reports an exhausted window", async () => {
    const { t, userId, accountId, threadIds } = await setup();
    await t.run(async (ctx) => {
      await updateThreadMetadata(ctx, components.agent, {
        threadId: threadIds[0]!,
        patch: { status: "archived" },
      });

      for (let index = 0; index < 13; index++) {
        const threadId = await createThread(ctx, components.agent, {
          userId: String(accountId),
          title: `Arquivada ${index}`,
        });

        await saveMessage(ctx, components.agent, {
          threadId,
          message: { role: "user", content: "agulha histórica" },
        });
        await updateThreadMetadata(ctx, components.agent, {
          threadId,
          patch: { status: "archived" },
        });
      }
    });

    const activeThreadId = await t.run(async (ctx) => {
      const threadId = await createThread(ctx, components.agent, {
        userId: String(accountId),
        title: "Ativa",
      });

      await saveMessage(ctx, components.agent, {
        threadId,
        message: { role: "user", content: "agulha histórica válida" },
      });

      return threadId;
    });

    const result = await t.query(internal.previousWork.searchConversations, {
      userId,
      query: "agulha histórica",
      source: "vanda",
    });

    expect(result.matches.map((match) => match.threadId)).toContain(activeThreadId);
    expect(result.matches).toHaveLength(1);
    expect(result.incomplete).toBe(false);

    await t.run(async (ctx) => {
      for (let index = 0; index < 48; index++) {
        const threadId = await createThread(ctx, components.agent, {
          userId: String(accountId),
          title: `Esgotada ${index}`,
        });

        await saveMessage(ctx, components.agent, {
          threadId,
          message: { role: "user", content: "janela saturada" },
        });
        await updateThreadMetadata(ctx, components.agent, {
          threadId,
          patch: { status: "archived" },
        });
      }
    });

    const exhausted = await t.query(internal.previousWork.searchConversations, {
      userId,
      query: "janela saturada",
      source: "vanda",
    });

    expect(exhausted.matches).toEqual([]);
    expect(exhausted.incomplete).toBe(true);
    expect(exhausted.note).toContain("Refine a consulta");

    await t.run(async (ctx) => {
      for (let i = 0; i < 13; i++)
        await saveMessage(ctx, components.agent, {
          threadId: activeThreadId,
          message: { role: "user", content: `resultados ativos ${i}` },
        });
    });

    const limited = await t.query(internal.previousWork.searchConversations, {
      userId,
      query: "resultados ativos",
      source: "vanda",
    });

    expect(limited.matches).toHaveLength(12);
    expect(limited.incomplete).toBe(true);
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

  it("reads search media by full id beyond the gallery and enforces readiness and ownership", async () => {
    const { t, userId, accountId, otherAccountId } = await setup();

    const ids = await t.run(async (ctx) => {
      const older = await ctx.db.insert("images", {
        accountId,
        name: "Arquivo profundo",
        origin: "uploaded",
        externalUrl: "https://images.example/older.jpg",
        createdAt: 1,
      });

      const reference = await ctx.db.insert("images", {
        accountId,
        name: "Referencia profunda",
        origin: "uploaded",
        purpose: "reference",
        // Failed metadata analysis does not remove the actual image bytes.
        inspectionStatus: "failed",
        externalUrl: "https://images.example/reference.jpg",
        createdAt: 2,
      });

      const pending = await ctx.db.insert("images", {
        accountId,
        name: "Arquivo profundo pendente",
        origin: "generated",
        status: "generating",
        externalUrl: "https://images.example/pending.jpg",
        createdAt: 1_000,
      });

      const failed = await ctx.db.insert("images", {
        accountId,
        name: "Arquivo profundo falho",
        origin: "generated",
        status: "failed",
        externalUrl: "https://images.example/failed.jpg",
        createdAt: 4,
      });

      const foreign = await ctx.db.insert("images", {
        accountId: otherAccountId,
        name: "Arquivo profundo alheio",
        origin: "uploaded",
        externalUrl: "https://images.example/foreign.jpg",
        createdAt: 5,
      });

      for (let index = 0; index < 101; index++)
        await ctx.db.insert("images", {
          accountId,
          name: "Recente",
          origin: "uploaded",
          externalUrl: `https://images.example/recent-${index}.jpg`,
          createdAt: 100 + index,
        });

      return { older, reference, pending, failed, foreign };
    });

    const searchAll = async (query: string) => {
      const found: string[] = [];
      let cursor: string | undefined;
      let done = false;

      while (!done) {
        const page = cursor
          ? await t.query(internal.previousWork.searchMedia, { userId, query, cursor })
          : await t.query(internal.previousWork.searchMedia, { userId, query });

        found.push(...page.images.map((image) => image.imageId));
        cursor = page.continueCursor;
        done = page.isDone;
      }

      return found;
    };

    const found = [...(await searchAll("arquivo")), ...(await searchAll("referencia"))];

    expect(found).toEqual(expect.arrayContaining([ids.older, ids.reference]));

    for (const imageId of [ids.pending, ids.failed, ids.foreign])
      expect(found).not.toContain(imageId);

    for (const imageId of [ids.older, ids.reference]) {
      const read = await t.query(internal.workspaceData.read, {
        accountId,
        path: `/images/${imageId}`,
      });

      expect(read).toMatchObject({ ok: true, file: { kind: "image", imageId } });
    }

    for (const imageId of [ids.pending, ids.failed, ids.foreign]) {
      const read = await t.query(internal.workspaceData.read, {
        accountId,
        path: `/images/${imageId}`,
      });

      expect(read.ok).toBe(false);
    }
  });
});

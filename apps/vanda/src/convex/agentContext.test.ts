/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion -- partial tool contexts isolate account selection without invoking providers */
import type { ToolCtx } from "@convex-dev/agent";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { agentIdentity, type AgentCtx } from "./agentContext";
import { productTools } from "./tools/product";

const id = (value: string) => value as Id<"accounts">;

const userId = "owner" as Id<"users">;

const deferred = () => {
  let resolve!: () => void;

  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

type MockCtx = ToolCtx &
  AgentCtx & {
    runMutation: ReturnType<typeof vi.fn>;
    runQuery: ReturnType<typeof vi.fn>;
  };

const selectTool = (ctx: MockCtx) =>
  Object.assign({}, productTools.select_account, { ctx }) as unknown as {
    execute: (
      input: { accountId: string },
      options: { toolCallId: string; messages: never[] },
    ) => Promise<unknown>;
  };

describe("account selection barrier", () => {
  it("waits for a newer selection queued while a write is already waiting", async () => {
    const first = deferred();
    const second = deferred();
    const scope: NonNullable<AgentCtx["accountScope"]> = { accountId: id("account-a") };

    const ctx = {
      ownerUserId: userId,
      accountScope: scope,
      runMutation: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
      runQuery: vi.fn().mockResolvedValue("brand"),
    } as unknown as MockCtx;

    const tool = selectTool(ctx);
    const selectingB = tool.execute({ accountId: "account-b" }, { toolCallId: "b", messages: [] });
    const writes: unknown[] = [];
    const writing = agentIdentity(ctx).then((identity) => writes.push(identity.accountId));
    await Promise.resolve();
    const selectingC = tool.execute({ accountId: "account-c" }, { toolCallId: "c", messages: [] });
    first.resolve();
    await selectingB;
    expect(writes).toEqual([]);
    second.resolve();
    await Promise.all([selectingC, writing]);
    expect(writes).toEqual([id("account-c")]);
  });

  it("blocks a subsequent account write until the selected account is ready", async () => {
    const mutation = deferred();
    const scope: NonNullable<AgentCtx["accountScope"]> = { accountId: id("account-a") };

    const ctx = {
      ownerUserId: userId,
      accountScope: scope,
      runMutation: vi.fn(() => mutation.promise),
      runQuery: vi.fn(() => Promise.resolve({ name: "B" })),
    };

    const selecting = selectTool(ctx as unknown as MockCtx).execute(
      { accountId: "account-b" },
      { toolCallId: "select", messages: [] },
    );

    const writtenAccounts: Array<Id<"accounts"> | undefined> = [];

    const write = agentIdentity(ctx as unknown as MockCtx).then(({ accountId }) => {
      writtenAccounts.push(accountId);

      return accountId;
    });

    expect(scope.accountId).toBe(id("account-a"));
    let writeSettled = false;
    void write.finally(() => {
      writeSettled = true;
    });
    await Promise.resolve();
    expect(writeSettled).toBe(false);
    expect(writtenAccounts).not.toContain(id("account-a"));

    mutation.resolve();
    await expect(write).resolves.toBe(id("account-b"));
    expect(writtenAccounts).toEqual([id("account-b")]);
    await expect(selecting).resolves.toBeDefined();
  });

  it("rejects overlapping work after a foreign selection and permits a later selection", async () => {
    const mutation = deferred();
    const scope: NonNullable<AgentCtx["accountScope"]> = { accountId: id("account-a") };

    const ctx = {
      ownerUserId: userId,
      accountScope: scope,
      runMutation: vi
        .fn()
        .mockImplementationOnce(() =>
          mutation.promise.then(() => Promise.reject(new Error("conta não encontrada"))),
        )
        .mockResolvedValueOnce(undefined),
      runQuery: vi.fn(() => Promise.resolve({ name: "B" })),
    };

    const rejectedSelection = selectTool(ctx as unknown as MockCtx).execute(
      { accountId: "foreign" },
      { toolCallId: "foreign", messages: [] },
    );

    const overlappingWrite = agentIdentity(ctx as unknown as MockCtx);
    mutation.resolve();

    await expect(rejectedSelection).rejects.toThrow("conta não encontrada");
    await expect(overlappingWrite).rejects.toThrow("conta não encontrada");
    expect(scope.accountId).toBe(id("account-a"));

    await expect(
      selectTool(ctx as unknown as MockCtx).execute(
        { accountId: "account-b" },
        { toolCallId: "retry", messages: [] },
      ),
    ).resolves.toBeDefined();
    await expect(agentIdentity(ctx as unknown as MockCtx)).resolves.toMatchObject({
      accountId: id("account-b"),
    });
  });
});

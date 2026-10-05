// @vitest-environment edge-runtime
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  agentComponent.register(t);
  const now = Date.now();

  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Ana",
      email: "ana@example.com",
      clerkId: "ana",
      createdAt: now,
      updatedAt: now,
    });

    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      name: "Café da Ana",
      handle: "cafedaana",
      publisherConnectedAt: now,
      onboardedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(userId, { activeAccountId: accountId });

    return userId;
  });

  return { t, userId, owner: t.withIdentity({ subject: "ana" }) };
}

describe("platform settings registry", () => {
  it("changes a model by its label and reports the previous value for undo", async () => {
    const { t, userId, owner } = await setup();

    const result = await t.mutation(internal.settingsData.set, {
      userId,
      id: "models.caetano",
      value: "gpt 6.1 sol",
    });

    expect(result).toMatchObject({
      id: "models.caetano",
      previous: "openai/gpt-6-luna",
      value: "openai/gpt-6.1-sol",
      label: "GPT-6.1 Sol",
    });
    // The Perfil picker reads the same state the agent just wrote.
    expect((await owner.query(api.users.modelPreferences))?.caetano).toBe("openai/gpt-6.1-sol");

    await t.mutation(internal.settingsData.set, {
      userId,
      id: "models.caetano",
      value: String(result.previous),
    });
    expect((await owner.query(api.users.modelPreferences))?.caetano).toBe("openai/gpt-6-luna");
  });

  it("refuses read-only settings with where the owner changes them", async () => {
    const { t, userId } = await setup();

    await expect(
      t.mutation(internal.settingsData.set, { userId, id: "billing.plan", value: "profissional" }),
    ).rejects.toThrow("Perfil › Gerenciar plano");
    await expect(
      t.mutation(internal.settingsData.set, { userId, id: "nope", value: "x" }),
    ).rejects.toThrow("configuração desconhecida");
  });

  it("returns every current value in one snapshot, and one setting in detail", async () => {
    const { t, userId } = await setup();

    const { settings } = await t.query(internal.settingsData.get, { userId });
    const byId = Object.fromEntries((settings ?? []).map((setting) => [setting.id, setting.value]));

    expect(byId).toMatchObject({
      "models.vanda": "GPT-6 Luna",
      "billing.plan": { plan: "Teste grátis", limited: false },
      "connections.instagram": { connected: true, handle: "@cafedaana" },
      "connections.whatsapp": { linked: false },
    });

    const { setting } = await t.query(internal.settingsData.get, { userId, id: "models.image" });
    expect(setting).toMatchObject({
      access: "write",
      where: "Perfil › Avançado › Modelos",
      docs: "/docs/modelos",
    });
    expect(setting?.options?.length).toBeGreaterThan(1);
  });
});

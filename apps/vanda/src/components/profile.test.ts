// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ProfilePage } from "../routes/_dashboard.perfil";

// SAFETY: test IDs model opaque identifiers without pretending to be account records.
const businessA = "business-a" as Id<"accounts">;

// SAFETY: test IDs model opaque identifiers without pretending to be account records.
const businessB = "business-b" as Id<"accounts">;

// SAFETY: test IDs model opaque identifiers without pretending to be account records.
const unfinished = "unfinished" as Id<"accounts">;

const mocks = {
  query: vi.fn(),
  action: vi.fn().mockResolvedValue({}),
  navigate: vi.fn(),
  selectAccount: vi.fn(),
  openUserProfile: vi.fn(),
  saveBrandFile: vi.fn().mockResolvedValue(undefined),
  setTheme: vi.fn().mockResolvedValue(undefined),
  // SAFETY: the mutable fixture intentionally models Clerk's nullable first name.
  user: { fullName: "Test Owner", firstName: "Test" as string | null },
};

const runtime = {
  useProfileUser: () => ({ user: mocks.user }),
  useClerkActions: () => ({ signOut: mocks.action, openUserProfile: mocks.openUserProfile }),
  useProfileNavigate: () => mocks.navigate,
  useProfileAccounts: () => ({
    accounts: [
      { id: businessA, name: "Business A", onboardedAt: 1 },
      { id: businessB, name: "Business B", onboardedAt: 1 },
      { id: unfinished, name: "Unfinished", onboardedAt: null },
    ],
    activeAccount: { id: businessA, name: "Business A", onboardedAt: 1 },
    selectAccount: mocks.selectAccount,
  }),
  useUsageSummary: () => mocks.query(api.usage.summary),
  useSyncBilling: () => mocks.action,
  useBillingActions: () => ({
    startCheckout: mocks.action,
    previewPlanChange: mocks.action,
    changePlan: mocks.action,
    getPortalUrl: mocks.action,
  }),
  useModelPreferences: () => ({
    preferences: mocks.query(api.users.modelPreferences),
    setAgentModel: mocks.action,
    setCaetanoModel: mocks.action,
    setImageModel: mocks.action,
  }),
  usePublisherConnection: (accountId: string) => ({
    status: mocks.query(api.publisherConnect.connectionStatus, { accountId }),
    startConnect: mocks.action,
    syncConnection: mocks.action,
  }),
  useOpenAiConnection: () => ({
    status: mocks.query(api.openaiSub.connectionStatus),
    startDeviceAuth: mocks.action,
    pollDeviceAuth: mocks.action,
    disconnect: mocks.action,
  }),
  useBrandFile: (accountId: string) => ({
    file: mocks.query(api.brandFile.get, { accountId }),
    save: mocks.saveBrandFile,
  }),
  useAppearance: () => ({
    theme: mocks.query(api.users.appearance),
    setTheme: mocks.setTheme,
  }),
  useWorkspaceFile: (accountId: string, path: string) =>
    mocks.query(api.workspacePublic.file, { accountId, path }),
  WhatsAppSettings: () => createElement("p", null, "Caetano no WhatsApp"),
  InstagramDiagnosis: () => createElement("p", null, "Nota do perfil"),
};

let root: Root;

let container: HTMLDivElement;

const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === label,
  );

  expect(button, label).toBeDefined();
  await act(async () => button!.click());
};

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.user.firstName = "Test";
  mocks.query.mockImplementation((ref, args: { accountId: string }) => {
    const name = getFunctionName(ref);

    if (name === "usage:summary") return { plan: "profissional", usedPct: 37 };

    if (name === "workspacePublic:file") return { ok: false };

    if (name === "brandFile:get")
      return {
        content: `# Marca · ${args.accountId}\n\n## Tom e voz\n\n- Sem gírias (dono)\n`,
        persisted: true,
        updatedAt: Date.UTC(2026, 9, 1),
        updatedBy: "owner",
        bytes: 60,
        maxBytes: 24_000,
      };

    if (name === "whatsappData:state")
      return { connected: false, configured: true, deliveries: [] };

    return undefined;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(ProfilePage, { runtime })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it.each([
  ["openai/gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
  ["openai/gpt-image-2", "GPT Image 2"],
])("enables the subscription image picker and displays %s", async (image, label) => {
  mocks.query.mockImplementation((ref) => {
    if (getFunctionName(ref) === "users:modelPreferences") {
      return {
        conectado: true,
        orchestrator: "openai/gpt-6-astra",
        caetano: "openai/gpt-6-astra",
        image,
      };
    }

    return undefined;
  });
  await act(async () => root.render(createElement(ProfilePage, { runtime })));
  const picker = container.querySelector('[aria-label="Modelo de imagens"]');

  expect(picker).not.toBeNull();
  expect(picker?.hasAttribute("disabled")).toBe(false);
  expect(picker?.textContent).toContain(label);
  expect(container.querySelector('[aria-label="Modelo de conversa"]')?.textContent).toContain(
    "GPT-6 Astra",
  );
  await click("Modelo do Caetano");

  const opus = [...document.querySelectorAll('[role="option"]')].find((option) =>
    option.textContent?.includes("Claude Opus 5"),
  );

  expect(opus).toBeDefined();
  expect(opus?.getAttribute("aria-disabled")).toBe("true");

  const muse = [...document.querySelectorAll('[role="option"]')].find((option) =>
    option.textContent?.includes("Muse Spark 1.3 Contributor"),
  );

  expect(muse).toBeDefined();
  expect(muse?.getAttribute("aria-disabled")).toBe("true");
});

it.each(["Modelo de conversa", "Modelo do Caetano"])(
  "offers Muse with the Meta mark in %s and saves its OpenRouter id",
  async (label) => {
    const preferences = {
      conectado: false,
      orchestrator: "openai/gpt-5.6-terra",
      caetano: "openai/gpt-5.6-terra",
      image: "openai/gpt-image-2.5-flare",
    };

    mocks.query.mockImplementation((ref) => {
      if (getFunctionName(ref) === "users:modelPreferences") return preferences;

      return undefined;
    });
    await act(async () => root.render(createElement(ProfilePage, { runtime })));
    await click(label);

    const muse = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("Muse Spark 1.3 Contributor"),
    );

    expect(muse?.getAttribute("aria-disabled")).not.toBe("true");
    expect(muse?.querySelector("svg path")?.getAttribute("d")).toMatch(/^M6\.915 4\.03/);
    await act(async () => muse!.click());
    expect(mocks.action).toHaveBeenLastCalledWith({ modelId: "meta/muse-spark-1.3-contributor" });
    preferences.orchestrator = "meta/muse-spark-1.3-contributor";
    preferences.caetano = "meta/muse-spark-1.3-contributor";
    await act(async () => root.render(createElement(ProfilePage, { runtime })));
    const trigger = container.querySelector(`[aria-label="${label}"]`);
    expect(trigger?.textContent).toContain("Muse Spark 1.3 Contributor");
    expect(trigger?.querySelector("svg path")?.getAttribute("d")).toMatch(/^M6\.915 4\.03/);
  },
);

it("shows the account, plan, connections and businesses on one page", () => {
  // Billing refreshes once on arrival (no args); Instagram rows sync per business.
  expect(mocks.action.mock.calls.filter((call) => call.length === 0)).toHaveLength(1);
  expect(container.querySelector("h1")?.textContent).toBe("Perfil");
  expect(container.textContent).toContain("Test Owner");
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("37");
  expect(container.textContent).not.toContain("Escolha seu plano");
  expect(container.textContent).toContain("Caetano no WhatsApp");
  expect(container.textContent).toContain("Instagram · Business A");
  expect(container.textContent).toContain("Instagram · Business B");
  expect(container.textContent).not.toContain("Instagram · Unfinished");
  expect(container.textContent).toContain("Cadastro incompleto");
  expect(container.textContent).not.toContain("Skills");
});

it("opens the profile editor and toggles plan management in place", async () => {
  await click("Editar");
  expect(mocks.openUserProfile).toHaveBeenCalledTimes(1);
  await click("Gerenciar plano");
  expect(container.textContent).toContain("Escolha seu plano");
  expect(container.textContent).toContain("Cobrança e faturas");
  await click("Fechar planos");
  expect(container.textContent).not.toContain("Escolha seu plano");
});

it("opens a business's brand file and the onboarding for unfinished ones", async () => {
  await click("Business AVer arquivo da marca");
  expect(mocks.navigate).toHaveBeenLastCalledWith({
    to: "/perfil",
    search: { marca: "business-a" },
  });
  await click("UnfinishedCadastro incompleto. Concluir");
  expect(mocks.navigate).toHaveBeenLastCalledWith({
    to: "/onboarding",
    search: { accountId: "unfinished" },
  });
  await click("Adicionar negócio");
  expect(mocks.navigate).toHaveBeenLastCalledWith({ to: "/onboarding", search: { flow: "add" } });
});

it("reads and edits the brand file, then hands off to the conversation", async () => {
  await act(async () => root.render(createElement(ProfilePage, { runtime, marca: "business-a" })));
  expect(container.querySelector("h1")?.textContent).toBe("Business A");
  // Laid out as a guide: the item under its section, its origin as a badge.
  expect(container.textContent).toContain("Tom e voz");
  expect(container.textContent).toContain("Sem gírias");
  expect(container.textContent).not.toContain("(dono)");
  expect(container.querySelector('[aria-label="Dono"]')).not.toBeNull();
  expect(container.textContent).toContain("Atualizado por você");
  expect(container.textContent).toContain("Diagnóstico do Instagram");
  expect(container.textContent).toContain("Nota do perfil");

  await click("Editar");
  const editor = container.querySelector<HTMLTextAreaElement>('[aria-label="Arquivo da marca"]');
  expect(editor?.value).toContain("Sem gírias (dono)");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setValue.call(editor, `${editor!.value}- Sem emojis (dono)\n`);
    editor!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Salvar");
  expect(mocks.saveBrandFile).toHaveBeenCalledWith(expect.stringContaining("Sem emojis (dono)"));
  expect(container.querySelector('[aria-label="Arquivo da marca"]')).toBeNull();

  await click("Ajustar com a Vanda na conversa");
  expect(mocks.selectAccount).toHaveBeenCalledWith("business-a");
  expect(mocks.navigate).toHaveBeenLastCalledWith({ to: "/conversa", search: {} });
});

it("does not open the brand file of a business that has not finished onboarding", async () => {
  await act(async () => root.render(createElement(ProfilePage, { runtime, marca: "unfinished" })));
  expect(container.textContent).toContain("Negócio não encontrado");
  expect(container.textContent).not.toContain("Arquivo da marca");
});

it("warns when the ChatGPT plan runs without a connected OpenAI account", async () => {
  mocks.query.mockImplementation((ref) => {
    const name = getFunctionName(ref);

    if (name === "usage:summary") return { plan: "conectado", usedPct: 12 };

    if (name === "openaiSub:connectionStatus") return { connected: false };

    return undefined;
  });
  await act(async () => root.render(createElement(ProfilePage, { runtime })));
  expect(container.textContent).toContain("Sua conta OpenAI não está conectada");
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("12");
  expect(container.textContent).toContain("Conta OpenAI");
});

it("applies a theme at once and saves it to the account", async () => {
  document.documentElement.classList.add("dark");
  await click("Claro");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem("vanda-theme")).toBe("light");
  expect(mocks.setTheme).toHaveBeenCalledWith("light");
  await click("Escuro");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

it("does not claim zero usage or a trial plan while the summary is loading", async () => {
  mocks.query.mockReturnValue(undefined);
  await act(async () => root.render(createElement(ProfilePage, { runtime })));
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(container.textContent).not.toContain("Teste grátis");
});

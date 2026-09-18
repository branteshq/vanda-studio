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
  useInstalledSkills: (accountId: string) =>
    mocks.query(api.workspacePublic.installedSkills, { accountId }),
  useWorkspaceFile: (accountId: string, path: string, skip: boolean) =>
    mocks.query(api.workspacePublic.file, skip ? "skip" : { accountId, path }),
  useWorkspaceBrowse: (accountId: string, path: string) =>
    mocks.query(api.workspacePublic.browse, { accountId, path }),
  WhatsAppSettings: () => createElement("p", null, "Caetano no WhatsApp"),
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
  mocks.query.mockImplementation((ref, args) => {
    const name = getFunctionName(ref);

    if (name === "usage:summary") return { plan: "profissional", usedPct: 37 };

    if (name === "workspacePublic:browse") return { ok: true, entries: [] };

    if (name === "workspacePublic:file") return args === "skip" ? undefined : { ok: false };

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

it("enables the subscription image picker and displays the selected new models", async () => {
  mocks.query.mockImplementation((ref) => {
    if (getFunctionName(ref) === "users:modelPreferences") {
      return {
        conectado: true,
        orchestrator: "openai/gpt-6-astra",
        caetano: "openai/gpt-6-astra",
        image: "openai/gpt-image-2.5-sunburst",
      };
    }

    return undefined;
  });
  await click("Modelos");
  const picker = container.querySelector('[aria-label="Modelo de imagens"]');

  expect(picker).not.toBeNull();
  expect(picker?.hasAttribute("disabled")).toBe(false);
  expect(picker?.textContent).toContain("GPT Image 2.5 Sunburst");
  expect(container.querySelector('[aria-label="Modelo de conversa"]')?.textContent).toContain(
    "GPT-6 Astra",
  );
  await click("Modelo do Caetano");

  const opus = [...document.querySelectorAll('[role="option"]')].find((option) =>
    option.textContent?.includes("Claude Opus 5"),
  );

  expect(opus).toBeDefined();
  expect(opus?.getAttribute("aria-disabled")).toBe("true");
});

it("refreshes billing on arrival without opening the plan comparison", () => {
  expect(mocks.action).toHaveBeenCalledTimes(1);
  expect(container.querySelector("h1")?.textContent).toBe("Conta");
  expect(container.querySelector("dl")?.textContent).toContain("Test Owner");
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("37");
  expect(container.textContent).not.toContain("Escolha seu plano");
});

it("labels the personal page with the first name and omits sidebar branding", async () => {
  expect(container.querySelector('header [aria-label="Test"]')?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(container.querySelector("aside")?.textContent).not.toContain("Vanda Studio");
  expect(container.querySelector("aside")?.textContent).toContain("Sair da conta");
  mocks.user.firstName = null;
  await act(async () => root.render(createElement(ProfilePage, { runtime })));
  expect(container.querySelector('header [aria-label="Minha conta"]')).not.toBeNull();
});

it("separates account settings and marks the selected destination", async () => {
  await click("Plano e uso");
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Plano e uso");
  expect(container.textContent).toContain("Escolha seu plano");
  expect(container.textContent).not.toContain("Caetano no WhatsApp");
  await click("Conexões");
  expect(container.textContent).toContain("Caetano no WhatsApp");
  expect(container.textContent).not.toContain("Instagram · Business A");
  expect(container.textContent).not.toContain("Escolha seu plano");
  expect(container.querySelector('[aria-label="Negócio em foco"]')).toBeNull();
  await click("Business A");
  await click("Conexões");
  expect(container.textContent).toContain("Instagram · Business A");
  expect(container.textContent).not.toContain("Caetano no WhatsApp");
  expect(container.querySelector('[aria-label="Negócio em foco"]')).toBeNull();
  await click("Business B");
  expect(container.textContent).toContain("Instagram · Business B");
  expect(container.textContent).not.toContain("Instagram · Business A");
  expect(container.querySelector('header [aria-label="Unfinished"]')).toBeNull();
});

it("offers a business-scoped path from empty memory back to the conversation", async () => {
  await click("Business A");
  await click("Memória");
  expect(container.textContent).toContain("Nenhuma nota ainda");
  await click("Ajuste com a Vanda na conversa");
  expect(mocks.selectAccount).toHaveBeenCalledWith("business-a");
  expect(mocks.navigate).toHaveBeenCalledWith({ to: "/conversa", search: {} });
});

it("remembers each scope's destination instead of showing the wrong settings", async () => {
  await click("Modelos");
  await click("Business A");
  await click("Templates");
  await click("Test");
  expect(container.querySelector("h1")?.textContent).toBe("Modelos");
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Modelos");
  await click("Business A");
  expect(container.querySelector("h1")?.textContent).toBe("Templates");
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Templates");
});

it("opens the real profile editor and routes plan management to billing", async () => {
  await click("Editar perfil");
  expect(mocks.openUserProfile).toHaveBeenCalledTimes(1);
  await click("Gerenciar plano");
  expect(container.querySelector("h1")?.textContent).toBe("Plano e uso");
  expect(container.textContent).toContain("Gerenciar cobrança e faturas");
});

it("does not claim zero usage or a trial plan while the summary is loading", async () => {
  mocks.query.mockReturnValue(undefined);
  await act(async () => root.render(createElement(ProfilePage, { runtime })));
  expect(container.querySelector('[aria-label="Carregando uso do plano"]')).not.toBeNull();
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(container.textContent).not.toContain("Teste grátis");
});

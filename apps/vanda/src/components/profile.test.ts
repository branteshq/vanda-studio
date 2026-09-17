// @vitest-environment happy-dom
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route } from "../routes/_dashboard.perfil";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  action: vi.fn().mockResolvedValue({}),
  navigate: vi.fn(),
  selectAccount: vi.fn(),
  openUserProfile: vi.fn(),
}));
vi.mock("@clerk/tanstack-react-start", () => ({
  useUser: () => ({ user: { fullName: "Test Owner" } }),
  useClerk: () => ({ signOut: mocks.action, openUserProfile: mocks.openUserProfile }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("convex-helpers/react/cache", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useQuery: mocks.query,
  useAction: () => mocks.action,
  useMutation: () => mocks.action,
}));
vi.mock("../components/active-account", () => ({
  useActiveAccount: () => ({
    accounts: [
      { id: "business-a", name: "Business A", onboardedAt: 1 },
      { id: "business-b", name: "Business B", onboardedAt: 1 },
      { id: "unfinished", name: "Unfinished", onboardedAt: null },
    ],
    activeAccount: { id: "business-a", name: "Business A", onboardedAt: 1 },
    selectAccount: mocks.selectAccount,
  }),
}));

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
  await act(async () => root.render(createElement(Route.options.component as ComponentType)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("refreshes billing on arrival without opening the plan comparison", () => {
  expect(mocks.action).toHaveBeenCalledTimes(1);
  expect(container.querySelector("h1")?.textContent).toBe("Conta");
  expect(container.querySelector("dl")?.textContent).toContain("Test Owner");
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("37");
  expect(container.textContent).not.toContain("Escolha seu plano");
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
  await click("Pessoal");
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
  await act(async () => root.render(createElement(Route.options.component as ComponentType)));
  expect(container.querySelector('[aria-label="Carregando uso do plano"]')).not.toBeNull();
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(container.textContent).not.toContain("Teste grátis");
});

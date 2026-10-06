// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WhatsAppSettingsView, type WhatsAppConnection } from "./whatsapp-settings";

let container: HTMLDivElement;

let root: Root;

const link = () => ({
  url: "https://wa.me/5511999999999?text=vanda%20conectar%20abc",
  expiresAt: Date.now() + 10 * 60_000,
});

const disconnected: WhatsAppConnection["state"] = {
  configured: true,
  connected: false,
  sender: null,
  chatUrl: null,
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const render = (state: WhatsAppConnection["state"]) =>
  act(async () =>
    root.render(
      createElement(WhatsAppSettingsView, {
        state,
        createLink: async () => link(),
        disconnect: async () => {},
      }),
    ),
  );

const control = (label: string) =>
  [...container.querySelectorAll<HTMLElement>("button, a")].find(
    (node) => node.textContent === label,
  );

const press = (label: string) => act(async () => control(label)?.click());

it("turns Conectar into an Abrir WhatsApp button once the link exists", async () => {
  await render(disconnected);
  expect(control("Abrir WhatsApp")).toBeUndefined();

  await press("Conectar");

  expect(control("Abrir WhatsApp")?.getAttribute("href")).toContain("wa.me");
  // The only action left is sending the message, so Conectar is gone.
  expect(control("Conectar")).toBeUndefined();
  expect(container.textContent).toContain("Aguardando sua mensagem no WhatsApp");
  expect(container.textContent).toContain("toque em enviar");
});

it("offers a new link only after the old one expires", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await render(disconnected);
  await press("Conectar");
  expect(control("Abrir WhatsApp")).toBeDefined();

  await act(async () => vi.advanceTimersByTime(10 * 60_000 + 1));

  expect(control("Abrir WhatsApp")).toBeUndefined();
  expect(control("Gerar novo link")).toBeDefined();
  expect(container.textContent).toContain("O link expirou");
});

it("shows the connection once the message lands", async () => {
  await render(disconnected);
  await press("Conectar");

  await render({
    configured: true,
    connected: true,
    sender: "5511988887777",
    chatUrl: "https://wa.me/5511999999999",
  });

  expect(container.textContent).toContain("Conectado: +5511988887777");
  expect(control("Abrir conversa")).toBeDefined();
  expect(control("Abrir WhatsApp")).toBeUndefined();
});

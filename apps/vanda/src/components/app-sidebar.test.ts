// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Sidebar, SidebarProvider, SidebarTrigger } from "@vanda-studio/ui/components/sidebar";
import { MobileSidebarHeader } from "./app-sidebar";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

it.each([true, false])(
  "opens and closes the mobile drawer independently of desktop open=%s",
  async (defaultOpen) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        createElement(
          SidebarProvider,
          { defaultOpen },
          createElement(MobileSidebarHeader),
          createElement(
            Sidebar,
            null,
            createElement(SidebarTrigger, { "aria-label": "Fechar menu" }),
          ),
        ),
      );
    });

    const opener = container.querySelector<HTMLButtonElement>(
      '[aria-label="Abrir menu de navegação"]',
    );

    expect(opener).not.toBeNull();
    expect(opener!.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => opener!.click());

    const drawer = document.querySelector('[role="dialog"][data-mobile="true"]');

    expect(drawer).not.toBeNull();
    expect(opener!.getAttribute("aria-expanded")).toBe("true");
    // A second close button would cover the app header's gallery shortcut.
    expect(drawer!.querySelector('[data-slot="sheet-close"]')).toBeNull();

    const closer = drawer!.querySelector<HTMLButtonElement>('[aria-label="Fechar menu"]');

    await act(async () => closer!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(opener!.getAttribute("aria-expanded")).toBe("false");
    await act(async () => opener!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  },
);

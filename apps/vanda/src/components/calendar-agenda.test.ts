// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarItem } from "../convex/calendar";
import type { Id } from "../convex/_generated/dataModel";
import { Agenda } from "../routes/_dashboard.calendario";

let root: Root;

let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(overrides: Partial<ComponentProps<typeof Agenda>> = {}) {
  await act(async () =>
    root.render(
      createElement(Agenda, {
        month: new Date(2026, 9, 1),
        days: Array.from({ length: 31 }, (_, index) => ({
          date: new Date(2026, 9, index + 1),
          key: String(index + 1),
        })),
        itemsByDay: new Map(),
        loading: false,
        starting: false,
        isToday: (date) => date.getDate() === 7,
        onOpen: () => {},
        ...overrides,
      }),
    ),
  );
}

async function clickDay(day: number) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-day]")).find(
    (button) => button.textContent === String(day),
  )!;

  await act(async () => button.click());
}

const scheduled: CalendarItem = {
  key: "scheduled",
  scheduledFor: new Date(2026, 9, 7, 18, 30).getTime(),
  status: "scheduled",
  caption: "Novidades da semana",
  // SAFETY: Opaque test ID used only by the onOpen callback, never sent to Convex.
  postId: "post" as Id<"posts">,
  scheduledPostId: null,
  autopilot: null,
  lastError: null,
  coverUrl: null,
  slideCount: 1,
};

const automatic: CalendarItem = {
  ...scheduled,
  key: "automatic",
  scheduledFor: new Date(2026, 9, 9, 9, 15).getTime(),
  status: "awaiting_approval",
  postId: null,
  autopilot: {
    // SAFETY: Opaque test ID used only by the onOpen callback, never sent to Convex.
    slotId: "slot" as Id<"autopilotSlots">,
    hook: "Os detalhes que fazem a diferença",
    purposeLabel: "Educar",
  },
};

it("renders the month while loading and distinguishes empty and planning results", async () => {
  await render({ loading: true });
  expect(container.querySelectorAll("button[data-day]")).toHaveLength(31);
  expect(container.textContent).toContain("Carregando posts…");
  expect(container.textContent).not.toContain("Nada agendado");

  await render();
  expect(container.querySelectorAll("button[data-day]")).toHaveLength(31);
  expect(container.textContent).toContain("Nada agendado neste mês.");
  expect(container.textContent).not.toContain("Carregando posts…");

  await render({ starting: true });
  expect(container.textContent).toContain("O Caetano está planejando");
  expect(container.textContent).not.toContain("Nada agendado");
});

it("marks post dates, filters and clears days, and opens the chosen post", async () => {
  const onOpen = vi.fn();
  await render({
    itemsByDay: new Map([
      [7, [scheduled]],
      [9, [automatic]],
    ]),
    onOpen,
  });
  expect(
    Array.from(container.querySelectorAll("button[data-day]:has(span[aria-hidden])")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["7", "9"]);
  expect(container.querySelectorAll("li")).toHaveLength(2);

  await clickDay(9);
  expect(container.querySelectorAll("li")).toHaveLength(1);
  expect(container.querySelector("li")!.textContent).toContain(automatic.autopilot!.hook);
  expect(container.querySelector("li")!.textContent).toContain("09:15");
  await act(async () => container.querySelector<HTMLButtonElement>("li button")!.click());
  expect(onOpen).toHaveBeenLastCalledWith(automatic);

  await clickDay(8);
  expect(container.querySelectorAll("li")).toHaveLength(0);
  expect(container.textContent).toContain("Nada agendado em 8 de outubro.");

  const reset = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Ver mês inteiro",
  )!;

  await act(async () => reset.click());
  expect(container.querySelectorAll("li")).toHaveLength(2);
  await clickDay(7);
  await act(async () => container.querySelector<HTMLButtonElement>("li button")!.click());
  expect(onOpen).toHaveBeenLastCalledWith(scheduled);
});

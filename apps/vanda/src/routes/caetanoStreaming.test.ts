// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "@convex-dev/agent/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CaetanoMessage } from "./_dashboard.caetano";

let root: Root;

let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const render = async (parts: UIMessage["parts"], status: UIMessage["status"] = "streaming") => {
  const message: UIMessage = {
    id: "answer",
    key: "answer",
    role: "assistant",
    parts,
    status,
    order: 1,
    stepOrder: 0,
    text: "",
    _creationTime: 0,
  };

  await act(async () => root.render(createElement(CaetanoMessage, { message, resources: [] })));
};

const advance = async () => {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }
};

it("keeps the text node and visible prefix across stream deltas and completion", async () => {
  const chunks = ["Olá,", " posso ajudar", " com **seu negócio**."];
  let text = chunks[0]!;
  await render([{ type: "text", text }]);
  await advance();
  expect(container.textContent).toBe("Olá,");
  const markdown = container.querySelector(".typeset");

  for (const chunk of chunks.slice(1)) {
    const previous = container.textContent!;
    text += chunk;
    await render([{ type: "text", text }]);
    expect(container.querySelector(".typeset")).toBe(markdown);
    expect(container.textContent!.startsWith(previous)).toBe(true);
    await advance();
  }

  await render([{ type: "text", text }], "success");
  await advance();
  expect(container.querySelector(".typeset")).toBe(markdown);
  expect(container.textContent).toBe("Olá, posso ajudar com seu negócio.");
  expect(container.querySelector("strong")?.textContent).toBe("seu negócio");
});

it("preserves distinct text parts when an earlier whitespace part becomes visible", async () => {
  await render([
    { type: "text", text: " " },
    { type: "text", text: "Segundo trecho" },
  ]);
  await advance();
  const second = container.querySelector(".typeset");
  await render([
    { type: "text", text: "Primeiro trecho" },
    { type: "text", text: "Segundo trecho maior" },
  ]);
  expect(container.querySelectorAll(".typeset")[1]).toBe(second);
  await advance();
  expect([...container.querySelectorAll(".typeset")].map((node) => node.textContent)).toEqual([
    "Primeiro trecho",
    "Segundo trecho maior",
  ]);
});

it("shows saved messages immediately without replaying the stream", async () => {
  await render([{ type: "text", text: "Resposta já salva." }], "success");
  expect(container.textContent).toBe("Resposta já salva.");
});

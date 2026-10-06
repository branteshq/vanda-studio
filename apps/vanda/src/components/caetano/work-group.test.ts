import type { UIMessage } from "@convex-dev/agent/react";
import { describe, expect, it } from "vitest";
import { groupWork } from "./work-group";

const message = (key: string, role: "user" | "assistant", text: string): UIMessage => ({
  id: key,
  key,
  role,
  order: Number(key),
  stepOrder: 0,
  status: "success",
  text,
  _creationTime: Number(key),
  parts: [{ type: "text", text }],
});

const job = (key: string, kind: string, label: string) =>
  message(
    key,
    "user",
    `Faça a tarefa.\n<caetano_ref>autopilot tarefa=${kind} semana=12/10 rótulo="${label}"</caetano_ref>`,
  );

describe("groupWork folds Caetano's work turns", () => {
  it("keeps owner messages apart and folds consecutive work with its replies", () => {
    const items = groupWork(
      [
        message("1", "user", "Oi"),
        message("2", "assistant", "Oi!"),
        job("3", "audit", "Diagnóstico"),
        message("4", "assistant", "Diagnóstico pronto."),
        job("5", "plan", "Plano da semana"),
        message("6", "assistant", "Plano pronto."),
        job("7", "post", "Qua 19h"),
        message("8", "user", "Valeu"),
      ],
      false,
    );

    expect(items.map((item) => item.kind)).toEqual(["message", "message", "work", "message"]);

    const work = items[2];

    expect(work?.kind === "work" && work.entries.map((entry) => entry.index)).toEqual([
      2, 3, 4, 5, 6,
    ]);
    expect(
      work?.kind === "work" && work.tasks.map((task) => [task.label, task.week, task.state]),
    ).toEqual([
      ["Diagnóstico", "12/10", "done"],
      ["Plano da semana", "12/10", "done"],
      ["Qua 19h", "12/10", "queued"],
    ]);
  });

  it("marks only the first unanswered task as running while Caetano works", () => {
    const [work] = groupWork([job("1", "post", "Qua 19h"), job("2", "post", "Sex 12h")], true);

    expect(work?.kind === "work" && work.tasks.map((task) => task.state)).toEqual([
      "running",
      "queued",
    ]);
  });
});

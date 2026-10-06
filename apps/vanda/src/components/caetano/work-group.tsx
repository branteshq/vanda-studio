import { useState, type ReactNode } from "react";
import type { UIMessage } from "@convex-dev/agent/react";
import { CalendarClock, Check, ChevronDown, Clock3, LoaderCircle } from "lucide-react";
import { cn } from "@vanda-studio/ui/lib/utils";
import { autopilotJobKinds, type AutopilotJob } from "../../convex/autopilotModel";

/**
 * Caetano's posts automáticos work (diagnosis, a week's plan, each post) runs as
 * turns of his one thread, started by a hidden "autopilot tarefa=…" marker (see
 * jobRef in convex/autopilotData.ts). The chat folds each run of that work into
 * one block, so the owner's conversation stays readable and every step stays
 * one click away.
 */

export type WorkTaskKind = AutopilotJob["kind"];

export type WorkTaskState = "queued" | "running" | "done";

export interface WorkTask {
  readonly key: string;
  readonly kind: WorkTaskKind;
  readonly label: string;
  readonly week: string | null;
  readonly state: WorkTaskState;
}

interface Entry {
  readonly message: UIMessage;
  readonly index: number;
}

export type ChatItem =
  | { readonly kind: "message"; readonly message: UIMessage; readonly index: number }
  | {
      readonly kind: "work";
      readonly key: string;
      readonly entries: readonly Entry[];
      readonly tasks: readonly WorkTask[];
    };

const WORK_REF =
  /<caetano_ref>autopilot tarefa=(audit|plan|post)(?: semana=(\d{2}\/\d{2}))?[^<]*?rótulo="([^"]*)"<\/caetano_ref>/;

const KINDS: ReadonlySet<string> = new Set(autopilotJobKinds);

const isKind = (value: string | undefined): value is WorkTaskKind =>
  value !== undefined && KINDS.has(value);

const textOf = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

/** The work a user-role message asks for, when it is a posts automáticos job. */
export const workTaskOf = (
  message: UIMessage,
): Pick<WorkTask, "kind" | "label" | "week"> | null => {
  if (message.role !== "user") return null;

  const match = WORK_REF.exec(textOf(message));
  const kind = match?.[1];

  if (!match || !isKind(kind)) return null;

  return { kind, week: match[2] ?? null, label: match[3] ?? "" };
};

const stateOf = (answered: boolean, running: boolean): WorkTaskState => {
  if (answered) return "done";

  return running ? "running" : "queued";
};

/**
 * Folds consecutive work turns into one item; an owner message ends the run.
 * A task is done once a reply follows its prompt, running while it is the
 * pending one of a busy thread, and queued otherwise.
 */
export const groupWork = (messages: readonly UIMessage[], busy: boolean): ChatItem[] => {
  const items: ChatItem[] = [];
  let entries: Entry[] = [];

  const close = () => {
    if (entries.length === 0) return;

    const prompts = entries.flatMap((entry, position) => {
      const task = workTaskOf(entry.message);

      return task ? [{ task, position, entry }] : [];
    });

    let pendingSeen = false;

    const tasks = prompts.map(({ task, position, entry }, order): WorkTask => {
      const end = prompts[order + 1]?.position ?? entries.length;

      const answered = entries
        .slice(position + 1, end)
        .some((item) => item.message.role === "assistant" && item.message.status !== "streaming");

      const running = !answered && busy && !pendingSeen;

      if (!answered) pendingSeen = true;

      return {
        key: entry.message.key,
        ...task,
        state: stateOf(answered, running),
      };
    });

    items.push({ kind: "work", key: `work-${entries[0]!.message.key}`, entries, tasks });
    entries = [];
  };

  messages.forEach((message, index) => {
    if (workTaskOf(message)) {
      entries.push({ message, index });

      return;
    }

    if (message.role !== "user" && entries.length > 0) {
      entries.push({ message, index });

      return;
    }

    close();
    items.push({ kind: "message", message, index });
  });

  close();

  return items;
};

const STATE_ICON = {
  done: Check,
  running: LoaderCircle,
  queued: Clock3,
} as const;

const STATE_CLASS = {
  done: "text-green",
  running: "animate-spin text-brand-accent",
  queued: "text-text-5",
} as const;

const STATE_LABEL = { done: "pronto", running: "trabalhando", queued: "na fila" } as const;

/** One folded run of work: what it was, how far it got, and the full turns on demand. */
export function WorkGroup({
  tasks,
  children,
}: {
  tasks: readonly WorkTask[];
  /** The turns themselves, rendered only when the block is open. */
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const weeks = [...new Set(tasks.flatMap((task) => (task.week ? [task.week] : [])))];

  return (
    <section className="grid gap-3 rounded-xl border border-border bg-surface/60 p-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left"
      >
        <CalendarClock className="size-4 shrink-0 text-text-4" aria-hidden="true" />
        <span className="shrink-0 text-note font-medium text-text-2">
          Trabalho do Caetano{weeks.length > 0 ? ` · semana ${weeks.join(" e ")}` : ""}
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {tasks.map((task) => {
            const Icon = STATE_ICON[task.state];

            return (
              <span
                key={task.key}
                className="inline-flex items-center gap-1 rounded-full bg-inset px-2 py-0.5 text-micro text-text-3"
              >
                <Icon
                  className={cn("size-3", STATE_CLASS[task.state])}
                  aria-label={STATE_LABEL[task.state]}
                />
                {task.label}
              </span>
            );
          })}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-text-4 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="grid gap-6 border-t border-border pt-3">{children()}</div> : null}
    </section>
  );
}

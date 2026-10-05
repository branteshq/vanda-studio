import { overviewOf } from "../../autopilotData";
import { renderAuditMarkdown, renderPlanMarkdown } from "../../autopilotText";
import type { WorkspaceMount } from "../types";

const FILES = {
  "plan.md": {
    summary: "programação do piloto automático: cadência e posts desta semana e da próxima",
    render: renderPlanMarkdown,
  },
  "audit.md": {
    summary: "diagnóstico mais recente da conta: nota do perfil, o que funciona, pare / faça mais",
    render: renderAuditMarkdown,
  },
} as const;

const isFileName = (name: string): name is keyof typeof FILES => Object.hasOwn(FILES, name);

/** The autopilot, read-only for the agents; changes go through the autopilot_* tools. */
export const autopilotMount: WorkspaceMount = {
  root: "autopilot",
  summary: "piloto automático de posts de feed: programação semanal e diagnóstico da conta",
  writeHint:
    "somente leitura; quando o dono pedir, mude posts com autopilot_update_slot / autopilot_skip_slot e a cadência com settings_set (autopilot.cadence)",
  list: (_ctx, _accountId, segments) =>
    Promise.resolve(
      segments.length === 0
        ? Object.entries(FILES).map(([name, file]) => ({
            name,
            kind: "file" as const,
            summary: file.summary,
          }))
        : null,
    ),
  read: async (ctx, accountId, segments) => {
    const [name, ...rest] = segments;

    if (!name || rest.length > 0 || !isFileName(name)) return null;

    return {
      kind: "text" as const,
      text: FILES[name].render(await overviewOf(ctx, accountId, Date.now())),
    };
  },
};

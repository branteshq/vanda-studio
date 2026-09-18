import { documentMount } from "../documents";
import type { WorkspaceMount } from "../types";

/**
 * /memory — concise durable preferences and facts, included at each turn within
 * a shared byte budget. Full working documents belong in discoverable /notes.
 * Legacy oversized memory is reported as partial, never silently truncated.
 */
export const memoryMount: WorkspaceMount = documentMount({
  root: "memory",
  summary:
    "memória automática compacta: fatos e preferências; detalhes longos em /notes (gravável)",
  extension: ".md",
});

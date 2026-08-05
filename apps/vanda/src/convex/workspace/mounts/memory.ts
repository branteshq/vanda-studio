import { documentMount } from "../documents";
import type { WorkspaceMount } from "../types";

/**
 * /memory — Vanda's durable per-account notes: preferences the owner states in
 * conversation ("nunca use essa cor"), plans, learnings. Free-write: the agent
 * curates its own memory. Not auto-injected into the system prompt — the agent
 * reads what it needs, which keeps a poisoned note inspectable and inert.
 */
export const memoryMount: WorkspaceMount = documentMount({
  root: "memory",
  summary: "suas notas duráveis: preferências do dono, planos, aprendizados (gravável)",
  extension: ".md",
});

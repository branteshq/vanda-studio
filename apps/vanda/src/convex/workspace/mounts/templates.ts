import { documentMount } from "../documents";
import type { WorkspaceMount } from "../types";

/**
 * /templates — reusable Python snippets for run_code (a proven watermark
 * routine, the brand's frame recipe). Free-write: the agent promotes its own
 * successful runs into templates and adapts them on the next job.
 */
export const templatesMount: WorkspaceMount = documentMount({
  root: "templates",
  summary: "trechos Python reutilizáveis para run_code (gravável)",
  extension: ".py",
});

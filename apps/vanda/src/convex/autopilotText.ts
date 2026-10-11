import type { AutopilotOverview, AutopilotSlotView, AutopilotWeekView } from "./autopilotData";
import { weekdayNames } from "./autopilotModel";
import {
  formatHour,
  formatScheduleText,
  slidesLabel,
  slotStatusLabels,
} from "./pipeline/autopilot";

/**
 * Text renderings of the autopilot for the agents: the /autopilot workspace
 * files and tool results. Slot ids are included so the tools can address them.
 */

const slotLine = (slot: AutopilotSlotView): string =>
  [
    `- ${weekdayNames[slot.weekday]} ${formatHour(slot.time)} · ${slot.type} · ${slidesLabel(slot.slideCount)}`,
    `${slot.purposeLabel} · ${slotStatusLabels[slot.status]}${slot.ownerEdited ? " · editado pelo dono" : ""}`,
    `"${slot.hook}" — ${slot.angle} (slotId: ${slot.slotId})`,
    slot.lastError ? `erro: ${slot.lastError}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

export const renderWeekMarkdown = (week: AutopilotWeekView): string =>
  [
    `## Semana de ${week.label}`,
    week.strategy ? `Estratégia: ${week.strategy}` : "",
    week.slots.length > 0 ? week.slots.map(slotLine).join("\n") : "(ainda não planejada)",
  ]
    .filter(Boolean)
    .join("\n");

export const renderPlanMarkdown = (overview: AutopilotOverview): string =>
  [
    "# Posts automáticos do Caetano — programação",
    `Estado: ${overview.enabled ? "ligado" : "desligado"}${overview.connected ? "" : " · Instagram não conectado"}`,
    `Cadência: ${overview.cadenceSummary} (${overview.cadenceSource === "owner" ? "definida pelo dono" : "sugerida pelo Caetano"})`,
    overview.cadence
      .map(
        (entry) =>
          `- ${weekdayNames[entry.weekday]} ${formatHour(entry.time)} · ${entry.type} · ${slidesLabel(entry.slideCount)}`,
      )
      .join("\n"),
    overview.cadenceRationale ? `Por quê: ${overview.cadenceRationale}` : "",
    `Aceite: ${overview.approval === "required" ? "cada post espera o aceite do dono (sem aceite até o horário, não publica)" : "publica sem aceite, podendo ser vetado"}`,
    "",
    ...overview.weeks.map(renderWeekMarkdown),
  ]
    .filter((line) => line !== "")
    .join("\n");

export const renderAuditMarkdown = (overview: AutopilotOverview): string => {
  const audit = overview.audit;

  if (!audit) {
    return overview.auditRunning
      ? "# Diagnóstico da conta\nEm andamento."
      : "# Diagnóstico da conta\nAinda não feito. Coloque o Caetano no controle dos posts automáticos ou peça para reanalisar.";
  }

  const metrics = audit.metrics;

  return [
    `# Diagnóstico da conta (${new Date(audit.createdAt).toISOString().slice(0, 10)})`,
    `Nota do perfil: ${audit.profileScore ?? "?"}/100 · confiança ${audit.confidence ?? "?"} · ${metrics?.sampleSize ?? 0} posts`,
    audit.summary ?? "",
    metrics
      ? `Mediana de alcance: ${metrics.medianReach ?? "?"} · salvos/alcance: ${metrics.savesPerReach ?? "?"} · envios/alcance: ${metrics.sharesPerReach ?? "?"} · posts/semana: ${metrics.postsPerWeek ?? "?"}`
      : "",
    audit.findings.length
      ? `## O que os dados dizem\n${audit.findings.map((finding) => `- ${finding.claim} (${finding.evidence}${finding.n ? `, n=${finding.n}` : ""})`).join("\n")}`
      : "",
    audit.stop.length ? `## Pare\n${audit.stop.map((item) => `- ${item}`).join("\n")}` : "",
    audit.doMore.length
      ? `## Faça mais\n${audit.doMore.map((item) => `- ${item}`).join("\n")}`
      : "",
    audit.needs.length
      ? `## Do que a conta precisa\n${audit.needs.map((item) => `- ${item}`).join("\n")}`
      : "",
    audit.rubric.length
      ? `## Perfil\n${audit.rubric.map((item) => `- ${item.item}: ${item.score}/${item.max}${item.fix ? ` — ${item.fix}` : ""}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

/** WhatsApp/plain text: the agency-style schedule for the current and next week. */
export const renderScheduleText = (overview: AutopilotOverview): string =>
  overview.weeks
    .filter((week) => week.slots.length > 0)
    .map((week) => formatScheduleText(week.slots, `Programação da semana de ${week.label}`))
    .join("\n\n") || `Sem posts planejados. Cadência: ${overview.cadenceSummary}.`;

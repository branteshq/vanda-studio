import { ORCHESTRATOR_MODELS, isTextModelAvailable } from "../agentModels";
import { CONECTADO_IMAGE_MODELS, IMAGE_MODELS } from "../imageModels";
import { THEMES } from "../../themes";
import { PRODUCE_AHEAD_LABEL } from "../autopilotModel";

/**
 * The platform settings the agents and the Perfil UI share. This file is pure
 * metadata (no Convex server imports) so the docs page can render it; reads and
 * writes live in ./registry.ts. Adding a Perfil control means adding an entry
 * here — the drift test in ./settings.test.ts fails otherwise.
 */

export interface SettingOption {
  readonly value: string;
  readonly label: string;
  readonly note?: string;
}

export interface OptionContext {
  /** ChatGPT plan with a live OpenAI connection: only Codex-capable models. */
  readonly conectado: boolean;
}

export interface SettingDefinition {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  readonly description: string;
  /** Where the owner finds it in the app, as shown in the UI. */
  readonly where: string;
  readonly route: string;
  /** "write": settings_set changes it. "read": `change` says who or what changes it. */
  readonly access: "write" | "read";
  readonly change?: string;
  readonly options?: (context: OptionContext) => readonly SettingOption[];
  /** Slug of the hand-written docs page that explains it; that page must mention `where`. */
  readonly doc: string;
  /** Public Convex functions the Perfil UI calls for this setting (drift guard). */
  readonly uiFunctions: readonly string[];
}

/**
 * Public functions the Perfil UI calls that are not settings: the brand file and
 * the visual kit. The drift test requires every other call to be claimed by a
 * setting above.
 */
export const NON_SETTING_UI_FUNCTIONS = [
  // The brand file is what Vanda knows, edited as a document, not a setting.
  "brandFile.get",
  "brandFile.save",
  // The visual kit shown beside it.
  "workspacePublic.file",
  // The Calendário's posts are content, not settings.
  "calendar.range",
  // Autopilot posts are content, not settings: the agents change them with autopilot_* tools.
  "autopilot.slot",
  "autopilot.retry",
  "autopilot.skipSlot",
  "autopilot.restoreSlot",
  "autopilot.approveSlot",
  "autopilot.regenerateSlot",
] as const;

const THEME_LABELS = { system: "Sistema", light: "Claro", dark: "Escuro" } as const;

const themeOptions = (): readonly SettingOption[] =>
  THEMES.map((theme) => ({ value: theme, label: THEME_LABELS[theme] }));

const textModelOptions = ({ conectado }: OptionContext): readonly SettingOption[] =>
  ORCHESTRATOR_MODELS.filter((model) => isTextModelAvailable(model, conectado)).map((model) => ({
    value: model.id,
    label: model.label,
    note: model.tagline,
  }));

const imageModelOptions = ({ conectado }: OptionContext): readonly SettingOption[] =>
  (conectado ? CONECTADO_IMAGE_MODELS : IMAGE_MODELS).map((model) => ({
    value: model.id,
    label: model.label,
    note: model.blurb,
  }));

export const SETTINGS = [
  {
    id: "models.vanda",
    group: "Modelos",
    title: "Modelo da Vanda",
    description:
      "Modelo de linguagem que pensa como a Vanda nas conversas do aplicativo. Vale a partir do próximo turno.",
    where: "Perfil › Avançado › Modelos",
    route: "/perfil",
    access: "write",
    options: textModelOptions,
    doc: "modelos",
    uiFunctions: ["users.modelPreferences", "users.setAgentModel"],
  },
  {
    id: "models.caetano",
    group: "Modelos",
    title: "Modelo do Caetano",
    description:
      "Modelo de linguagem do Caetano no WhatsApp, independente do modelo da Vanda. Vale a partir do próximo turno.",
    where: "Perfil › Avançado › Modelos",
    route: "/perfil",
    access: "write",
    options: textModelOptions,
    doc: "modelos",
    uiFunctions: ["users.setCaetanoModel"],
  },
  {
    id: "models.image",
    group: "Modelos",
    title: "Modelo de imagem",
    description:
      "Modelo padrão para gerar e editar imagens. No plano ChatGPT, as imagens rodam pela assinatura conectada.",
    where: "Perfil › Avançado › Modelos",
    route: "/perfil",
    access: "write",
    options: imageModelOptions,
    doc: "modelos",
    uiFunctions: ["users.setImageModel"],
  },
  {
    id: "appearance.theme",
    group: "Aparência",
    title: "Tema",
    description:
      "Tema claro ou escuro do aplicativo, ou o mesmo do dispositivo. Vale em todos os aparelhos do dono.",
    where: "Perfil › Avançado › Aparência",
    route: "/perfil",
    access: "write",
    options: themeOptions,
    doc: "visao-geral",
    uiFunctions: ["users.appearance", "users.setTheme"],
  },
  {
    id: "accounts.active",
    group: "Negócios",
    title: "Negócio ativo",
    description:
      "O negócio em que o trabalho acontece, e a lista de negócios do dono com o estado de cada um.",
    where: "Barra lateral › seletor de negócio",
    route: "/conversa",
    access: "read",
    change:
      "Use select_account para trocar de negócio. Novos negócios são criados pelo dono em Barra lateral › Adicionar negócio.",
    doc: "visao-geral",
    uiFunctions: [],
  },
  {
    id: "billing.plan",
    group: "Plano",
    title: "Plano e uso",
    description:
      "Plano atual, percentual da cota usada no período, renovação e mudança de plano agendada. A cota é compartilhada entre os negócios do dono.",
    where: "Perfil › Gerenciar plano",
    route: "/perfil",
    access: "read",
    change:
      "Só o dono muda de plano ou paga, em Perfil › Gerenciar plano. Envie esse caminho em vez de tentar mudar.",
    doc: "planos-e-uso",
    uiFunctions: [
      "usage.summary",
      "billing.autumn.syncBilling",
      "billing.autumn.startCheckout",
      "billing.autumn.previewPlanChange",
      "billing.autumn.changePlan",
      "billing.autumn.getBillingPortalUrl",
    ],
  },
  {
    id: "connections.instagram",
    group: "Conexões",
    title: "Instagram do negócio ativo",
    description:
      "Se o Instagram do negócio ativo está conectado para publicar e ler métricas, e com qual @.",
    where: "Perfil › Conexões",
    route: "/perfil",
    access: "read",
    change:
      "O dono conecta ou reconecta em Perfil › Conexões; a conexão passa pelo login do Instagram.",
    doc: "conexoes",
    uiFunctions: [
      "publisherConnect.connectionStatus",
      "publisherConnect.startConnect",
      "publisherConnect.syncConnection",
    ],
  },
  {
    id: "connections.openai",
    group: "Conexões",
    title: "Conta OpenAI (plano ChatGPT)",
    description:
      "Se a assinatura do ChatGPT do dono está conectada. No plano ChatGPT, conversas e imagens rodam por ela.",
    where: "Perfil › Conexões › Conta OpenAI",
    route: "/perfil",
    access: "read",
    change:
      "O dono assina o plano ChatGPT e conecta com o código exibido em Perfil › Conexões › Conta OpenAI.",
    doc: "conexoes",
    uiFunctions: [
      "openaiSub.connectionStatus",
      "openaiSub.startDeviceAuth",
      "openaiSub.pollDeviceAuth",
      "openaiSub.disconnect",
    ],
  },
  {
    id: "connections.whatsapp",
    group: "Conexões",
    title: "WhatsApp do Caetano",
    description: "Se o WhatsApp do dono está vinculado ao Caetano, e por qual número.",
    where: "Perfil › Conexões › Caetano no WhatsApp",
    route: "/perfil",
    access: "read",
    change:
      "O dono gera o vínculo em Perfil › Conexões › Caetano no WhatsApp e envia a mensagem pronta pelo próprio WhatsApp.",
    doc: "caetano-no-whatsapp",
    uiFunctions: ["whatsappData.state", "whatsapp.createLink", "whatsappData.disconnect"],
  },
  {
    id: "autopilot.enabled",
    group: "Posts automáticos",
    title: "Posts automáticos do Caetano",
    description: `Liga ou pausa os posts automáticos de feed do negócio ativo: o Caetano analisa a conta, planeja a semana, cria cada post cerca de ${PRODUCE_AHEAD_LABEL} antes e publica com o aceite do dono (ou sozinho, se o aceite estiver desligado). Pausar suspende as publicações pendentes; ligar de novo as retoma.`,
    where: "Calendário › Posts automáticos",
    route: "/calendario",
    access: "write",
    options: (): readonly SettingOption[] => [
      { value: "ligado", label: "Ligado" },
      { value: "desligado", label: "Desligado" },
    ],
    doc: "posts-automaticos",
    uiFunctions: ["autopilot.setEnabled"],
  },
  {
    id: "autopilot.approval",
    group: "Posts automáticos",
    title: "Aceite antes de publicar",
    description:
      'Se os posts que o Caetano gera esperam o aceite do dono antes de publicar ("pedir aceite", o padrão: sem aceite até o horário, não publica) ou publicam sozinhos podendo ser vetados ("publicar sem aceite"). Recusar exige um motivo, que ensina o Caetano.',
    where: "Calendário › Posts automáticos",
    route: "/calendario",
    access: "write",
    options: (): readonly SettingOption[] => [
      { value: "pedir aceite", label: "Pedir aceite" },
      { value: "publicar sem aceite", label: "Publicar sem aceite" },
    ],
    doc: "posts-automaticos",
    uiFunctions: ["autopilot.setApproval"],
  },
  {
    id: "autopilot.cadence",
    group: "Posts automáticos",
    title: "Cadência dos posts automáticos",
    description:
      'Dias, horários (Brasília), formato e slides dos posts automáticos da semana. Para mudar, escreva um post por item separado por ";": "ter 18h carrossel 2; qui 18h imagem; sab 12h carrossel 3". O valor "caetano" devolve a cadência à sugestão do diagnóstico. Os posts ainda não gerados são replanejados.',
    where: "Calendário › Posts automáticos",
    route: "/calendario",
    access: "write",
    doc: "posts-automaticos",
    uiFunctions: ["autopilot.overview"],
  },
] as const satisfies readonly SettingDefinition[];

export type SettingId = (typeof SETTINGS)[number]["id"];

export const findSetting = (id: string): SettingDefinition | undefined =>
  SETTINGS.find((setting) => setting.id === id);

const normalizeOption = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Match an option by id or by its label, ignoring case, accents and punctuation ("gpt 6.1 sol"). */
export const resolveOption = (
  value: string,
  options: readonly SettingOption[],
): SettingOption | undefined => {
  const wanted = normalizeOption(value);

  return (
    options.find((option) => option.value === value) ??
    options.find(
      (option) =>
        normalizeOption(option.label) === wanted || normalizeOption(option.value) === wanted,
    )
  );
};

/** The settings reference page, generated so it can never drift from the registry. */
export function renderSettingsReference(): string {
  const lines = [
    "# Configurações da plataforma",
    "",
    "Todas as configurações da plataforma. A Vanda e o Caetano consultam estes valores quando você pergunta e mudam os alteráveis quando você pede, pelo mesmo caminho do Perfil.",
  ];

  for (const group of new Set(SETTINGS.map((setting) => setting.group))) {
    lines.push("", `## ${group}`);

    for (const setting of SETTINGS.filter((candidate) => candidate.group === group)) {
      lines.push(
        "",
        `### ${setting.title}`,
        "",
        setting.description,
        "",
        `- Onde fica: ${setting.where}`,
        `- Identificador: \`${setting.id}\``,
        setting.access === "write"
          ? "- A Vanda e o Caetano podem alterar quando o dono pedir."
          : `- Somente leitura para os agentes. ${"change" in setting ? setting.change : ""}`.trim(),
      );

      if ("options" in setting) {
        lines.push("- Opções:");

        for (const option of setting.options({ conectado: false }))
          lines.push(`  - ${option.label}${option.note ? ` — ${option.note}` : ""}`);
      }
    }
  }

  return lines.join("\n");
}

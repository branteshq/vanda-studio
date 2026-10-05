import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireTextModel, resolveCaetanoModel, resolveOrchestratorModel } from "../agentModels";
import { applyCadence, applyEnabled, applyResetCadence, getConfig } from "../autopilotData";
import { DEFAULT_CADENCE, cadenceSummary, parseCadenceText } from "../pipeline/autopilot";
import { planLabel } from "../billing/plans";
import {
  DEFAULT_IMAGE_MODEL,
  isConnectedImageModel,
  isKnownImageModel,
  resolveConnectedImageModel,
} from "../imageModels";
import { isConnectedSubscriber } from "../openaiSub";
import { budgetOf } from "../usage";
import { activeConnection } from "../whatsappData";
import { DEFAULT_THEME, isTheme } from "../../themes";
import {
  SETTINGS,
  findSetting,
  resolveOption,
  type SettingDefinition,
  type SettingId,
  type SettingOption,
} from "./catalog";

type SettingValue = string | number | boolean | null | SettingValue[] | SettingObject;

type SettingObject = { [key: string]: SettingValue };

type Reader = (ctx: QueryCtx, user: Doc<"users">) => Promise<SettingValue>;

type Writer = (ctx: MutationCtx, user: Doc<"users">, value: string) => Promise<void>;

/** Resolved model ids, exactly what the next turn runs on. */
export const modelPreferencesOf = (user: Doc<"users">) => {
  const conectado = isConnectedSubscriber(user);

  return {
    orchestrator: resolveOrchestratorModel(user.orchestratorModel, { conectado }),
    caetano: resolveCaetanoModel(user.caetanoModel, { conectado }),
    image: conectado
      ? resolveConnectedImageModel(user.imageModel)
      : user.imageModel && isKnownImageModel(user.imageModel)
        ? user.imageModel
        : DEFAULT_IMAGE_MODEL,
    conectado,
  };
};

// Owners and agents may name a model by its label ("GPT-6.1 Sol"); validation
// below still decides whether the transport can run it.
const textModelId = (value: string): string =>
  resolveOption(value, optionsOf("models.vanda", false))?.value ?? value;

const imageModelId = (value: string): string =>
  resolveOption(value, optionsOf("models.image", false))?.value ?? value;

const writeTextModel =
  (field: "orchestratorModel" | "caetanoModel"): Writer =>
  async (ctx, user, value) => {
    const model = requireTextModel(textModelId(value), isConnectedSubscriber(user));

    await ctx.db.patch(user._id, { [field]: model.id, updatedAt: Date.now() });
  };

const readers = {
  "models.vanda": (_ctx, user) => Promise.resolve(modelPreferencesOf(user).orchestrator),
  "models.caetano": (_ctx, user) => Promise.resolve(modelPreferencesOf(user).caetano),
  "models.image": (_ctx, user) => Promise.resolve(modelPreferencesOf(user).image),
  "appearance.theme": (_ctx, user) => Promise.resolve(user.theme ?? DEFAULT_THEME),
  "accounts.active": async (ctx, user) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .collect();

    return {
      activeAccountId: user.activeAccountId ?? null,
      accounts: accounts.map((account) => ({
        accountId: account._id,
        name: account.name ?? account.handle ?? "Novo negócio",
        active: account._id === user.activeAccountId,
        onboarded: account.onboardedAt !== undefined,
        instagramConnected: account.publisherConnectedAt !== undefined,
      })),
    };
  },
  "billing.plan": async (ctx, user) => {
    const budget = await budgetOf(ctx, user);

    return {
      plan: planLabel(user.planId ?? null),
      planId: user.planId ?? "trial",
      usedPct:
        budget.allowanceMicroUsd > 0
          ? Math.min(100, Math.round((budget.spentMicroUsd / budget.allowanceMicroUsd) * 100))
          : 100,
      limited: !budget.ok,
      renewsAt: user.billingPeriodEnd ? new Date(user.billingPeriodEnd).toISOString() : null,
      scheduledPlan: user.scheduledPlanId ? planLabel(user.scheduledPlanId) : null,
    };
  },
  "connections.instagram": async (ctx, user) => {
    const account = user.activeAccountId ? await ctx.db.get(user.activeAccountId) : null;

    if (!account || account.ownerUserId !== user._id) return { account: null, connected: false };

    return {
      account: account.name ?? account.handle ?? "Novo negócio",
      connected: account.publisherConnectedAt !== undefined,
      handle: account.handle ? `@${account.handle}` : null,
    };
  },
  "connections.openai": (_ctx, user) =>
    Promise.resolve({
      connected: user.openaiAccessCiphertext !== undefined,
      activeForInference: isConnectedSubscriber(user),
    }),
  "connections.whatsapp": async (ctx, user) => {
    const connection = await activeConnection(ctx, user._id);

    return { linked: !!connection, phone: connection?.phone ? `+${connection.phone}` : null };
  },
  "autopilot.enabled": async (ctx, user) => {
    const account = await ownedActiveAccount(ctx, user);

    if (!account) return { account: null, enabled: false };

    return {
      account: account.name ?? account.handle ?? "Novo negócio",
      enabled: (await getConfig(ctx, account._id))?.enabled ?? false,
    };
  },
  "autopilot.cadence": async (ctx, user) => {
    const account = await ownedActiveAccount(ctx, user);
    const config = account ? await getConfig(ctx, account._id) : null;
    const cadence = config?.cadence ?? [...DEFAULT_CADENCE];

    return {
      summary: cadenceSummary(cadence),
      source: config?.cadenceSource === "owner" ? "definida pelo dono" : "sugerida pela Vanda",
      entries: cadence.map((entry) => ({ ...entry })),
    };
  },
} satisfies Record<SettingId, Reader>;

const ownedActiveAccount = async (ctx: QueryCtx, user: Doc<"users">) => {
  const account = user.activeAccountId ? await ctx.db.get(user.activeAccountId) : null;

  return account && account.ownerUserId === user._id ? account : null;
};

const ON_VALUES = new Set(["ligado", "true", "on", "sim", "ligar"]);

const OFF_VALUES = new Set(["desligado", "false", "off", "não", "nao", "desligar"]);

const AGENT_CADENCE_VALUES = new Set(["vanda", "sugestão", "sugestao", "sugerida", "agente"]);

const writers: Partial<Record<SettingId, Writer>> = {
  "appearance.theme": async (ctx, user, value) => {
    const theme = resolveOption(value, optionsOf("appearance.theme", false))?.value;

    if (!isTheme(theme)) throw new Error("tema desconhecido: use Sistema, Claro ou Escuro");

    await ctx.db.patch(user._id, { theme, updatedAt: Date.now() });
  },
  "autopilot.enabled": async (ctx, user, value) => {
    const normalized = value.trim().toLowerCase();

    if (!ON_VALUES.has(normalized) && !OFF_VALUES.has(normalized))
      throw new Error("use ligado ou desligado");

    const account = await ownedActiveAccount(ctx, user);

    if (!account) throw new Error("nenhum negócio ativo");

    await applyEnabled(ctx, account._id, ON_VALUES.has(normalized));
  },
  "autopilot.cadence": async (ctx, user, value) => {
    const account = await ownedActiveAccount(ctx, user);

    if (!account) throw new Error("nenhum negócio ativo");

    // "Vanda" hands the cadence back to the diagnosis.
    if (AGENT_CADENCE_VALUES.has(value.trim().toLowerCase())) {
      await applyResetCadence(ctx, account._id);

      return;
    }

    await applyCadence(ctx, account._id, parseCadenceText(value));
  },
  "models.vanda": writeTextModel("orchestratorModel"),
  "models.caetano": writeTextModel("caetanoModel"),
  "models.image": async (ctx, user, value) => {
    const modelId = imageModelId(value);

    if (!isKnownImageModel(modelId)) throw new Error("modelo de imagem desconhecido");

    if (isConnectedSubscriber(user) && !isConnectedImageModel(modelId))
      throw new Error("modelo indisponível pela assinatura do ChatGPT");

    await ctx.db.patch(user._id, { imageModel: modelId, updatedAt: Date.now() });
  },
};

const optionsOf = (id: SettingId, conectado: boolean): readonly SettingOption[] => {
  const setting: SettingDefinition | undefined = findSetting(id);

  return setting?.options?.({ conectado }) ?? [];
};

const requireSetting = (id: string): SettingDefinition & { id: SettingId } => {
  const setting = SETTINGS.find((candidate) => candidate.id === id);

  if (!setting)
    throw new Error(
      `configuração desconhecida: ${id}. Disponíveis: ${SETTINGS.map((s) => s.id).join(", ")}`,
    );

  return setting;
};

/** Option values show by their label ("GPT-6.1 Sol"); other values pass through. */
const labelOf = (id: SettingId, value: SettingValue, conectado: boolean): SettingValue =>
  optionsOf(id, conectado).find((option) => option.value === value)?.label ?? value;

/** Every setting's current value in one compact object: the on-demand snapshot. */
export async function readAllSettings(ctx: QueryCtx, user: Doc<"users">) {
  const conectado = isConnectedSubscriber(user);

  return Promise.all(
    SETTINGS.map(async (setting) => ({
      id: setting.id,
      title: setting.title,
      value: labelOf(setting.id, await readers[setting.id](ctx, user), conectado),
      access: setting.access,
    })),
  );
}

/** One setting with everything needed to explain or change it. */
export async function describeSetting(ctx: QueryCtx, user: Doc<"users">, id: string) {
  const setting = requireSetting(id);
  const conectado = isConnectedSubscriber(user);
  const value = await readers[setting.id](ctx, user);

  const detail: SettingDetail = {
    id: setting.id,
    title: setting.title,
    description: setting.description,
    where: setting.where,
    route: setting.route,
    access: setting.access,
    value,
    label: labelOf(setting.id, value, conectado),
    docs: `/docs/${setting.doc}`,
  };

  if (setting.change) detail.change = setting.change;

  if (setting.options) detail.options = setting.options({ conectado });

  return detail;
}

interface SettingDetail {
  id: SettingId;
  title: string;
  description: string;
  where: string;
  route: string;
  access: "write" | "read";
  value: SettingValue;
  label: SettingValue;
  docs: string;
  change?: string;
  options?: readonly SettingOption[];
}

/**
 * The single write path for settings: the Perfil mutations and the agents'
 * settings_set both land here. Returns the previous value so a change can be undone.
 */
export async function writeSetting(
  ctx: MutationCtx,
  user: Doc<"users">,
  id: string,
  value: string,
): Promise<{ id: SettingId; previous: SettingValue; value: SettingValue; label: SettingValue }> {
  const setting = requireSetting(id);
  const write = writers[setting.id];

  if (setting.access !== "write" || !write) {
    throw new Error(
      `${setting.title} não pode ser alterado pelos agentes. ${"change" in setting ? setting.change : ""}`.trim(),
    );
  }

  const previous = await readers[setting.id](ctx, user);
  await write(ctx, user, value);
  const updated = await ctx.db.get(user._id);

  if (!updated) throw new Error("user not found");
  const current = await readers[setting.id](ctx, updated);

  return {
    id: setting.id,
    previous,
    value: current,
    label: labelOf(setting.id, current, isConnectedSubscriber(updated)),
  };
}

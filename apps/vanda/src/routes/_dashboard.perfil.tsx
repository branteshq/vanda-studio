import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { z } from "zod";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  CreditCard,
  ExternalLink,
  FileCode2,
  LogOut,
  NotebookPen,
  Palette,
  Plug,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@vanda-studio/ui/components/avatar";
import { Button } from "@vanda-studio/ui/components/button";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import {
  AnthropicIcon,
  FluxIcon,
  GeminiIcon,
  MetaIcon,
  OpenAiIcon,
} from "@vanda-studio/ui/components/model-marks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vanda-studio/ui/components/select";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  DEFAULT_CAETANO_MODEL,
  DEFAULT_ORCHESTRATOR_MODEL,
  ORCHESTRATOR_MODELS,
  isTextModelAvailable,
  type ModelMaker,
} from "../convex/agentModels";
import {
  resolveConnectedImageModel,
  CONECTADO_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  type ImageModel,
} from "../convex/imageModels";
import { PLAN_TIERS, planLabel, tierOfPlan } from "../convex/billing/plans";
import { parseBrandKit } from "../convex/workspace/brandKit";
import { useActiveAccount } from "../components/active-account";
import { WhatsAppSettings } from "../components/whatsapp-settings";
import { errorMessage } from "../errors";

export const Route = createFileRoute("/_dashboard/perfil")({
  component: ProfilePage,
});

const profileHooks = {
  useUsageSummary: () => useQuery(api.usage.summary),
  useSyncBilling: () => useAction(api.billing.autumn.syncBilling),
  useBillingActions: () => ({
    startCheckout: useAction(api.billing.autumn.startCheckout),
    previewPlanChange: useAction(api.billing.autumn.previewPlanChange),
    changePlan: useAction(api.billing.autumn.changePlan),
    getPortalUrl: useAction(api.billing.autumn.getBillingPortalUrl),
  }),
  useModelPreferences: () => {
    const setAgentModel = useMutation(api.users.setAgentModel);
    const setCaetanoModel = useMutation(api.users.setCaetanoModel);
    const setImageModel = useMutation(api.users.setImageModel);

    return {
      preferences: useQuery(api.users.modelPreferences),
      setAgentModel: (args: { modelId: string }) => setAgentModel(args),
      setCaetanoModel: (args: { modelId: string }) => setCaetanoModel(args),
      setImageModel: (args: { modelId: string }) => setImageModel(args),
    };
  },
  usePublisherConnection: (accountId: Id<"accounts">) => ({
    status: useQuery(api.publisherConnect.connectionStatus, { accountId }),
    startConnect: useAction(api.publisherConnect.startConnect),
    syncConnection: useAction(api.publisherConnect.syncConnection),
  }),
  useOpenAiConnection: () => {
    const disconnect = useMutation(api.openaiSub.disconnect);

    return {
      status: useQuery(api.openaiSub.connectionStatus),
      startDeviceAuth: useAction(api.openaiSub.startDeviceAuth),
      pollDeviceAuth: useAction(api.openaiSub.pollDeviceAuth),
      disconnect: () => disconnect(),
    };
  },
  useInstalledSkills: (accountId: Id<"accounts">) =>
    useQuery(api.workspacePublic.installedSkills, { accountId }),
  useWorkspaceFile: (accountId: Id<"accounts">, path: string, skip: boolean) =>
    useQuery(api.workspacePublic.file, skip ? "skip" : { accountId, path }),
  useWorkspaceBrowse: (accountId: Id<"accounts">, path: string) =>
    useQuery(api.workspacePublic.browse, { accountId, path }),
};

type ProfileRuntime = typeof profileHooks & {
  useProfileUser: () => {
    user:
      | (Pick<NonNullable<ReturnType<typeof useUser>["user"]>, "firstName" | "fullName"> &
          Partial<
            Pick<
              NonNullable<ReturnType<typeof useUser>["user"]>,
              "username" | "imageUrl" | "primaryEmailAddress"
            >
          >)
      | null
      | undefined;
  };
  useClerkActions: () => Pick<ReturnType<typeof useClerk>, "signOut" | "openUserProfile">;
  useProfileNavigate: () => ReturnType<typeof useNavigate>;
  useProfileAccounts: () => {
    accounts:
      | Array<
          Pick<
            NonNullable<ReturnType<typeof useActiveAccount>["accounts"]>[number],
            "id" | "name" | "onboardedAt"
          >
        >
      | undefined;
    activeAccount:
      | Pick<
          NonNullable<ReturnType<typeof useActiveAccount>["activeAccount"]>,
          "id" | "name" | "onboardedAt"
        >
      | undefined;
    selectAccount: (accountId: Id<"accounts">) => void;
  };
  WhatsAppSettings: ComponentType;
};

const defaultRuntime: ProfileRuntime = {
  ...profileHooks,
  useProfileUser: useUser,
  useClerkActions: useClerk,
  useProfileNavigate: useNavigate,
  useProfileAccounts: useActiveAccount,
  WhatsAppSettings,
};

const ProfileRuntimeContext = createContext(defaultRuntime);

/**
 * The owner-facing window into what Vanda knows: brand memory, durable notes
 * and reusable templates — per business, with a switcher. Renders full-bleed
 * (the dashboard layout skips the sidebar chrome for this route).
 */

type TabKey =
  | "inicio"
  | "plano"
  | "modelos"
  | "conexoes"
  | "instagram"
  | "marca"
  | "memoria"
  | "templates"
  | "skills";

const TABS = [
  {
    key: "inicio",
    label: "Conta",
    icon: UserRound,
    description: "Seu perfil e sua assinatura.",
  },
  {
    key: "plano",
    label: "Plano e uso",
    icon: CreditCard,
    description: "Acompanhe seu uso e gerencie sua assinatura.",
  },
  {
    key: "modelos",
    label: "Modelos",
    icon: SlidersHorizontal,
    description: "Defina os modelos usados nas conversas e na criação de imagens.",
  },
  {
    key: "conexoes",
    label: "Conexões",
    icon: Plug,
    description: "Contas e ferramentas conectadas ao seu perfil pessoal.",
  },
  {
    key: "marca",
    label: "Marca",
    icon: Palette,
    description: "Identidade visual e informações que a Vanda usa neste negócio.",
  },
  {
    key: "memoria",
    label: "Memória",
    icon: NotebookPen,
    description: "Preferências e instruções salvas para este negócio.",
  },
  {
    key: "templates",
    label: "Templates",
    icon: FileCode2,
    description: "Códigos de edição salvos para reutilizar nas próximas criações.",
  },
  {
    key: "skills",
    label: "Skills",
    icon: Sparkles,
    description: "Habilidades especializadas para o seu negócio.",
  },
  {
    key: "instagram",
    label: "Conexões",
    icon: Plug,
    description: "Conecte o Instagram para publicar por este negócio.",
  },
] satisfies Array<{ key: TabKey; label: string; icon: typeof UserRound; description: string }>;

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function planBadge(tier: string): string | undefined {
  if (tier === "profissional") return "Mais popular";

  if (tier === "conectado") return "Traga sua assinatura";

  return undefined;
}

export function ProfilePage({ runtime = defaultRuntime }: { runtime?: ProfileRuntime }) {
  return (
    <ProfileRuntimeContext.Provider value={runtime}>
      <ProfilePageContent />
    </ProfileRuntimeContext.Provider>
  );
}

function ProfilePageContent() {
  const runtime = useContext(ProfileRuntimeContext);
  const { user } = runtime.useProfileUser();
  const clerk = runtime.useClerkActions();
  const navigate = runtime.useProfileNavigate();
  const { accounts, selectAccount } = runtime.useProfileAccounts();
  const ready = accounts?.filter((account) => account.onboardedAt !== null) ?? [];
  const [viewedId, setViewedId] = useState<Id<"accounts"> | null>(null);
  const viewed = ready.find((account) => account.id === viewedId);
  const [personalTab, setPersonalTab] = useState<TabKey>("inicio");
  const [businessTab, setBusinessTab] = useState<TabKey>("marca");
  const businessSection = viewed !== undefined;
  const tab = businessSection ? businessTab : personalTab;
  const setTab = businessSection ? setBusinessTab : setPersonalTab;
  const section = TABS.find((item) => item.key === tab)!;
  const summary = runtime.useUsageSummary();
  const syncBilling = runtime.useSyncBilling();

  // Checkout returns here, even when the plan section isn't open.
  useEffect(() => {
    void syncBilling().catch(() => {});
  }, [syncBilling]);

  const name = user?.fullName ?? user?.username ?? "Minha conta";
  const personalLabel = user?.firstName?.trim() || "Minha conta";
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const handleSignOut = async () => {
    await clerk.signOut();
    // /login is a splat route (login.$.tsx — Clerk owns its sub-paths), so the
    // typed target is the splat with an empty remainder.
    await navigate({ to: "/login/$", params: { _splat: "" } });
  };

  return (
    <div className="min-h-svh bg-app text-text">
      <header className="sticky top-0 z-20 grid h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-border bg-surface md:grid-cols-[224px_minmax(0,1fr)]">
        <div className="px-2 md:px-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-text-3"
            aria-label="Voltar à Vanda"
            onClick={() => void navigate({ to: "/conversa", search: {} })}
          >
            <ArrowLeft />
            <span className="hidden md:inline">Voltar à Vanda</span>
          </Button>
        </div>
        <div
          aria-label="Escopo das configurações"
          role="group"
          className="flex h-full min-w-0 items-stretch gap-1 overflow-x-auto px-2 md:px-6"
        >
          {[
            { id: null, label: personalLabel },
            ...ready.map((account) => ({ id: account.id, label: account.name })),
          ].map(({ id, label }) => (
            <button
              key={id ?? "personal"}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={id === (viewed?.id ?? null)}
              onClick={() => setViewedId(id)}
              className={cn(
                "flex max-w-48 shrink-0 items-center gap-2 border-b-2 px-3 text-body-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                id === (viewed?.id ?? null)
                  ? "border-brand-accent font-medium text-text"
                  : "border-transparent text-text-3 hover:bg-muted hover:text-text",
              )}
            >
              {id === null ? (
                <Avatar className="size-5">
                  <AvatarImage src={user?.imageUrl} alt="" />
                  <AvatarFallback className="text-[9px]">{getInitials(name)}</AvatarFallback>
                </Avatar>
              ) : (
                <Building2 className="size-4" />
              )}
              <span className="truncate">{label}</span>
            </button>
          ))}
          {accounts === undefined ? <Skeleton className="my-auto h-5 w-28 shrink-0" /> : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="justify-self-end text-text-3 md:hidden"
          aria-label="Sair da conta"
          onClick={() => void handleSignOut()}
        >
          <LogOut />
        </Button>
      </header>
      <div className="md:grid md:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-sidebar md:sticky md:top-12 md:flex md:h-[calc(100svh-3rem)] md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
          <nav
            aria-label="Perfil e configurações"
            className="flex gap-1 overflow-x-auto p-3 md:flex-col"
          >
            {(businessSection ? TABS.slice(4) : TABS.slice(0, 4)).map(
              ({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-current={tab === key ? "page" : undefined}
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex min-h-10 shrink-0 items-center gap-2.5 rounded-md border px-3 text-body-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring md:w-full",
                    tab === key
                      ? "border-border-strong bg-surface font-medium text-text"
                      : "border-transparent text-text-3 hover:bg-surface hover:text-text",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{label}</span>
                </button>
              ),
            )}
          </nav>
          <div className="mt-auto hidden p-4 md:block">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-text-3"
              onClick={() => void handleSignOut()}
            >
              <LogOut />
              Sair da conta
            </Button>
          </div>
        </aside>
        <main className="min-w-0 p-4 sm:p-6 lg:p-8">
          {tab === "inicio" ? (
            <div className="space-y-6">
              <h1 className="sr-only">Conta</h1>
              <section className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
                  <h2 className="text-body font-semibold">Perfil</h2>
                  <Button variant="outline" size="sm" onClick={() => clerk.openUserProfile()}>
                    Editar perfil
                  </Button>
                </div>
                <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
                  <Avatar className="size-16 shrink-0">
                    <AvatarImage src={user?.imageUrl} alt={name} />
                    <AvatarFallback className="text-lg">{getInitials(name) || "MC"}</AvatarFallback>
                  </Avatar>
                  <dl className="grid min-w-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10">
                    <div>
                      <dt className="text-xs font-medium text-text-3">Nome</dt>
                      <dd className="mt-1.5 break-words text-body">{name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-text-3">E-mail</dt>
                      <dd className="mt-1.5 break-all text-body">{email ?? "Não informado"}</dd>
                    </div>
                  </dl>
                </div>
              </section>
              <UsageCard
                action={
                  <Button size="sm" variant="outline" onClick={() => setPersonalTab("plano")}>
                    Gerenciar plano
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="mb-6">
              <h1 className="text-xl font-semibold tracking-tight">{section.label}</h1>
              <p className="mt-1.5 text-body-sm leading-relaxed text-text-3">
                {section.description}
              </p>
            </div>
          )}
          {tab === "plano" ? (
            <div className="space-y-8">
              <UsageCard />
              <AccountTab />
            </div>
          ) : null}
          {tab === "modelos" ? <ModelsCard /> : null}
          {tab === "conexoes" ? (
            <div className="space-y-4">
              <runtime.WhatsAppSettings />
              {summary?.plan && tierOfPlan(summary.plan) === "conectado" ? (
                <OpenAiConnectCard />
              ) : null}
            </div>
          ) : null}
          {viewed && businessSection ? (
            // Keyed by account so file selections reset when switching business.
            <div key={viewed.id} className="space-y-6">
              {tab === "marca" ? <BrandTab accountId={viewed.id} /> : null}
              {tab === "memoria" ? (
                <FolderTab
                  accountId={viewed.id}
                  folder="/memory"
                  format="markdown"
                  emptyIcon={NotebookPen}
                  emptyTitle="Nenhuma nota ainda"
                  emptyBody={`As notas duráveis da Vanda sobre este negócio moram aqui. Diga na conversa algo como "nunca use vermelho nas artes" — ela grava, e o que está gravado ela não esquece.`}
                />
              ) : null}
              {tab === "templates" ? (
                <FolderTab
                  accountId={viewed.id}
                  folder="/templates"
                  format="code"
                  emptyIcon={FileCode2}
                  emptyTitle="Nenhum template ainda"
                  emptyBody={`Códigos de edição de imagem que deram certo podem virar templates reutilizáveis. Peça na conversa: "salve esse código como template" — ele aparece aqui.`}
                />
              ) : null}
              {tab === "skills" ? <SkillsTab accountId={viewed.id} /> : null}
              {tab === "instagram" ? (
                <InstagramConnectCard accountId={viewed.id} name={viewed.name} />
              ) : null}
            </div>
          ) : null}
          {businessSection && viewed && tab !== "instagram" ? (
            <Button
              variant="ghost"
              className="mt-6 text-text-3"
              onClick={() => {
                if (viewed) selectAccount(viewed.id);
                void navigate({ to: "/conversa", search: {} });
              }}
            >
              Ajuste com a Vanda na conversa
              <ChevronRight />
            </Button>
          ) : null}
        </main>
      </div>
    </div>
  );
}

/**
 * The shared usage summary: the plan name and the bar —
 * the owner only ever sees a percentage, never the underlying money.
 */
function UsageCard({ action }: { action?: ReactNode }) {
  const summary = useContext(ProfileRuntimeContext).useUsageSummary();
  const pct = summary?.usedPct ?? 0;

  return (
    <section
      aria-label="Uso do plano"
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-body font-semibold">Plano</h2>
          {summary === undefined ? (
            <Skeleton className="mt-2 h-4 w-36" />
          ) : (
            <p className="mt-1 text-body-sm text-text-3">{planLabel(summary?.plan ?? null)}</p>
          )}
        </div>
        {action}
      </div>
      <div className="p-5 sm:p-6">
        {summary === undefined ? (
          <div className="space-y-4" role="status" aria-label="Carregando uso do plano">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : summary?.plan && tierOfPlan(summary.plan) === "conectado" ? (
          // Conectado: inference rides the owner's ChatGPT — no bar to show.
          <>
            <p className="text-body font-medium">Uso pela sua assinatura do ChatGPT</p>
            <p className="mt-2 text-body-sm text-text-3">
              Conversas e imagens usam os limites da sua conta OpenAI.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-medium tracking-tight tabular-nums">{pct}%</span>
              <span className="text-body-sm text-text-3">utilizado</span>
            </div>
            <div
              className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Uso do plano"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300 ease-[var(--ease-out)]",
                  summary?.limited ? "bg-destructive" : "bg-brand-accent",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-3 text-body-sm leading-relaxed text-text-3">
              {summary?.limited
                ? summary.chatLimited
                  ? "Limite atingido. Mude de plano ou aguarde a renovação."
                  : "Limite dos serviços pagos pela Vanda atingido. Conversa e imagens pela sua assinatura do ChatGPT continuam disponíveis."
                : summary?.renewsAt
                  ? `Renova em ${new Date(summary.renewsAt).toLocaleDateString("pt-BR")}`
                  : "Crédito de teste — assine para renovar todo mês."}
            </p>
          </>
        )}
      </div>
      <p className="border-t border-border px-5 py-3 text-xs text-text-4 sm:px-6">
        O plano é compartilhado entre seus negócios.
      </p>
    </section>
  );
}

const TIER_FEATURES = {
  trial: [
    "Crédito único para experimentar tudo",
    "Todos os recursos incluídos",
    "Sem cartão de crédito",
  ],
  basico: [
    "Limite mensal de uso completo",
    "Radar de mercado diário",
    "Carrosséis, imagens e edições com IA",
  ],
  profissional: [
    "Tudo do Básico",
    "50% mais limite de uso por mês",
    "Para quem publica com frequência",
  ],
  conectado: [
    "Conecte sua assinatura do ChatGPT",
    "Texto e imagens pelo seu plano OpenAI",
    "GPT Image 2.5 — pela sua assinatura",
  ],
} satisfies Record<string, string[]>;

/**
 * Plan comparison and billing controls. Checkout and portal ride Autumn;
 * the page refreshes the enforcement snapshot on arrival from checkout.
 */
function AccountTab() {
  const runtime = useContext(ProfileRuntimeContext);
  const summary = runtime.useUsageSummary();
  const syncBilling = runtime.useSyncBilling();

  const { startCheckout, previewPlanChange, changePlan, getPortalUrl } =
    runtime.useBillingActions();

  const [schedule, setSchedule] = useState<"immediate" | "end_of_cycle">("immediate");

  const [preview, setPreview] = useState<{
    planId: string;
    currentPlanId: string;
    scheduledPlanId: string | null;
    total: number;
    currency: string;
    effectiveAt: number | null;
    schedule: "immediate" | "end_of_cycle";
  } | null>(null);

  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentTier = summary?.plan ? tierOfPlan(summary.plan) : null;

  const subscribe = async (planId: string) => {
    setBusy(planId);
    setError(null);

    try {
      if (summary?.plan) {
        const result = await previewPlanChange({ planId, schedule });
        setPreview({ ...result, planId, schedule });

        return;
      }

      const { checkoutUrl, attached } = await startCheckout({ planId });

      if (checkoutUrl) {
        window.location.href = checkoutUrl;

        return;
      }

      // The purchase completed without a payment page — refresh the snapshot
      // so the cards and the usage bar flip to the new plan reactively.
      if (attached) await syncBilling();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const confirmChange = async () => {
    if (!preview) return;
    setBusy(preview.planId);
    setError(null);

    try {
      const { effectiveAt: _, ...input } = preview;
      const result = await changePlan(input);
      setPreview(null);

      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      else await syncBilling();
    } catch (cause) {
      setPreview(null);
      setError(errorMessage(cause));
      await syncBilling().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const manage = async () => {
    setBusy("portal");
    setError(null);

    try {
      const { url } = await getPortalUrl();

      if (url) window.location.href = url;
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Escolha seu plano</h2>
        {currentTier ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void manage()}
          >
            {busy === "portal" ? "Abrindo…" : "Gerenciar cobrança e faturas"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      {currentTier ? (
        <fieldset className="mt-4 flex flex-wrap gap-4" disabled={busy !== null}>
          <legend className="mb-2 text-body-sm">Quando mudar de plano?</legend>
          {(
            [
              ["immediate", "Agora, com cobrança ou crédito proporcional"],
              ["end_of_cycle", "Na próxima renovação"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-body-sm">
              <input
                type="radio"
                name="plan-schedule"
                value={value}
                checked={schedule === value}
                onChange={() => {
                  setSchedule(value);
                  setPreview(null);
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {preview ? (
        <section
          className="mt-4 rounded-lg border border-border bg-surface p-4"
          aria-label="Confirmar mudança de plano"
        >
          <h3 className="font-semibold">Confirmar mudança de plano</h3>
          <p className="mt-2 text-body-sm">
            {PLAN_TIERS.find((tier) => tier.tier === tierOfPlan(preview.planId))?.label}.
            {preview.schedule === "immediate"
              ? " A mudança vale agora."
              : ` A mudança vale na renovação${preview.effectiveAt ? ` em ${new Date(preview.effectiveAt).toLocaleDateString("pt-BR")}` : ""}.`}
          </p>
          <p className="mt-2 text-body-sm">
            {preview.total < 0 ? "Crédito proporcional: " : "Cobrança prevista: "}
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: preview.currency,
            }).format(Math.abs(preview.total))}
          </p>
          <p className="mt-2 text-xs text-text-3">
            Créditos seguem as regras da cobrança e não significam reembolso no cartão. O uso já
            consumido dos serviços pagos pela Vanda não é zerado. No plano ChatGPT, conecte sua
            assinatura em Perfil para usar conversa e imagens por ela.
          </p>
          {preview.scheduledPlanId ? (
            <p className="mt-2 text-body-sm">Esta escolha substitui a mudança já agendada.</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button disabled={busy !== null} onClick={() => void confirmChange()}>
              Confirmar mudança
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => setPreview(null)}>
              Cancelar
            </Button>
          </div>
        </section>
      ) : null}

      <div className="mt-4 flex w-fit gap-1 rounded-lg border border-border bg-surface p-1">
        {(
          [
            { key: "monthly", label: "Mensal" },
            { key: "annual", label: "Anual · 12x" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={interval === key}
            onClick={() => setInterval(key)}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors duration-150 ease-[var(--ease-out)]",
              interval === key ? "bg-muted text-text" : "text-text-3 hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PlanCard
          title="Teste grátis"
          priceLine={<span className="text-xl font-semibold">R$0</span>}
          features={TIER_FEATURES.trial!}
          action={
            currentTier === null ? (
              <Button variant="outline" size="sm" className="w-full" disabled>
                Plano atual
              </Button>
            ) : null
          }
        />
        {PLAN_TIERS.map((tier) => {
          // Monthly-only tiers (Conectado) ignore the interval switch.
          const annual = interval === "annual" ? tier.annual : undefined;
          const price = annual ?? tier.monthly;
          const perMonth = annual ? annual.perMonthBrl : tier.monthly.priceBrl;
          const current = summary?.plan === price.productId;
          const scheduled = summary?.scheduledPlan === price.productId;

          return (
            <PlanCard
              key={tier.tier}
              title={tier.label}
              highlight={tier.tier === "profissional"}
              badge={planBadge(tier.tier)}
              priceLine={
                <>
                  <span className="text-xl font-semibold">R${perMonth}</span>
                  <span className="text-body-sm text-text-4">/mês</span>
                  {annual ? (
                    <span className="block text-xs text-text-4">
                      12x no plano anual · R${annual.priceBrl}/ano
                    </span>
                  ) : interval === "annual" ? (
                    <span className="block text-xs text-text-4">somente mensal</span>
                  ) : null}
                </>
              }
              features={TIER_FEATURES[tier.tier]!}
              action={
                current ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Plano atual
                  </Button>
                ) : scheduled ? (
                  // A downgrade Autumn deferred: it activates at the renewal.
                  <div className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={busy !== null}
                      onClick={() => void subscribe(price.productId)}
                    >
                      {schedule === "immediate" ? "Mudar agora" : "Revisar agendamento"}
                    </Button>
                    <p className="mt-1.5 text-xs text-text-4">
                      ativa na renovação
                      {summary?.renewsAt
                        ? ` (${new Date(summary.renewsAt).toLocaleDateString("pt-BR")})`
                        : ""}
                    </p>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() => void subscribe(price.productId)}
                  >
                    {busy === price.productId
                      ? "Abrindo…"
                      : currentTier
                        ? "Mudar de plano"
                        : "Assinar"}
                  </Button>
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Vanda and image choices respect the connected transport. Caetano has an
 * independent preference and continues using Vanda's OpenRouter budget.
 */
function ModelsCard() {
  const runtime = useContext(ProfileRuntimeContext);

  const {
    preferences: prefs,
    setAgentModel,
    setCaetanoModel,
    setImageModel,
  } = runtime.useModelPreferences();

  const [error, setError] = useState<string | null>(null);

  const conectado = prefs?.conectado ?? false;
  const orchestratorId = prefs?.orchestrator ?? DEFAULT_ORCHESTRATOR_MODEL;
  const caetanoId = prefs?.caetano ?? DEFAULT_CAETANO_MODEL;

  const imageId = conectado
    ? resolveConnectedImageModel(prefs?.image)
    : (prefs?.image ?? DEFAULT_IMAGE_MODEL);

  const orchestrator = ORCHESTRATOR_MODELS.find((model) => model.id === orchestratorId);
  const imageModels = conectado ? CONECTADO_IMAGE_MODELS : IMAGE_MODELS;
  const image = imageModels.find((model) => model.id === imageId);

  const choose = async (action: Promise<unknown>) => {
    setError(null);

    try {
      await action;
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-5">
      <h3 className="text-body font-semibold">Modelos</h3>
      <p className="mt-0.5 text-body-sm text-text-3">
        Escolha os modelos da Vanda, do Caetano e das imagens.
      </p>

      <div className="mt-4 space-y-4 border-t border-border pt-4">
        {[
          {
            label: "Conversa",
            ariaLabel: "Modelo de conversa",
            id: orchestratorId,
            description: orchestrator?.tagline ?? "O modelo que pensa e escreve como a Vanda.",
            setModel: setAgentModel,
          },
          {
            label: "Caetano",
            ariaLabel: "Modelo do Caetano",
            id: caetanoId,
            description: "No aplicativo e no WhatsApp. Usa a mesma conexão da Vanda.",
            setModel: setCaetanoModel,
          },
        ].map((choice) => (
          <ModelRow
            key={choice.label}
            label={choice.label}
            description={choice.description}
            loading={prefs === undefined}
          >
            <Select
              value={choice.id}
              onValueChange={(value) => void choose(choice.setModel({ modelId: String(value) }))}
            >
              <SelectTrigger className="w-56" aria-label={choice.ariaLabel}>
                <SelectValue>
                  {(value) => {
                    const model = ORCHESTRATOR_MODELS.find((item) => item.id === value);

                    return model ? (
                      <>
                        <MakerMark maker={model.maker} />
                        <span className="truncate">{model.label}</span>
                      </>
                    ) : null;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="w-72">
                {ORCHESTRATOR_MODELS.map((model) => {
                  const blocked = !isTextModelAvailable(model, conectado);

                  return (
                    <SelectItem key={model.id} value={model.id} disabled={blocked}>
                      <span className="flex items-center gap-2">
                        <MakerMark maker={model.maker} />
                        <span className="truncate font-medium">{model.label}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-text-4">
                        {blocked ? "Indisponível pela assinatura do ChatGPT" : model.tagline}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </ModelRow>
        ))}

        <ModelRow
          label="Imagens"
          description={image?.blurb ?? "O modelo que a Vanda usa para criar e editar imagens."}
          loading={prefs === undefined}
        >
          <Select
            value={imageId}
            onValueChange={(value) => void choose(setImageModel({ modelId: String(value) }))}
          >
            <SelectTrigger className="w-56" aria-label="Modelo de imagens">
              <SelectValue>
                {(value) => {
                  const model = imageModels.find((item) => item.id === value);

                  return model ? (
                    <>
                      <MakerMark maker={model.maker} />
                      <span className="truncate">{model.label}</span>
                    </>
                  ) : null;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="w-72">
              {imageModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <span className="flex items-center gap-2">
                    <MakerMark maker={model.maker} />
                    <span className="truncate font-medium">{model.label}</span>
                    <span className="text-note font-semibold text-green">{model.priceTier}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-text-4">{model.blurb}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ModelRow>
      </div>

      {conectado ? (
        <p className="mt-4 text-xs text-text-4">
          No plano ChatGPT, Vanda, Caetano e imagens usam sua assinatura da OpenAI. Apenas modelos
          compatíveis com essa conexão ficam disponíveis.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One labelled choice: name + why it matters on the left, control on the right. */
function ModelRow({
  label,
  description,
  loading,
  children,
}: {
  label: string;
  description: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="text-body-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-text-4">{description}</p>
      </div>
      {loading ? <Skeleton className="h-9 w-56 rounded-md" /> : children}
    </div>
  );
}

/** The maker's brand mark — monochrome, inheriting the row's text color. */
function MakerMark({ maker }: { maker: ModelMaker | ImageModel["maker"] }) {
  const Icon = {
    OpenAI: OpenAiIcon,
    Anthropic: AnthropicIcon,
    Meta: MetaIcon,
    Google: GeminiIcon,
    "Black Forest Labs": FluxIcon,
  }[maker];

  return <Icon className="size-4 shrink-0 text-text-2" />;
}

/**
 * Per-business Instagram connection through the publisher (Upload-Post):
 * shows the synced state and mints the white-label connect page URL. On
 * mount it re-syncs once — that's how returning from the connect page
 * (redirected to /perfil) picks up a fresh connection.
 */
function InstagramConnectCard({ accountId, name }: { accountId: Id<"accounts">; name: string }) {
  const runtime = useContext(ProfileRuntimeContext);
  const { status, startConnect, syncConnection } = runtime.usePublisherConnection(accountId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void syncConnection({ accountId }).catch(() => {});
  }, [accountId, syncConnection]);

  const connect = async () => {
    setBusy(true);
    setError(null);

    try {
      const { url } = await startConnect({
        accountId,
        origin: window.location.origin,
        returnTo: "perfil",
      });

      window.location.href = url;
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-body font-semibold">Instagram · {name}</h3>
          <p className="mt-0.5 text-body-sm text-text-3">
            {status?.connected
              ? `Conectado${status.handle ? ` como @${status.handle}` : ""} — a Vanda publica somente com a sua aprovação.`
              : "Conecte o Instagram deste negócio para a Vanda poder publicar."}
          </p>
        </div>
        <Button
          variant={status?.connected ? "outline" : "default"}
          size="sm"
          disabled={busy || status === undefined}
          onClick={() => void connect()}
        >
          {busy ? "Abrindo…" : status?.connected ? "Reconectar" : "Conectar Instagram"}
        </Button>
      </div>
      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Conectado plan's OpenAI connection card: shows connection state and
 * runs the device-code flow — a short code the owner types at openai.com,
 * polled here until approval lands.
 */
function OpenAiConnectCard() {
  const runtime = useContext(ProfileRuntimeContext);
  const { status, startDeviceAuth, pollDeviceAuth, disconnect } = runtime.useOpenAiConnection();

  const [device, setDevice] = useState<{
    deviceAuthId: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
  } | null>(null);

  const [flowState, setFlowState] = useState<"idle" | "starting" | "waiting" | "failed">("idle");
  const [flowError, setFlowError] = useState<string | null>(null);

  // Poll while a device code is outstanding; stop on approval or failure.
  useEffect(() => {
    if (!device || flowState !== "waiting") return;
    let cancelled = false;

    const timer = setInterval(
      () => {
        void pollDeviceAuth({ deviceAuthId: device.deviceAuthId, userCode: device.userCode })
          .then((result) => {
            if (cancelled) return;

            if (result.status === "complete") {
              setDevice(null);
              setFlowState("idle");
            } else if (result.status === "failed") {
              setFlowError(errorMessage(result.message));
              setFlowState("failed");
            }
          })
          .catch(() => {});
      },
      Math.max(device.intervalSeconds, 3) * 1000,
    );

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [device, flowState, pollDeviceAuth]);

  const connect = async () => {
    setFlowState("starting");
    setFlowError(null);

    try {
      const info = await startDeviceAuth();
      setDevice(info);
      setFlowState("waiting");
    } catch (cause) {
      setFlowError(errorMessage(cause));
      setFlowState("failed");
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-body font-semibold">Conta OpenAI</h3>
          <p className="mt-0.5 text-body-sm text-text-3">
            {status?.connected
              ? "Conectada — a Vanda usa a sua assinatura do ChatGPT para textos e imagens."
              : "Conecte sua conta para a Vanda usar a sua assinatura do ChatGPT."}
          </p>
        </div>
        {status?.connected ? (
          <Button variant="outline" size="sm" onClick={() => void disconnect()}>
            Desconectar
          </Button>
        ) : flowState === "waiting" ? null : (
          <Button size="sm" disabled={flowState === "starting"} onClick={() => void connect()}>
            {flowState === "starting" ? "Gerando código…" : "Conectar OpenAI"}
          </Button>
        )}
      </div>

      {!status?.connected && device && flowState === "waiting" ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4 text-center">
          <p className="text-body-sm text-text-3">
            Acesse{" "}
            <a
              href={device.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-text underline underline-offset-2"
            >
              {device.verificationUri.replace("https://", "")}
            </a>{" "}
            e digite o código:
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.3em]">
            {device.userCode}
          </p>
          <p className="mt-2 flex items-center justify-center gap-2 text-xs text-text-4">
            <Spinner className="size-3" /> aguardando aprovação…
          </p>
        </div>
      ) : null}

      {flowError ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {flowError}
        </p>
      ) : null}
    </div>
  );
}

function PlanCard({
  title,
  priceLine,
  features,
  action,
  highlight = false,
  badge,
}: {
  title: string;
  priceLine: ReactNode;
  features: string[];
  action: ReactNode;
  highlight?: boolean;
  badge?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border bg-surface p-5",
        highlight ? "border-brand-accent/50" : "border-border",
      )}
    >
      <div className="mb-3 min-h-6">
        {badge ? (
          <span className="inline-block rounded-md bg-brand-accent/10 px-2 py-1 text-[10px] font-medium text-brand-soft">
            {badge}
          </span>
        ) : null}
      </div>
      <h3 className="text-body font-semibold">{title}</h3>
      <p className="mt-2">{priceLine}</p>
      <ul className="mt-4 flex-1 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-body-sm text-text-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-brand-accent" />
            {feature}
          </li>
        ))}
      </ul>
      <div className="mt-5">{action}</div>
    </div>
  );
}

function SkillsTab({ accountId }: { accountId: Id<"accounts"> }) {
  const skills = useContext(ProfileRuntimeContext).useInstalledSkills(accountId);

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold">Skills instaladas</h2>
          <p className="mt-0.5 text-body-sm text-text-3">
            Instruções especializadas que a Vanda aplica ao trabalhar neste negócio.
          </p>
        </div>
        {skills !== undefined ? (
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-text-3">
            {skills.length} {skills.length === 1 ? "instalada" : "instaladas"}
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        {skills === undefined ? (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ) : skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Sparkles className="mx-auto size-5 text-text-4" />
            <p className="mt-2 text-body-sm text-text-3">Nenhuma skill instalada.</p>
          </div>
        ) : (
          skills.map((skill) => (
            <article
              key={skill.name}
              className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-text-2">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-mono text-body font-semibold">{skill.name}</h3>
                  <span className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[11px] font-medium text-brand-accent">
                    {skill.alwaysApply ? "Sempre ativa" : "Ativa"}
                  </span>
                </div>
                <p className="mt-1 text-body-sm leading-relaxed text-text-3">{skill.description}</p>
                {skill.sourceUrl ? (
                  <a
                    href={skill.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-text-4 underline-offset-2 hover:text-text-2 hover:underline"
                  >
                    Ver origem
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

type FileResult = ReturnType<typeof useFileText>;

/** Reads a workspace text file; null while loading, "" only if truly empty. */
function useFileText(accountId: Id<"accounts">, path: string, skip = false) {
  const result = useContext(ProfileRuntimeContext).useWorkspaceFile(accountId, path, skip);

  if (result === undefined) return { loading: true as const, text: null };

  return {
    loading: false as const,
    text: result.ok && result.file.kind === "text" ? result.file.text : null,
  };
}

function SectionCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-body font-semibold">{title}</h3>
        {caption ? <p className="text-xs text-text-4">{caption}</p> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function BrandTab({ accountId }: { accountId: Id<"accounts"> }) {
  const profile = useFileText(accountId, "/brand/profile.json");
  const memory = useFileText(accountId, "/brand/memory.md");
  const notes = useFileText(accountId, "/brand/notes.md");

  let readiness: number | null = null;

  if (profile.text) {
    try {
      const parsed = z
        .object({ readiness: z.object({ score: z.number() }).optional() })
        .parse(JSON.parse(profile.text));

      const score = parsed.readiness?.score;

      if (score !== undefined) readiness = Math.round(score * 100);
    } catch {
      readiness = null;
    }
  }

  return (
    <>
      {readiness !== null ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-body font-semibold">Prontidão do perfil</h3>
            <span className="text-body-sm font-medium text-text-2">{readiness}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand-accent transition-[width] duration-300 ease-[var(--ease-out)]"
              style={{ width: `${readiness}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-text-4">
            Quanto mais completo o perfil, mais fiel à marca a Vanda consegue ser.
          </p>
        </section>
      ) : null}

      <BrandKitCard accountId={accountId} />

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Memória de marca" caption="fatos confirmados por você">
          <FileBody result={memory} format="markdown" />
        </SectionCard>
        <SectionCard title="Anotações da Vanda" caption="sempre com a sua aprovação">
          <FileBody result={notes} format="markdown" />
        </SectionCard>
      </div>
    </>
  );
}

/**
 * The Pomelli-style identity card: swatches with exact hexes, font previews,
 * tagline — rendered straight from /brand/kit.json. The kit only changes
 * through the write approval flow, so what's shown here is what Vanda uses.
 */
function BrandKitCard({ accountId }: { accountId: Id<"accounts"> }) {
  const result = useFileText(accountId, "/brand/kit.json");
  const kit = result.text !== null ? parseBrandKit(result.text) : null;
  const empty = kit === null || (kit.colors.length === 0 && kit.fonts.length === 0 && !kit.tagline);

  return (
    <SectionCard title="Identidade visual" caption="a Vanda usa exatamente estas cores e fontes">
      {result.loading ? (
        <div className="flex gap-3" aria-hidden>
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="size-14 rounded-full" />
        </div>
      ) : empty ? (
        <p className="text-body-sm leading-relaxed text-text-3">
          Nenhuma identidade registrada ainda. Diga na conversa algo como{" "}
          <em>"nossas cores são #d81b60 e #fdfcfb, e a fonte é Poppins"</em> — a Vanda monta o kit e
          pede a sua aprovação antes de gravar.
        </p>
      ) : (
        <div className="space-y-6">
          {kit.colors.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {kit.colors.map((color) => (
                <div key={color.hex} className="overflow-hidden rounded-lg border border-border">
                  <span
                    aria-hidden
                    className="block h-24 w-full"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="p-3">
                    <span className="font-mono text-xs text-text-2">{color.hex}</span>
                    {color.name || color.role ? (
                      <span className="mt-1 block truncate text-[11px] text-text-3">
                        {color.name ?? color.role}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {kit.fonts.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {kit.fonts.map((font) => (
                <div
                  key={`${font.family}-${font.role ?? ""}`}
                  className="flex min-w-36 flex-col rounded-lg border border-border px-5 py-4"
                >
                  <span
                    aria-hidden
                    className="text-3xl leading-tight text-text"
                    style={{ fontFamily: `"${font.family}", sans-serif` }}
                  >
                    Aa
                  </span>
                  <span className="mt-1 text-body-sm font-medium">{font.family}</span>
                  {font.role ? <span className="text-[11px] text-text-4">{font.role}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {kit.tagline ? (
            <p className="border-t border-border pt-5 text-xl leading-relaxed font-medium tracking-tight text-text-2">
              “{kit.tagline}”
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function FileBody({ result, format }: { result: FileResult; format: "markdown" | "code" }) {
  if (result.loading) {
    return (
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-2/5" />
      </div>
    );
  }

  if (!result.text)
    return <p className="text-body-sm text-text-3">Nada registrado por aqui ainda.</p>;

  if (format === "code") {
    return (
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-body-sm leading-relaxed whitespace-pre text-text-2">
        {result.text}
      </pre>
    );
  }

  return <Markdown variant="reading">{result.text}</Markdown>;
}

function FolderTab({
  accountId,
  folder,
  format,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyBody,
}: {
  accountId: Id<"accounts">;
  folder: string;
  format: "markdown" | "code";
  emptyIcon: typeof NotebookPen;
  emptyTitle: string;
  emptyBody: string;
}) {
  const listing = useContext(ProfileRuntimeContext).useWorkspaceBrowse(accountId, folder);

  const entries = listing?.ok ? listing.entries : [];
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const selected = entries.some((entry) => entry.name === selectedName)
    ? selectedName
    : (entries[0]?.name ?? null);

  const file = useFileText(accountId, `${folder}/${selected}`, selected === null);

  if (listing === undefined) {
    return (
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-border bg-surface px-6 py-12 text-center">
        <span className="flex size-14 items-center justify-center rounded-xl border border-brand-accent/20 bg-brand-accent/5">
          <EmptyIcon className="size-6 text-brand-soft" />
        </span>
        <h3 className="mt-6 text-lg font-medium tracking-tight">{emptyTitle}</h3>
        <p className="mt-3 max-w-md text-body-sm leading-relaxed text-text-3">{emptyBody}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {entries.map((entry) => {
          const active = entry.name === selected;

          return (
            <button
              key={entry.name}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedName(entry.name)}
              className={cn(
                "flex w-full items-baseline gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-150 ease-[var(--ease-out)]",
                active ? "border-border-strong bg-surface" : "border-transparent hover:bg-surface",
              )}
            >
              <span className="min-w-0 break-all font-mono text-body-sm font-medium">
                {entry.name}
              </span>
              {entry.summary ? (
                <span className="min-w-0 flex-1 truncate text-xs text-text-4">{entry.summary}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <SectionCard title={selected ?? ""}>
        <FileBody result={file} format={format} />
      </SectionCard>
    </>
  );
}

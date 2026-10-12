import type { CSSProperties } from "react";
import { ChevronRight, Cpu, Instagram, LogOut, MessageCircle, Pencil, Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@vanda-studio/ui/components/avatar";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import {
  DEFAULT_CAETANO_MODEL,
  DEFAULT_ORCHESTRATOR_MODEL,
} from "../../convex/agentModels";
import { tierOfPlan } from "../../convex/billing/plans";
import type { Id } from "../../convex/_generated/dataModel";
import { AppearanceControl } from "./appearance";
import { BrandFileCard } from "./brand";
import { InstagramConnectionRow, OpenAiConnectionRow } from "./connections";
import {
  Monogram,
  Pill,
  ServiceTile,
  SettingsCard,
  SettingsLinkRow,
  SettingsPage,
  SettingsRow,
  SettingsStack,
} from "./layout";
import { ModelsCard } from "./models";
import { PlanOverview } from "./plan";
import { useProfileRuntime } from "./runtime";

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** Conta: who you are, how the app looks for you, and the way out. */
export function AccountPage() {
  const runtime = useProfileRuntime();
  const { user } = runtime.useProfileUser();
  const clerk = runtime.useClerkActions();
  const navigate = runtime.useProfileNavigate();
  const { preferences } = runtime.useModelPreferences();
  const name = user?.fullName ?? user?.username ?? "Minha conta";
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const customModels =
    preferences !== undefined &&
    preferences !== null &&
    ((preferences.orchestrator ?? DEFAULT_ORCHESTRATOR_MODEL) !== DEFAULT_ORCHESTRATOR_MODEL ||
      (preferences.caetano ?? DEFAULT_CAETANO_MODEL) !== DEFAULT_CAETANO_MODEL);

  const signOut = async () => {
    await clerk.signOut();
    // /login is a splat route (Clerk owns its sub-paths): the typed target is the empty splat.
    await navigate({ to: "/login/$", params: { _splat: "" } });
  };

  return (
    <SettingsPage title="Conta" lede="Quem você é na Vanda e como o app aparece para você.">
      <SettingsCard label="Conta">
        <SettingsRow
          icon={
            <Avatar size="lg">
              <AvatarImage src={user?.imageUrl} alt={name} />
              <AvatarFallback>{getInitials(name) || "MC"}</AvatarFallback>
            </Avatar>
          }
          title={name}
          detail={email ?? "E-mail não informado"}
        >
          <Button variant="secondary" size="sm" onClick={() => clerk.openUserProfile()}>
            <Pencil />
            Editar perfil
          </Button>
        </SettingsRow>
      </SettingsCard>

      <div className="mt-9 mb-3">
        <h2 className="text-sm font-semibold">Aparência</h2>
        <p className="mt-0.5 text-body text-text-3">Vale em todos os seus aparelhos.</p>
      </div>
      <SettingsCard>
        <SettingsRow title="Tema" detail="Sistema segue o tema do seu computador.">
          <AppearanceControl />
        </SettingsRow>
        <SettingsLinkRow
          href="/perfil/modelos"
          onNavigate={() => void navigate({ to: "/perfil/modelos" })}
          title="Modelos"
          detail="Qual modelo a Vanda e o Caetano usam em cada tarefa."
          value={preferences === undefined ? null : customModels ? "Personalizado" : "Padrão"}
        />
      </SettingsCard>

      <div className="mt-11 flex items-center gap-3 border-t border-line pt-4.5">
        <div className="min-w-0 flex-1 text-body text-text-3">
          <p className="font-medium text-text">Sair da conta</p>
          Seus negócios e conversas continuam salvos.
        </div>
        <Button variant="secondary" size="sm" onClick={() => void signOut()}>
          <LogOut />
          Sair
        </Button>
      </div>
    </SettingsPage>
  );
}

/** Plano e uso: the plan, what used it, and the plan picker on demand. */
export function PlanPage() {
  return (
    <SettingsPage title="Plano e uso" lede="O plano é compartilhado entre seus negócios.">
      <PlanOverview />
    </SettingsPage>
  );
}

/** Conexões: one card per service, Instagram with one row per business. */
export function ConnectionsPage() {
  const runtime = useProfileRuntime();
  const navigate = runtime.useProfileNavigate();
  const { accounts } = runtime.useProfileAccounts();
  const summary = runtime.useUsageSummary();
  const ready = accounts?.filter((account) => account.onboardedAt !== null) ?? [];

  return (
    <SettingsPage title="Conexões" lede="O que a Vanda e o Caetano usam para trabalhar.">
      <SettingsStack>
        <SettingsCard>
          <runtime.WhatsAppSettings />
        </SettingsCard>
        {summary?.plan && tierOfPlan(summary.plan) === "conectado" ? (
          <SettingsCard>
            <OpenAiConnectionRow />
          </SettingsCard>
        ) : null}
        {ready.length > 0 ? (
          <SettingsCard label="Instagram">
            <SettingsRow
              icon={
                <ServiceTile>
                  <Instagram className="size-4" />
                </ServiceTile>
              }
              title={
                <>
                  Instagram <span className="font-normal text-text-3">· um perfil por negócio</span>
                </>
              }
            />
            {ready.map((account) => (
              <InstagramConnectionRow key={account.id} accountId={account.id} name={account.name} />
            ))}
          </SettingsCard>
        ) : null}
      </SettingsStack>

      <div className="mt-9">
        <SettingsCard>
          <SettingsLinkRow
            href="/perfil/modelos"
            onNavigate={() => void navigate({ to: "/perfil/modelos" })}
            icon={
              <ServiceTile>
                <Cpu className="size-4" />
              </ServiceTile>
            }
            title="Modelos"
            detail="O que cada agente usa por baixo, em Avançado"
          />
        </SettingsCard>
      </div>
    </SettingsPage>
  );
}

/** How much of a business's brand file is filled: sections with anything in them. */
function BrandProgress({ accountId }: { accountId: Id<"accounts"> }) {
  const { file } = useProfileRuntime().useBrandFile(accountId);

  if (!file) return null;
  const total = file.outline.length;
  const filled = file.outline.filter((section) => section.items.length > 0).length;

  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="hidden h-1 w-16 overflow-hidden rounded-full bg-line-strong sm:block"
      >
        <span
          className="block h-full w-(--progress) rounded-full bg-text-3"
          style={
            // SAFETY: React forwards CSS variables; the value includes its percentage unit.
            { "--progress": `${total ? Math.round((filled / total) * 100) : 0}%` } as CSSProperties
          }
        />
      </span>
      {filled} de {total}
    </span>
  );
}

function InstagramHandle({ accountId }: { accountId: Id<"accounts"> }) {
  const { status } = useProfileRuntime().usePublisherConnection(accountId);

  if (status === undefined) return "Arquivo da marca";

  return status?.connected
    ? status.handle
      ? `@${status.handle}`
      : "Instagram conectado"
    : "Instagram não conectado";
}

/** Negócios: every business, its brand file's progress, and how to add one. */
export function BusinessesPage() {
  const runtime = useProfileRuntime();
  const navigate = runtime.useProfileNavigate();
  const { accounts } = runtime.useProfileAccounts();
  const ready = accounts?.filter((account) => account.onboardedAt !== null) ?? [];
  const unfinished = accounts?.filter((account) => account.onboardedAt === null) ?? [];

  return (
    <SettingsPage
      title="Negócios"
      lede="Tudo o que a Vanda sabe sobre cada negócio fica no arquivo da marca."
    >
      {accounts === undefined ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : (
        <SettingsCard label="Negócios">
          {ready.map((account, index) => (
            <SettingsLinkRow
              key={account.id}
              href={`/perfil/negocios/${account.id}`}
              onNavigate={() =>
                void navigate({
                  to: "/perfil/negocios/$accountId",
                  params: { accountId: account.id },
                })
              }
              icon={<Monogram name={account.name} index={index} size="lg" />}
              title={account.name}
              detail={<InstagramHandle accountId={account.id} />}
              value={<BrandProgress accountId={account.id} />}
            />
          ))}
          {unfinished.map((account, index) => (
            <SettingsLinkRow
              key={account.id}
              href={`/onboarding?accountId=${account.id}`}
              onNavigate={() =>
                void navigate({ to: "/onboarding", search: { accountId: account.id } })
              }
              icon={<Monogram name={account.name} index={ready.length + index} size="lg" />}
              title={
                <span className="flex items-center gap-2">
                  {account.name} <Pill tone="amber">Cadastro incompleto</Pill>
                </span>
              }
              detail="Concluir o cadastro"
            />
          ))}
          <button
            type="button"
            onClick={() => void navigate({ to: "/onboarding", search: { flow: "add" } })}
            className="flex w-full items-center gap-2 py-3 pr-4 pl-15.5 text-left text-body text-text-3 outline-none transition-colors duration-150 ease-out hover:bg-tile-hover hover:text-text focus-visible:bg-tile-hover"
          >
            <Plus className="size-3.5" />
            Adicionar negócio
          </button>
        </SettingsCard>
      )}
    </SettingsPage>
  );
}

/** One business: its brand file, and the way to adjust it with Vanda. */
export function BusinessPage({ accountId }: { accountId: string }) {
  const runtime = useProfileRuntime();
  const navigate = runtime.useProfileNavigate();
  const { accounts, selectAccount } = runtime.useProfileAccounts();

  const business = accounts?.find(
    (account) => account.id === accountId && account.onboardedAt !== null,
  );

  if (accounts === undefined)
    return (
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
    );

  if (!business) return <p className="text-body text-text-3">Negócio não encontrado.</p>;

  return (
    <SettingsPage
      title={business.name}
      lede="O que a Vanda e o Caetano sabem sobre este negócio. Edite aqui ou peça na conversa."
    >
      {/* Keyed by business so an unsaved draft never carries over to another one. */}
      <BrandFileCard key={business.id} accountId={business.id} />
      <Button
        variant="secondary"
        size="sm"
        className="mt-6"
        onClick={() => {
          selectAccount(business.id);
          void navigate({ to: "/conversa", search: {} });
        }}
      >
        <MessageCircle />
        Ajustar com a Vanda na conversa
        <ChevronRight className="text-text-4" />
      </Button>
    </SettingsPage>
  );
}

/** Modelos: which model each agent uses. Vanda picks good defaults. */
export function ModelsPage() {
  return (
    <SettingsPage
      title="Modelos"
      lede="Qual modelo a Vanda e o Caetano usam em cada tarefa. Os padrões já são bons; mude aqui ou peça na conversa."
    >
      <ModelsCard />
    </SettingsPage>
  );
}

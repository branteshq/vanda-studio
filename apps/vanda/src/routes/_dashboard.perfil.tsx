import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowLeft, ChevronRight, LogOut, Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@vanda-studio/ui/components/avatar";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { tierOfPlan } from "../convex/billing/plans";
import type { Id } from "../convex/_generated/dataModel";
import { AppearanceControl } from "../components/profile/appearance";
import { BrandFileCard } from "../components/profile/brand";
import { InstagramConnectionRow, OpenAiConnectionRow } from "../components/profile/connections";
import { ProfileGroupLabel, ProfileSection } from "../components/profile/layout";
import { ModelsCard } from "../components/profile/models";
import { PlanSummary, PlansPicker } from "../components/profile/plan";
import {
  ProfileRuntimeContext,
  defaultProfileRuntime,
  useProfileRuntime,
  type ProfileRuntime,
} from "../components/profile/runtime";

export const Route = createFileRoute("/_dashboard/perfil")({
  // `marca` opens one business's brand file in place of the overview.
  validateSearch: z.object({ marca: z.string().optional() }),
  component: () => <ProfilePage marca={Route.useSearch().marca} />,
});

/**
 * Perfil is one page that answers three questions: who am I and what do I pay,
 * what is connected, and what does Vanda know about each business (its brand
 * file). Models sit under Avançado: Vanda picks good defaults.
 */
export function ProfilePage({
  marca,
  runtime = defaultProfileRuntime,
}: {
  marca?: string | undefined;
  runtime?: ProfileRuntime;
}) {
  return (
    <ProfileRuntimeContext.Provider value={runtime}>
      <ProfileContent marca={marca} />
    </ProfileRuntimeContext.Provider>
  );
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ProfileContent({ marca }: { marca: string | undefined }) {
  const runtime = useProfileRuntime();
  const navigate = runtime.useProfileNavigate();
  const { accounts } = runtime.useProfileAccounts();
  const syncBilling = runtime.useSyncBilling();

  const business = accounts?.find(
    (account) => account.id === marca && account.onboardedAt !== null,
  );

  // Checkout returns here; refresh the enforcement snapshot on arrival.
  useEffect(() => {
    void syncBilling().catch(() => {});
  }, [syncBilling]);

  return (
    <div className="min-h-svh bg-app text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="mx-auto flex h-12 max-w-3xl items-center gap-2 px-4 sm:px-6">
          <Button
            variant="subtle"
            size="sm"
            onClick={() =>
              void (business
                ? navigate({ to: "/perfil", search: {} })
                : navigate({ to: "/conversa", search: {} }))
            }
          >
            <ArrowLeft />
            {business ? "Perfil" : "Voltar à Vanda"}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-11 px-4 pt-10 pb-18 sm:px-6">
        {business ? (
          <BrandPage accountId={business.id} name={business.name} />
        ) : marca && accounts !== undefined ? (
          <p className="text-body-sm text-text-3">Negócio não encontrado.</p>
        ) : (
          <Overview />
        )}
      </main>
    </div>
  );
}

function Overview() {
  const runtime = useProfileRuntime();
  const { user } = runtime.useProfileUser();
  const clerk = runtime.useClerkActions();
  const navigate = runtime.useProfileNavigate();
  const { accounts } = runtime.useProfileAccounts();
  const summary = runtime.useUsageSummary();
  const [plansOpen, setPlansOpen] = useState(false);
  const name = user?.fullName ?? user?.username ?? "Minha conta";
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const ready = accounts?.filter((account) => account.onboardedAt !== null) ?? [];
  const unfinished = accounts?.filter((account) => account.onboardedAt === null) ?? [];

  const signOut = async () => {
    await clerk.signOut();
    // /login is a splat route (Clerk owns its sub-paths): the typed target is the empty splat.
    await navigate({ to: "/login/$", params: { _splat: "" } });
  };

  // No boxes: sections are separated by space and a small title, rows light up
  // on hover, and "Abrir conversa" is the only magenta on the page.
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Perfil</h1>
        <section aria-label="Conta" className="mt-7 flex flex-wrap items-center gap-4">
          <Avatar size="lg">
            <AvatarImage src={user?.imageUrl} alt={name} />
            <AvatarFallback>{getInitials(name) || "MC"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium">{name}</p>
            <p className="truncate text-body-sm text-text-3">{email ?? "E-mail não informado"}</p>
          </div>
          <div className="flex gap-1">
            <Button variant="subtle" size="sm" onClick={() => clerk.openUserProfile()}>
              Editar
            </Button>
            <Button variant="subtle" size="sm" onClick={() => void signOut()}>
              <LogOut />
              Sair
            </Button>
          </div>
        </section>
      </div>

      <section aria-label="Plano">
        <PlanSummary
          action={
            <Button
              variant="subtle"
              size="sm"
              aria-expanded={plansOpen}
              onClick={() => setPlansOpen((open) => !open)}
            >
              {plansOpen ? "Fechar planos" : "Gerenciar plano"}
            </Button>
          }
        />
        {plansOpen ? <PlansPicker /> : null}
      </section>

      <ProfileSection title="Conexões" caption="O que a Vanda e o Caetano usam para trabalhar.">
        <div className="-mx-3">
          <runtime.WhatsAppSettings />
          {summary?.plan && tierOfPlan(summary.plan) === "conectado" ? (
            <OpenAiConnectionRow />
          ) : null}
          {ready.length > 0 ? (
            <div role="group" aria-label="Instagram">
              <ProfileGroupLabel>Instagram</ProfileGroupLabel>
              {ready.map((account) => (
                <InstagramConnectionRow
                  key={account.id}
                  accountId={account.id}
                  name={account.name}
                />
              ))}
            </div>
          ) : null}
        </div>
      </ProfileSection>

      <ProfileSection
        title="Negócios"
        caption="Tudo o que a Vanda sabe sobre cada negócio fica no arquivo da marca."
      >
        {accounts === undefined ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : (
          <div className="-mx-3">
            {ready.map((account) => (
              <BusinessRow
                key={account.id}
                name={account.name}
                hint="Ver arquivo da marca"
                onClick={() => void navigate({ to: "/perfil", search: { marca: account.id } })}
              />
            ))}
            {unfinished.map((account) => (
              <BusinessRow
                key={account.id}
                name={account.name}
                hint="Cadastro incompleto. Concluir"
                onClick={() =>
                  void navigate({ to: "/onboarding", search: { accountId: account.id } })
                }
              />
            ))}
          </div>
        )}
        <Button
          variant="subtle"
          size="sm"
          className="mt-1 -ml-2.5"
          onClick={() => void navigate({ to: "/onboarding", search: { flow: "add" } })}
        >
          <Plus />
          Adicionar negócio
        </Button>
      </ProfileSection>

      <details className="group">
        <summary className="-ml-2.5 inline-flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2.5 text-body text-text-3 transition-colors duration-150 ease-out hover:bg-accent hover:text-text">
          Avançado
          <ChevronRight className="size-3.5 transition-transform duration-150 ease-out group-open:rotate-90" />
        </summary>
        <div className="mt-6 space-y-9">
          <ProfileSection title="Aparência">
            <AppearanceControl />
          </ProfileSection>
          <ProfileSection title="Modelos">
            <ModelsCard />
          </ProfileSection>
        </div>
      </details>
    </>
  );
}

/** A business in the Negócios list: its name, then where the row goes, in muted text. */
function BusinessRow({
  name,
  hint,
  onClick,
}: {
  name: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-accent"
    >
      <span className="min-w-0 truncate">
        <span className="text-body font-medium">{name}</span>
        <span className="ml-2 text-body-sm text-text-4">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-text-5" />
    </button>
  );
}

function BrandPage({ accountId, name }: { accountId: Id<"accounts">; name: string }) {
  const runtime = useProfileRuntime();
  const navigate = runtime.useProfileNavigate();
  const { selectAccount } = runtime.useProfileAccounts();

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
        <p className="mt-1 text-body-sm text-text-3">
          O que a Vanda e o Caetano sabem sobre este negócio. Edite aqui ou peça na conversa.
        </p>
      </div>
      <div>
        {/* Keyed by business so an unsaved draft never carries over to another one. */}
        <BrandFileCard key={accountId} accountId={accountId} />
        <Button
          variant="subtle"
          className="mt-8 -ml-2.5"
          onClick={() => {
            selectAccount(accountId);
            void navigate({ to: "/conversa", search: {} });
          }}
        >
          Ajustar com a Vanda na conversa
          <ChevronRight />
        </Button>
      </div>
    </>
  );
}

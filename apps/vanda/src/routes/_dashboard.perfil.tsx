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
import { BrandFileCard, BrandKitCard, SectionCard } from "../components/profile/brand";
import { InstagramConnectionRow, OpenAiConnectionRow } from "../components/profile/connections";
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
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
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

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Perfil</h1>

      <section aria-label="Conta" className="rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar size="lg">
            <AvatarImage src={user?.imageUrl} alt={name} />
            <AvatarFallback>{getInitials(name) || "MC"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium">{name}</p>
            <p className="truncate text-body-sm text-text-3">{email ?? "E-mail não informado"}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => clerk.openUserProfile()}>
              Editar
            </Button>
            <Button variant="subtle" size="sm" onClick={() => void signOut()}>
              <LogOut />
              Sair
            </Button>
          </div>
        </div>
        <div className="mt-5 border-t border-border pt-5">
          <PlanSummary
            action={
              <Button
                variant="outline"
                size="sm"
                aria-expanded={plansOpen}
                onClick={() => setPlansOpen((open) => !open)}
              >
                {plansOpen ? "Fechar planos" : "Gerenciar plano"}
              </Button>
            }
          />
          {plansOpen ? <PlansPicker /> : null}
        </div>
      </section>

      <SectionCard title="Conexões" caption="O que a Vanda e o Caetano usam para trabalhar.">
        <div className="-my-3 divide-y divide-border">
          <runtime.WhatsAppSettings />
          {summary?.plan && tierOfPlan(summary.plan) === "conectado" ? (
            <OpenAiConnectionRow />
          ) : null}
          {ready.map((account) => (
            <InstagramConnectionRow key={account.id} accountId={account.id} name={account.name} />
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Negócios"
        caption="Tudo o que a Vanda sabe sobre cada negócio fica no arquivo da marca."
      >
        {accounts === undefined ? (
          <Skeleton className="h-12 w-full rounded-lg" />
        ) : (
          <div className="-my-1 divide-y divide-border">
            {ready.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => void navigate({ to: "/perfil", search: { marca: account.id } })}
                className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:text-text"
              >
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-medium">{account.name}</span>
                  <span className="block text-xs text-text-4">Ver arquivo da marca</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-text-4" />
              </button>
            ))}
            {unfinished.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() =>
                  void navigate({ to: "/onboarding", search: { accountId: account.id } })
                }
                className="flex w-full items-center justify-between gap-3 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-medium">{account.name}</span>
                  <span className="block text-xs text-text-4">Cadastro incompleto. Concluir</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-text-4" />
              </button>
            ))}
          </div>
        )}
        <Button
          variant="subtle"
          size="sm"
          className="mt-3"
          onClick={() => void navigate({ to: "/onboarding", search: { flow: "add" } })}
        >
          <Plus />
          Adicionar negócio
        </Button>
      </SectionCard>

      <details className="group rounded-xl border border-border bg-surface p-5 sm:p-6">
        <summary className="cursor-pointer list-none text-body font-semibold">
          <span className="flex items-center justify-between">
            Avançado
            <ChevronRight className="size-4 text-text-4 transition-transform group-open:rotate-90" />
          </span>
        </summary>
        <div className="mt-5 space-y-6">
          <div>
            <h2 className="mb-2 text-body-sm font-medium">Aparência</h2>
            <AppearanceControl />
          </div>
          <div>
            <h2 className="mb-2 text-body-sm font-medium">Modelos</h2>
            <ModelsCard />
          </div>
        </div>
      </details>
    </>
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
      {/* Keyed by business so an unsaved draft never carries over to another one. */}
      <BrandFileCard key={accountId} accountId={accountId} />
      <BrandKitCard accountId={accountId} />
      <SectionCard
        title="Diagnóstico do Instagram"
        caption="A análise da conta que o Caetano usa para planejar os posts automáticos."
      >
        <runtime.InstagramDiagnosis accountId={accountId} />
      </SectionCard>
      <Button
        variant="subtle"
        onClick={() => {
          selectAccount(accountId);
          void navigate({ to: "/conversa", search: {} });
        }}
      >
        Ajustar com a Vanda na conversa
        <ChevronRight />
      </Button>
    </>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ArrowLeft, FileCode2, LogOut, NotebookPen } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@vanda-studio/ui/components/avatar";
import { Button } from "@vanda-studio/ui/components/button";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { PLAN_TIERS, planLabel } from "../convex/billing/plans";
import { parseBrandKit } from "../convex/workspace/brandKit";
import { useActiveAccount } from "../components/active-account";

export const Route = createFileRoute("/_dashboard/perfil")({
  component: ProfilePage,
});

/**
 * The owner-facing window into what Vanda knows: brand memory, durable notes
 * and reusable templates — per business, with a switcher. Renders full-bleed
 * (the dashboard layout skips the sidebar chrome for this route).
 */

type TabKey = "marca" | "memoria" | "templates";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "marca", label: "Marca" },
  { key: "memoria", label: "Memória" },
  { key: "templates", label: "Templates" },
];

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ProfilePage() {
  const { user } = useUser();
  const clerk = useClerk();
  const navigate = useNavigate();
  const { accounts, activeAccount } = useActiveAccount();
  const ready = accounts?.filter((account) => account.onboardedAt !== null) ?? [];
  const [viewedId, setViewedId] = useState<Id<"accounts"> | null>(null);
  const viewed = ready.find((account) => account.id === viewedId) ?? activeAccount ?? ready[0];
  const [tab, setTab] = useState<TabKey>("marca");

  const name = user?.fullName ?? user?.username ?? "Minha conta";
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const handleSignOut = async () => {
    await clerk.signOut();
    await navigate({ to: "/login" });
  };

  return (
    <div className="min-h-svh bg-app text-text">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigate({ to: "/conversa", search: {} })}
          >
            <ArrowLeft />
            Voltar para a conversa
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
            <LogOut />
            Sair
          </Button>
        </header>

        <div className="mt-10 grid gap-10 md:grid-cols-[260px_1fr]">
          <aside className="flex flex-col items-center text-center md:items-start md:text-left">
            <Avatar className="size-24">
              <AvatarImage src={user?.imageUrl} alt={name} />
              <AvatarFallback className="text-xl font-semibold">
                {getInitials(name) || "MC"}
              </AvatarFallback>
            </Avatar>
            <h1 className="mt-4 text-lg font-semibold tracking-tight">{name}</h1>
            {email ? <p className="mt-0.5 text-body-sm text-text-3">{email}</p> : null}

            <PlanSection />

            <section className="mt-8 w-full">
              <h2 className="section-label px-1 text-text-3">Negócios</h2>
              <div className="mt-2 space-y-1">
                {accounts === undefined ? (
                  <>
                    <Skeleton className="h-11 w-full rounded-lg" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                  </>
                ) : (
                  ready.map((account) => {
                    const selected = account.id === viewed?.id;
                    return (
                      <button
                        key={account.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setViewedId(account.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 ease-[var(--ease-out)]",
                          selected
                            ? "border-border-strong bg-surface"
                            : "border-transparent hover:bg-surface",
                        )}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-border-strong text-[11px] font-semibold text-text-2">
                          {getInitials(account.name) || "?"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium">
                            {account.name}
                          </span>
                          {account.handle ? (
                            <span className="block truncate text-xs text-text-3">
                              @{account.handle}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </aside>

          <main className="min-w-0">
            <div className="flex w-fit gap-1 rounded-lg border border-border bg-surface p-1">
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors duration-150 ease-[var(--ease-out)]",
                    tab === key ? "bg-muted text-text" : "text-text-3 hover:text-text",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {viewed ? (
              // Keyed by account so file selections reset when switching business.
              <div key={viewed.id} className="mt-6 space-y-6">
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
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * The t3-style plan block: current plan, the usage bar (the owner only ever
 * sees a percentage — never the underlying money), and subscribe/manage
 * actions riding Autumn checkout + billing portal.
 */
function PlanSection() {
  const summary = useQuery(api.usage.summary);
  const syncBilling = useAction(api.billing.autumn.syncBilling);
  const startCheckout = useAction(api.billing.autumn.startCheckout);
  const getPortalUrl = useAction(api.billing.autumn.getBillingPortalUrl);
  const [busy, setBusy] = useState<string | null>(null);

  // Refresh the enforcement snapshot from Autumn whenever the page opens —
  // this is also the post-checkout landing, so new subscriptions take effect
  // the moment Stripe redirects back.
  useEffect(() => {
    void syncBilling().catch(() => {});
  }, [syncBilling]);

  const subscribe = async (planId: string) => {
    setBusy(planId);
    try {
      const { checkoutUrl } = await startCheckout({ planId });
      if (checkoutUrl) window.location.href = checkoutUrl;
    } finally {
      setBusy(null);
    }
  };
  const manage = async () => {
    setBusy("portal");
    try {
      const { url } = await getPortalUrl();
      if (url) window.location.href = url;
    } finally {
      setBusy(null);
    }
  };

  const pct = summary?.usedPct ?? 0;
  const subscribed = summary?.plan != null;

  return (
    <section className="mt-8 w-full">
      <h2 className="section-label px-1 text-text-3">Plano</h2>
      <div className="mt-2 rounded-xl border border-border bg-surface p-4 text-left">
        {summary === undefined ? (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-body font-medium">{planLabel(summary?.plan ?? null)}</p>
              <span className="text-body-sm text-text-3">{pct}%</span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
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
            <p className="mt-2 text-xs text-text-4">
              {summary?.limited
                ? "Limite atingido — faça upgrade para continuar."
                : summary?.renewsAt
                  ? `Renova em ${new Date(summary.renewsAt).toLocaleDateString("pt-BR")}`
                  : "Crédito de teste — assine para renovar todo mês."}
            </p>
          </>
        )}
      </div>

      {subscribed ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          disabled={busy !== null}
          onClick={() => void manage()}
        >
          {busy === "portal" ? "Abrindo…" : "Gerenciar assinatura"}
        </Button>
      ) : (
        <div className="mt-2 space-y-2">
          {PLAN_TIERS.map((tier) => (
            <div key={tier.tier} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-body font-semibold">{tier.label}</p>
                <p className="text-body-sm text-text-2">
                  R${tier.monthly.priceBrl}
                  <span className="text-text-4">/mês</span>
                </p>
              </div>
              <p className="mt-0.5 text-xs text-text-4">
                ou R${tier.annual.perMonthBrl}/mês no plano anual
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={busy !== null}
                  onClick={() => void subscribe(tier.monthly.productId)}
                >
                  {busy === tier.monthly.productId ? "Abrindo…" : "Mensal"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={busy !== null}
                  onClick={() => void subscribe(tier.annual.productId)}
                >
                  {busy === tier.annual.productId ? "Abrindo…" : "Anual"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type FileResult = ReturnType<typeof useFileText>;

/** Reads a workspace text file; null while loading, "" only if truly empty. */
function useFileText(accountId: Id<"accounts">, path: string, skip = false) {
  const result = useQuery(api.workspacePublic.file, skip ? "skip" : { accountId, path });
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
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-body font-semibold">{title}</h3>
        {caption ? <p className="text-xs text-text-4">{caption}</p> : null}
      </div>
      <div className="mt-3">{children}</div>
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
      const parsed = JSON.parse(profile.text) as { readiness?: { score?: number } };
      const score = parsed.readiness?.score;
      if (typeof score === "number") readiness = Math.round(score * 100);
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

      <SectionCard title="Memória de marca" caption="fatos confirmados por você">
        <FileBody result={memory} format="markdown" />
      </SectionCard>

      <SectionCard title="Anotações da Vanda" caption="ela grava aqui — sempre com a sua aprovação">
        <FileBody result={notes} format="markdown" />
      </SectionCard>
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
          <em>"nossas cores são #d81b60 e #fdfcfb, e a fonte é Poppins"</em> — a Vanda monta o
          kit e pede a sua aprovação antes de gravar.
        </p>
      ) : (
        <div className="space-y-5">
          {kit.colors.length > 0 ? (
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              {kit.colors.map((color) => (
                <div key={color.hex} className="flex flex-col items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-14 rounded-full border border-border shadow-sm"
                    style={{ backgroundColor: color.hex }}
                  />
                  <span className="font-mono text-xs text-text-2">{color.hex}</span>
                  {color.name || color.role ? (
                    <span className="max-w-24 truncate text-[11px] text-text-4">
                      {color.name ?? color.role}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {kit.fonts.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {kit.fonts.map((font) => (
                <div
                  key={`${font.family}-${font.role ?? ""}`}
                  className="flex min-w-36 flex-col items-center rounded-lg border border-border px-5 py-3"
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
            <p className="text-body-sm text-text-2 italic">“{kit.tagline}”</p>
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
  if (result.text === null) return <p className="text-body-sm text-text-3">(vazio)</p>;
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
  const listing = useQuery(api.workspacePublic.browse, { accountId, path: folder });
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
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <EmptyIcon className="size-6 text-text-4" />
        <h3 className="mt-3 text-body font-semibold">{emptyTitle}</h3>
        <p className="mt-1.5 max-w-md text-body-sm leading-relaxed text-text-3">{emptyBody}</p>
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
                active
                  ? "border-border-strong bg-surface"
                  : "border-transparent hover:bg-surface",
              )}
            >
              <span className="shrink-0 font-mono text-body-sm font-medium">{entry.name}</span>
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

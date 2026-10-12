import type { MouseEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Cpu,
  Gauge,
  LifeBuoy,
  Plug,
  Plus,
  Store,
  UserRound,
} from "lucide-react";
import { cn } from "@vanda-studio/ui/lib/utils";
import { Monogram } from "./layout";
import { useProfileRuntime } from "./runtime";

/** Where a nav entry goes: a link for the browser, a callback for the router. */
interface NavTarget {
  href: string;
  go: () => void;
}

/**
 * Perfil's frame. On wide screens: a settings sidebar on the app background
 * and the page in one inset panel. On a phone the sidebar becomes a row of
 * pages under a sticky bar, so every page stays one tap away.
 */
export function ProfileShell({ children }: { children: ReactNode }) {
  const runtime = useProfileRuntime();
  const navigate = runtime.useProfileNavigate();
  const path = runtime.useProfilePath();
  const { accounts } = runtime.useProfileAccounts();
  const summary = runtime.useUsageSummary();
  const ready = accounts?.filter((account) => account.onboardedAt !== null) ?? [];
  const unfinished = accounts?.filter((account) => account.onboardedAt === null) ?? [];
  const pct = summary?.usedPct;

  const to = {
    conta: { href: "/perfil/conta", go: () => void navigate({ to: "/perfil/conta" }) },
    plano: { href: "/perfil/plano", go: () => void navigate({ to: "/perfil/plano" }) },
    conexoes: { href: "/perfil/conexoes", go: () => void navigate({ to: "/perfil/conexoes" }) },
    negocios: { href: "/perfil/negocios", go: () => void navigate({ to: "/perfil/negocios" }) },
    modelos: { href: "/perfil/modelos", go: () => void navigate({ to: "/perfil/modelos" }) },
    back: { href: "/conversa", go: () => void navigate({ to: "/conversa", search: {} }) },
  } satisfies Record<string, NavTarget>;

  const business = (accountId: string): NavTarget => ({
    href: `/perfil/negocios/${accountId}`,
    go: () => void navigate({ to: "/perfil/negocios/$accountId", params: { accountId } }),
  });

  const usage =
    pct === undefined ? null : (
      <span className={cn("tabular-nums", pct >= 80 ? "text-amber" : undefined)}>{pct}%</span>
    );

  return (
    <div className="min-h-svh bg-app text-text md:flex md:h-svh md:p-2 md:pl-0">
      <aside
        aria-label="Ajustes"
        className="hidden w-59 shrink-0 flex-col overflow-y-auto px-2.5 py-2 md:flex"
      >
        <NavLink target={to.back} icon={<ArrowLeft />} strong>
          Voltar à Vanda
        </NavLink>

        <NavGroup title="Você">
          <NavLink target={to.conta} icon={<UserRound />} active={path === to.conta.href}>
            Conta
          </NavLink>
          <NavLink
            target={to.plano}
            icon={<Gauge />}
            active={path === to.plano.href}
            count={usage}
          >
            Plano e uso
          </NavLink>
          <NavLink target={to.conexoes} icon={<Plug />} active={path === to.conexoes.href}>
            Conexões
          </NavLink>
        </NavGroup>

        <NavGroup title="Negócios">
          {ready.map((account, index) => {
            const target = business(account.id);

            return (
              <NavLink
                key={account.id}
                target={target}
                icon={<Monogram name={account.name} index={index} />}
                active={path === target.href}
              >
                {account.name}
              </NavLink>
            );
          })}
          {unfinished.map((account, index) => (
            <NavLink
              key={account.id}
              target={{
                href: `/onboarding?accountId=${account.id}`,
                go: () => void navigate({ to: "/onboarding", search: { accountId: account.id } }),
              }}
              icon={<Monogram name={account.name} index={ready.length + index} />}
              count={<span className="text-amber">Incompleto</span>}
            >
              {account.name}
            </NavLink>
          ))}
          <NavLink
            target={{
              href: "/onboarding?flow=add",
              go: () => void navigate({ to: "/onboarding", search: { flow: "add" } }),
            }}
            icon={<Plus />}
            muted
          >
            Adicionar negócio
          </NavLink>
        </NavGroup>

        <NavGroup title="Avançado">
          <NavLink target={to.modelos} icon={<Cpu />} active={path === to.modelos.href}>
            Modelos
          </NavLink>
        </NavGroup>

        <div className="mt-auto pt-3">
          <a
            href="/docs"
            className="flex h-7.5 items-center gap-2.25 rounded-md px-2 text-body text-text-3 transition-colors duration-150 ease-out hover:bg-line hover:text-text [&_svg]:size-3.5"
          >
            <LifeBuoy />
            Ajuda e documentação
          </a>
        </div>
      </aside>

      <div className="min-w-0 flex-1 md:overflow-y-auto md:rounded-xl md:border md:border-line md:bg-surface">
        <header className="sticky top-0 z-20 border-b border-line bg-app/90 backdrop-blur-md md:hidden">
          <div className="flex h-11 items-center px-2">
            <NavLink target={to.back} icon={<ArrowLeft />} strong>
              Voltar à Vanda
            </NavLink>
          </div>
          <nav aria-label="Páginas do perfil" className="flex gap-1 overflow-x-auto px-2 pb-2">
            {(
              [
                [to.conta, "Conta", <UserRound key="i" />],
                [to.plano, "Plano e uso", <Gauge key="i" />],
                [to.conexoes, "Conexões", <Plug key="i" />],
                [to.negocios, "Negócios", <Store key="i" />],
                [to.modelos, "Modelos", <Cpu key="i" />],
              ] as const
            ).map(([target, label, icon]) => (
              <NavLink
                key={label}
                target={target}
                icon={icon}
                active={
                  path === target.href ||
                  (target === to.negocios && path.startsWith("/perfil/negocios"))
                }
                compact
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-165 px-5 pt-8 pb-16 md:px-6 md:pt-18">{children}</main>
      </div>
    </div>
  );
}

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      <h2 className="px-2 pt-4 pb-1 text-caption font-medium text-text-4">{title}</h2>
      {children}
    </div>
  );
}

/** A sidebar entry: a real link (so ⌘-click opens a tab) that navigates in place. */
function NavLink({
  target,
  icon,
  active = false,
  count,
  strong = false,
  muted = false,
  compact = false,
  children,
}: {
  target: NavTarget;
  icon: ReactNode;
  active?: boolean;
  count?: ReactNode;
  strong?: boolean;
  muted?: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={target.href}
      aria-current={active ? "page" : undefined}
      onClick={(event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        target.go();
      }}
      className={cn(
        "flex h-7.5 shrink-0 items-center gap-2.25 rounded-md px-2 text-body whitespace-nowrap outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3.5 [&_svg]:shrink-0",
        active
          ? "bg-line-strong text-text ring-1 ring-line ring-inset [&_svg]:text-text"
          : muted
            ? "text-text-3 hover:bg-line hover:text-text [&_svg]:text-text-4"
            : "text-text-2 hover:bg-line hover:text-text [&_svg]:text-text-3",
        strong && "font-medium",
        compact && "h-7",
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {count ? <span className="ml-auto pl-2 text-note text-text-5">{count}</span> : null}
    </a>
  );
}

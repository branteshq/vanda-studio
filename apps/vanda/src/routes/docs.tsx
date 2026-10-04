import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { productDocs } from "../convex/productDocs/catalog";
import { VandaMark } from "../components/vanda-mark";

export const Route = createFileRoute("/docs")({
  head: () => ({ meta: [{ title: "Documentação · Vanda Studio" }] }),
  component: DocsLayout,
});

/** Public product docs: the same pages the Vanda and Caetano agents read. */
function DocsLayout() {
  return (
    <div className="min-h-svh bg-app text-text antialiased">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <VandaMark size={22} />
            <span className="font-semibold tracking-tight">Vanda Studio</span>
          </Link>
          <span className="text-text-4">/</span>
          <span className="text-body-sm text-text-3">Documentação</span>
        </div>
      </header>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 md:flex-row">
        <nav aria-label="Páginas da documentação" className="md:w-56 md:shrink-0">
          <ul className="flex flex-wrap gap-1 md:flex-col">
            {productDocs().map((doc) => (
              <li key={doc.slug}>
                <Link
                  to="/docs/$slug"
                  params={{ slug: doc.slug }}
                  className="block rounded-md px-3 py-1.5 text-body-sm text-text-3 transition-colors hover:bg-surface hover:text-text"
                  activeProps={{ className: "bg-surface font-medium text-text" }}
                >
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

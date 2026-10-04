import { Link, createFileRoute } from "@tanstack/react-router";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import { findProductDoc } from "../convex/productDocs/catalog";

export const Route = createFileRoute("/docs/$slug")({
  head: ({ params }) => ({
    meta: [{ title: `${findProductDoc(params.slug)?.title ?? "Documentação"} · Vanda Studio` }],
  }),
  component: DocPage,
});

function DocPage() {
  const { slug } = Route.useParams();
  const doc = findProductDoc(slug);

  if (!doc) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Página não encontrada</h1>
        <p className="mt-2 text-body-sm text-text-3">
          Essa página da documentação não existe.{" "}
          <Link to="/docs" className="underline">
            Voltar ao início
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <article className="max-w-prose">
      <Markdown variant="reading">{doc.markdown}</Markdown>
    </article>
  );
}

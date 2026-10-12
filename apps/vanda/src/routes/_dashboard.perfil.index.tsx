import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * /perfil has no page of its own: it opens Conta. Old links with `?marca=`
 * (the brand file before Perfil had pages) land on that business's page.
 */
export const Route = createFileRoute("/_dashboard/perfil/")({
  validateSearch: z.object({ marca: z.string().optional() }),
  beforeLoad: ({ search }) => {
    if (search.marca)
      throw redirect({
        to: "/perfil/negocios/$accountId",
        params: { accountId: search.marca },
        replace: true,
      });

    throw redirect({ to: "/perfil/conta", replace: true });
  },
});

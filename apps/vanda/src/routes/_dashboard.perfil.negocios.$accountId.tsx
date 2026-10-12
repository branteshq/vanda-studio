import { createFileRoute } from "@tanstack/react-router";
import { BusinessPage } from "../components/profile/pages";

export const Route = createFileRoute("/_dashboard/perfil/negocios/$accountId")({
  component: function BusinessRoute() {
    return <BusinessPage accountId={Route.useParams().accountId} />;
  },
});

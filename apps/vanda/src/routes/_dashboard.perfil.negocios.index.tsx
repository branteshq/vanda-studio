import { createFileRoute } from "@tanstack/react-router";
import { BusinessesPage } from "../components/profile/pages";

export const Route = createFileRoute("/_dashboard/perfil/negocios/")({
  component: BusinessesPage,
});

import { createFileRoute } from "@tanstack/react-router";
import { ModelsPage } from "../components/profile/pages";

export const Route = createFileRoute("/_dashboard/perfil/modelos")({
  component: ModelsPage,
});

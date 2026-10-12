import { createFileRoute } from "@tanstack/react-router";
import { PlanPage } from "../components/profile/pages";

export const Route = createFileRoute("/_dashboard/perfil/plano")({
  component: PlanPage,
});

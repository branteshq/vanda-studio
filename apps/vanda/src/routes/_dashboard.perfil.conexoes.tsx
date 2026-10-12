import { createFileRoute } from "@tanstack/react-router";
import { ConnectionsPage } from "../components/profile/pages";

export const Route = createFileRoute("/_dashboard/perfil/conexoes")({
  component: ConnectionsPage,
});

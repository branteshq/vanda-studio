import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "../components/profile/pages";

export const Route = createFileRoute("/_dashboard/perfil/conta")({
  component: AccountPage,
});

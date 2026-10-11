import { createFileRoute, redirect } from "@tanstack/react-router";

// Posts automáticos live at the top of the Calendário; old links land there.
export const Route = createFileRoute("/_dashboard/posts-automaticos")({
  beforeLoad: () => {
    throw redirect({ to: "/calendario" });
  },
});

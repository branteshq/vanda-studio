import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/")({
  component: () => <Navigate to="/docs/$slug" params={{ slug: "visao-geral" }} replace />,
});

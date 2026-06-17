import { createFileRoute } from "@tanstack/react-router";
import { InstagramCallbackRoute } from "./instagram.callback";

export const Route = createFileRoute("/api/integrations/instagram/callback")({
	component: InstagramCallbackRoute,
});

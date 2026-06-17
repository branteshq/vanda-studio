import { ConvexReactClient } from "convex/react";

let client: ConvexReactClient | null = null;

export function getConvexClient() {
	if (client) return client;

	const convexUrl = import.meta.env.PUBLIC_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL;
	if (!convexUrl) {
		console.warn("Missing PUBLIC_CONVEX_URL or VITE_CONVEX_URL");
	}

	client = new ConvexReactClient(convexUrl || "https://missing-convex-url.convex.cloud", {
		unsavedChangesWarning: false,
	});
	return client;
}

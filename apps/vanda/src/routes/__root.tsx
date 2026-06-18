import type { ReactNode } from "react";
import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { Outlet, Scripts, createRootRoute, HeadContent } from "@tanstack/react-router";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { getConvexClient } from "../convexClient";
import appCss from "../styles.css?url";
import vandaMarkIconUrl from "@vanda-studio/ui/assets/vanda-mark.svg?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Vanda Studio" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", type: "image/svg+xml", href: vandaMarkIconUrl },
			{ rel: "apple-touch-icon", href: vandaMarkIconUrl },
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{ rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=JetBrains+Mono:wght@400;500;600&display=swap",
			},
		],
	}),
	component: RootComponent,
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	const convex = getConvexClient();

	return (
		<html lang="pt-BR" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<ClerkProvider>
					<ConvexProviderWithClerk client={convex} useAuth={useAuth}>
						{children}
					</ConvexProviderWithClerk>
				</ClerkProvider>
				<Scripts />
			</body>
		</html>
	);
}

function RootComponent() {
	return <Outlet />;
}

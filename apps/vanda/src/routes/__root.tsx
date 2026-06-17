import type { ReactNode } from "react";
import {
	ClerkProvider,
	Show,
	SignInButton,
	UserButton,
	useAuth,
} from "@clerk/tanstack-react-start";
import { Link, Outlet, Scripts, createRootRoute, HeadContent } from "@tanstack/react-router";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { getAppUrl } from "../appUrl";
import { getConvexClient } from "../convexClient";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Vanda Studio" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	component: RootComponent,
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	const convex = getConvexClient();

	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<ClerkProvider>
					<ConvexProviderWithClerk client={convex} useAuth={useAuth}>
						<div className="shell">
							<header className="topbar">
								<Link to="/" className="brand">
									<span className="mark">V</span>
									<span>Vanda Studio</span>
								</Link>
								<nav className="nav" aria-label="Primary">
									<a href={getAppUrl("/app")} className="btn secondary">
										App
									</a>
									<a href={getAppUrl("/billing")} className="btn secondary">
										Billing
									</a>
									<a href={getAppUrl("/instagram")} className="btn secondary">
										Instagram
									</a>
									<Show when="signed-out">
										<SignInButton mode="modal">
											<button className="btn" type="button">
												Sign in
											</button>
										</SignInButton>
									</Show>
									<Show when="signed-in">
										<UserButton />
									</Show>
								</nav>
							</header>
							{children}
						</div>
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

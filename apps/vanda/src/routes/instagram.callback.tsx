import { Show, SignInButton } from "@clerk/tanstack-react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import { getInstagramRedirectUri } from "../instagramRedirect";

export const Route = createFileRoute("/instagram/callback")({
	component: InstagramCallbackRoute,
});

export function InstagramCallbackRoute() {
	const completeOAuth = useAction(api.instagramGraphActions.completeOAuth);
	const [message, setMessage] = useState("Finalizing Instagram connection...");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		const state = params.get("state");
		const metaError = params.get("error_description") ?? params.get("error");
		if (metaError) {
			setError(metaError);
			return;
		}
		if (!code || !state) {
			setError("Meta did not return the OAuth code and state.");
			return;
		}

		void completeOAuth({
			code,
			state,
			redirectUri: getInstagramRedirectUri(),
		})
			.then((result) => {
				setMessage(
					result.handle
						? `Instagram @${result.handle} connected.`
						: "Instagram connected.",
				);
			})
			.catch((err) => setError(err instanceof Error ? err.message : String(err)));
	}, [completeOAuth]);

	return (
		<main className="route-panel panel">
			<p className="eyebrow">instagram callback</p>
			<Show when="signed-out">
				<h1>Sign in to finish.</h1>
				<div className="actions">
					<SignInButton mode="modal">
						<button className="btn" type="button">
							Sign in
						</button>
					</SignInButton>
				</div>
			</Show>
			<Show when="signed-in">
				<h1>{error ? "Connection failed." : "Connection status."}</h1>
				<p className={error ? "lede error" : "lede"}>{error ?? message}</p>
				<div className="actions">
					<Link to="/instagram" className="btn secondary">
						Back to Instagram
					</Link>
				</div>
			</Show>
		</main>
	);
}

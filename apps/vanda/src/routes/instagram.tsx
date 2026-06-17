import { Instagram } from "lucide-react";
import { Show, SignInButton } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { getInstagramRedirectUri } from "../instagramRedirect";

export const Route = createFileRoute("/instagram")({
	component: InstagramRoute,
});

function InstagramRoute() {
	const connections = useQuery(api.instagramGraph.listMine) ?? [];
	const getConnectUrl = useAction(api.instagramGraphActions.getConnectUrl);

	async function connect() {
		const redirectUri = getInstagramRedirectUri();
		const result = await getConnectUrl({ redirectUri });
		window.location.href = result.url;
	}

	return (
		<main className="route-panel panel">
			<p className="eyebrow">instagram graph</p>
			<Show when="signed-out">
				<h1>Sign in to connect Instagram.</h1>
				<div className="actions">
					<SignInButton mode="modal">
						<button className="btn" type="button">
							Sign in
						</button>
					</SignInButton>
				</div>
			</Show>
			<Show when="signed-in">
				<h1>Connect the official API.</h1>
				<p className="lede">Connections are stored directly against the user. No projects, no old app model.</p>
				<div className="actions">
					<button className="btn instagram" type="button" onClick={connect}>
						<Instagram size={18} /> Connect Instagram
					</button>
				</div>
				<div className="grid">
					{connections.map((connection) => (
						<div className="card" key={connection._id}>
							<h2>@{connection.handle ?? connection.externalAccountId}</h2>
							<p className="muted">{connection.status}</p>
						</div>
					))}
				</div>
			</Show>
		</main>
	);
}

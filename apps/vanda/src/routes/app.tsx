import { Show, SignInButton, useUser } from "@clerk/tanstack-react-start";
import { useMutation, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { api } from "../convex/_generated/api";

export const Route = createFileRoute("/app")({
	component: AppRoute,
});

function AppRoute() {
	const { user, isSignedIn } = useUser();
	const ensureUser = useMutation(api.users.ensureCurrent);
	const currentUser = useQuery(api.users.current);

	useEffect(() => {
		if (isSignedIn) {
			void ensureUser();
		}
	}, [ensureUser, isSignedIn]);

	return (
		<main className="route-panel panel">
			<p className="eyebrow">protected app placeholder</p>
			<Show when="signed-out">
				<h1>Sign in required.</h1>
				<p className="lede">This route is intentionally bare; it only validates Clerk and Convex auth.</p>
				<div className="actions">
					<SignInButton mode="modal">
						<button className="btn" type="button">
							Sign in
						</button>
					</SignInButton>
				</div>
			</Show>
			<Show when="signed-in">
				<h1>Auth works.</h1>
				<p className="lede">
					Signed in as {user?.primaryEmailAddress?.emailAddress ?? user?.id}. Convex user row:{" "}
					{currentUser?._id ?? "syncing"}.
				</p>
			</Show>
		</main>
	);
}

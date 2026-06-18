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
	const [message, setMessage] = useState("Finalizando conexão com o Instagram...");
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
			setError("O Meta não retornou o código e o state do OAuth.");
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
						? `Instagram @${result.handle} conectado.`
						: "Instagram conectado.",
				);
			})
			.catch((err) => setError(err instanceof Error ? err.message : String(err)));
	}, [completeOAuth]);

	return (
		<main className="grid min-h-svh place-items-center bg-background px-6">
			<div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
				<p className="font-mono text-[11px] uppercase tracking-[0.16em] text-vanda-muted-2">
					Instagram
				</p>
				<Show when="signed-out">
					<h1 className="mt-3 text-[17px] font-semibold tracking-[-0.018em]">
						Entre para finalizar.
					</h1>
					<div className="mt-5 flex justify-center">
						<SignInButton mode="modal">
							<button
								type="button"
								className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[13.5px] font-medium text-primary-foreground transition-transform duration-150 active:scale-[0.97]"
							>
								Entrar
							</button>
						</SignInButton>
					</div>
				</Show>
				<Show when="signed-in">
					<h1 className="mt-3 text-[17px] font-semibold tracking-[-0.018em]">
						{error ? "Falha na conexão." : "Status da conexão"}
					</h1>
					<p
						className={`mx-auto mt-2 max-w-sm text-[13.5px] leading-[1.5] ${
							error ? "text-destructive" : "text-muted-foreground"
						}`}
					>
						{error ?? message}
					</p>
					<div className="mt-5 flex justify-center">
						<Link
							to="/perfil"
							className="inline-flex h-9 items-center rounded-lg border border-input px-4 text-[13.5px] font-medium transition-colors duration-150 hover:bg-vanda-elevated"
						>
							Ir para o perfil
						</Link>
					</div>
				</Show>
			</div>
		</main>
	);
}

<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { useConvexClient } from "convex-svelte";
	import { SignedIn, SignedOut, SignInButton, useClerkContext } from "svelte-clerk";
	import { api } from "../../../../../../convex/_generated/api.js";
	import Navbar from "$lib/components/Navbar.svelte";
	import { Button } from "$lib/components/ui";
	import { formatUserFacingMessage } from "$lib/errors";

	const client = useConvexClient();
	const clerk = useClerkContext();

	let status = $state<"idle" | "connecting" | "connected" | "error">("idle");
	let message = $state("Finalizando conexão com o Instagram...");
	let error = $state<string | null>(null);
	let started = $state(false);
	let connectedProjectId = $state<string | null>(null);

	const code = $derived($page.url.searchParams.get("code"));
	const oauthState = $derived($page.url.searchParams.get("state"));
	const metaError = $derived($page.url.searchParams.get("error_description") ?? $page.url.searchParams.get("error"));

	function getRedirectUri() {
		return `${window.location.origin}/api/integrations/instagram/callback`;
	}

	async function complete() {
		if (started) return;
		if (!clerk.session) return;
		started = true;

		if (metaError) {
			status = "error";
			error = metaError;
			return;
		}
		if (!code || !oauthState) {
			status = "error";
			error = "A Meta não retornou os parâmetros necessários para concluir a conexão.";
			return;
		}

		status = "connecting";
		error = null;
		try {
			const result = await client.action(api.instagramGraphActions.completeOAuth, {
				code,
				state: oauthState,
				redirectUri: getRedirectUri(),
			});
			status = "connected";
			connectedProjectId = result.projectId ?? null;
			message = result.handle
				? `Instagram @${result.handle} conectado ${result.projectId ? "ao projeto" : ""} com sucesso.`
				: "Instagram conectado com sucesso.";
		} catch (err) {
			console.error("[instagram-callback] completeOAuth failed", err);
			status = "error";
			error = formatUserFacingMessage(err);
		}
	}

	$effect(() => {
		void complete();
	});
</script>

<svelte:head>
	<title>Conexão Instagram - Vanda Studio</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-background">
	<Navbar />

	<main class="flex flex-1 items-center justify-center px-6 py-16">
		<section class="w-full max-w-xl border border-border bg-card p-8">
			<p class="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
				Instagram
			</p>
			<h1 class="mt-3 text-3xl font-semibold">
				{status === "connected" ? "Conta conectada" : status === "error" ? "Falha na conexão" : "Conectando conta"}
			</h1>

			<SignedOut>
				<p class="mt-4 text-sm leading-6 text-muted-foreground">
					Entre na Vanda para concluir a conexão iniciada na Meta.
				</p>
				<div class="mt-8">
					<SignInButton mode="modal">
						<Button>Entrar para concluir</Button>
					</SignInButton>
				</div>
			</SignedOut>

			<SignedIn>
				{#if status === "error"}
					<p class="mt-4 text-sm leading-6 text-destructive">{error}</p>
					<p class="mt-3 text-xs leading-5 text-muted-foreground">
						Abra o console do navegador ou os logs do Convex para ver o erro técnico detalhado.
					</p>
					<div class="mt-8 flex gap-3">
						<Button onclick={() => goto("/integrations/instagram/connect")}>
							Tentar novamente
						</Button>
						<Button variant="outline" onclick={() => goto("/account")}>
							Voltar
						</Button>
					</div>
				{:else}
					<p class="mt-4 text-sm leading-6 text-muted-foreground">{message}</p>
					{#if status === "connected"}
						<div class="mt-8">
							<Button onclick={() => goto(connectedProjectId ? `/projects/${connectedProjectId}` : "/account")}>
								{connectedProjectId ? "Voltar para o projeto" : "Voltar para a conta"}
							</Button>
						</div>
					{/if}
				{/if}
			</SignedIn>
		</section>
	</main>
</div>

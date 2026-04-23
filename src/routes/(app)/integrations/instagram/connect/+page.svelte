<script lang="ts">
	import { browser } from "$app/environment";
	import { useConvexClient } from "convex-svelte";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import { api } from "../../../../../convex/_generated/api.js";
	import Navbar from "$lib/components/Navbar.svelte";
	import { Button } from "$lib/components/ui";
	import { formatUserFacingMessage } from "$lib/errors";

	const client = useConvexClient();

	let isConnecting = $state(false);
	let error = $state<string | null>(null);

	function getRedirectUri() {
		if (!browser) return "";
		return `${window.location.origin}/api/integrations/instagram/callback`;
	}

	async function connectInstagram() {
		isConnecting = true;
		error = null;
		try {
			const result = await client.action(api.instagramGraphActions.getConnectUrl, {
				redirectUri: getRedirectUri(),
			});
			window.location.href = result.url;
		} catch (err) {
			error = formatUserFacingMessage(err);
			isConnecting = false;
		}
	}
</script>

<svelte:head>
	<title>Conectar Instagram - Vanda Studio</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-background">
	<Navbar />

	<main class="flex flex-1 items-center justify-center px-6 py-16">
		<section class="w-full max-w-xl border border-border bg-card p-8">
			<p class="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
				Integrações
			</p>
			<h1 class="mt-3 text-3xl font-semibold">Conectar Instagram</h1>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				Conecte uma conta profissional do Instagram para que a Vanda possa importar dados da conta,
				sincronizar publicações e preparar a base de métricas.
			</p>

			<SignedOut>
				<div class="mt-8">
					<SignInButton mode="modal">
						<Button>Entrar para continuar</Button>
					</SignInButton>
				</div>
			</SignedOut>

			<SignedIn>
				<div class="mt-8 flex flex-col gap-3">
					<Button onclick={connectInstagram} disabled={isConnecting}>
						{isConnecting ? "Abrindo Meta..." : "Conectar com Instagram"}
					</Button>
					{#if error}
						<p class="text-sm text-destructive">{error}</p>
					{/if}
				</div>
			</SignedIn>
		</section>
	</main>
</div>

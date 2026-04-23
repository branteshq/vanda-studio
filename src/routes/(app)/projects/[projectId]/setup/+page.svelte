<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { Button } from "$lib/components/ui";
	import { formatUserFacingMessage } from "$lib/errors";
	import { useConvexClient, useQuery } from "convex-svelte";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import { CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-svelte";
	import { api } from "../../../../../convex/_generated/api.js";
	import type { Id } from "../../../../../convex/_generated/dataModel.js";

	type SetupStatus = "idle" | "syncing" | "intelligence" | "renaming" | "done" | "error";

	const client = useConvexClient();
	const projectId = $derived($page.params.projectId as Id<"projects">);
	const projectQuery = useQuery(api.projects.get, () => ({ projectId }));

	let status = $state<SetupStatus>("idle");
	let error = $state<string | null>(null);
	let started = $state(false);

	const steps = $derived([
		{
			key: "syncing",
			label: "Importando posts e métricas",
			done: ["intelligence", "renaming", "done"].includes(status),
			active: status === "syncing",
		},
		{
			key: "intelligence",
			label: "Gerando estratégia inicial",
			done: ["renaming", "done"].includes(status),
			active: status === "intelligence",
		},
		{
			key: "renaming",
			label: "Organizando workspace da marca",
			done: status === "done",
			active: status === "renaming",
		},
	]);

	async function runSetup() {
		if (started) return;
		started = true;
		error = null;
		try {
			status = "syncing";
			await client.action(api.instagramGraphActions.importProjectPosts, {
				projectId,
				limit: 30,
			});

			status = "intelligence";
			await client.action(api.ai.socialIntelligence.regenerateBrandIntelligence, {
				projectId,
				limit: 30,
			});

			status = "renaming";
			const latestProject = await client.query(api.projects.get, { projectId });
			const handle = latestProject?.instagramHandle ?? latestProject?.instagramConnection?.handle;
			const shouldRename =
				latestProject?.name === "Projeto do Instagram" ||
				latestProject?.name === "Novo projeto" ||
				latestProject?.name.trim().length === 0;
			if (latestProject && handle && shouldRename) {
				await client.mutation(api.projects.update, {
					projectId,
					name: handle,
					onboardingStatus: "complete",
					onboardingPath: "existing",
				});
			} else {
				await client.mutation(api.projects.update, {
					projectId,
					onboardingStatus: "complete",
					onboardingPath: "existing",
				});
			}

			status = "done";
		} catch (err) {
			console.error("[project-setup] failed", err);
			error = formatUserFacingMessage(err);
			status = "error";
		}
	}

	function retry() {
		started = false;
		status = "idle";
		void runSetup();
	}

	$effect(() => {
		const project = projectQuery.data;
		if (project?.instagramConnection?.status === "connected") {
			void runSetup();
		}
	});
</script>

<svelte:head>
	<title>Configurando projeto - Vanda Studio</title>
</svelte:head>

<div class="setup-stage min-h-screen bg-[#0f1014] text-zinc-100">
	<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_15%,rgba(236,72,153,0.18),transparent_34%),radial-gradient(circle_at_25%_70%,rgba(16,185,129,0.08),transparent_32%)]"></div>
	<div class="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.9)_1px,transparent_1px)] [background-size:28px_28px]"></div>

	<main class="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
		<SignedOut>
			<section class="border border-zinc-800 bg-zinc-950/60 p-8 text-center">
				<h1 class="font-serif text-3xl font-semibold text-white">Entre para concluir</h1>
				<p class="mt-3 text-sm text-zinc-400">Faça login para finalizar a configuração do Instagram.</p>
				<SignInButton mode="modal">
					<Button class="mt-7 bg-pink-500 text-white hover:bg-pink-400">Entrar</Button>
				</SignInButton>
			</section>
		</SignedOut>

		<SignedIn>
			<section class="border border-zinc-800 bg-zinc-950/55 p-8 shadow-2xl">
				<p class="text-xs font-medium uppercase tracking-[0.22em] text-pink-400">Instagram</p>
				<h1 class="mt-4 font-serif text-4xl font-semibold tracking-[-0.02em] text-white">
					{status === "done" ? "Projeto pronto" : status === "error" ? "Falha na configuração" : "A Vanda está entendendo sua marca"}
				</h1>
				<p class="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
					{status === "done"
						? "Posts, métricas e inteligência inicial foram conectados ao projeto."
						: status === "error"
							? "Algo falhou durante a importação ou análise. Você pode tentar de novo."
							: "Estamos importando o comportamento real do Instagram para transformar este projeto em um workspace de marca."}
				</p>

				<div class="mt-9 space-y-4">
					{#each steps as step}
						<div class="flex items-center gap-4 border border-zinc-800 bg-zinc-900/35 px-5 py-4">
							<div class="flex h-10 w-10 items-center justify-center border {step.done ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : step.active ? 'border-pink-500/40 bg-pink-500/10 text-pink-400' : 'border-zinc-700 text-zinc-500'}">
								{#if step.done}
									<CheckCircle2 class="h-5 w-5" />
								{:else if step.active}
									<Loader2 class="h-5 w-5 animate-spin" />
								{:else}
									<Sparkles class="h-5 w-5" />
								{/if}
							</div>
							<div>
								<p class="font-semibold text-white">{step.label}</p>
								<p class="mt-1 text-xs text-zinc-500">
									{step.done ? "Concluído" : step.active ? "Em andamento" : "Aguardando"}
								</p>
							</div>
						</div>
					{/each}
				</div>

				{#if status === "error"}
					<div class="mt-6 flex items-start gap-3 border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
						<XCircle class="mt-0.5 h-5 w-5 shrink-0" />
						<p>{error}</p>
					</div>
				{/if}

				<div class="mt-8 flex justify-end gap-3">
					{#if status === "done"}
						<Button variant="outline" onclick={() => goto("/projects")}>Voltar aos projetos</Button>
						<Button class="bg-pink-500 text-white hover:bg-pink-400" onclick={() => goto(`/projects/${projectId}`)}>
							Abrir projeto
						</Button>
					{:else if status === "error"}
						<Button variant="outline" onclick={() => goto("/projects")}>Voltar</Button>
						<Button class="bg-pink-500 text-white hover:bg-pink-400" onclick={retry}>Tentar novamente</Button>
					{:else}
						<Button variant="outline" disabled>
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Configurando
						</Button>
					{/if}
				</div>
			</section>
		</SignedIn>
	</main>
</div>

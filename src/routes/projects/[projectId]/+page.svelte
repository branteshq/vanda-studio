<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { ProjectSettingsForm, InstagramIntelCard } from "$lib/components/projects";
	import { BrandSummaryCard } from "$lib/components/wizard";
	import { Badge, Button } from "$lib/components/ui";
	import { ImageGenerationPulseLoader } from "$lib/components/studio";
	import { pendingLaunchPosts } from "$lib/studio/pendingLaunchPostsStore";
	import { formatUserFacingMessageFromText, showUserError } from "$lib/errors";
	import { emptyBrandKit, type BrandKitState } from "$lib/types/brandKit";
	import { loadGoogleFont, fontFamily } from "$lib/utils";
	import { api } from "../../../convex/_generated/api.js";
	import type { Id } from "../../../convex/_generated/dataModel.js";
	import { useConvexClient, useQuery } from "convex-svelte";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import { get } from "svelte/store";
	import { ArrowLeft, Settings, Trash2, X, Sparkles, CalendarDays } from "lucide-svelte";

	const client = useConvexClient();

	let projectId = $derived($page.params.projectId as Id<"projects">);

	const projectQuery = useQuery(api.projects.get, () => ({ projectId }));
	let project = $derived(projectQuery.data);
	let isLoading = $derived(projectQuery.isLoading);

	let brandKit = $derived<BrandKitState>(project?.brandKit ?? emptyBrandKit());
	let brandGlowColor = $derived(brandKit.primaryColors?.[0] ?? null);

	$effect(() => {
		if (brandKit.typographyPrimary) loadGoogleFont(brandKit.typographyPrimary);
	});

	// ── UI state ────────────────────────────────────────────────────────
	let showDeleteConfirm = $state(false);
	let isDeletingProject = $state(false);
	let showSettings = $state(false);
	let isSavingKit = $state(false);
	// ── Helpers ─────────────────────────────────────────────────────────
	function getProfilePicture(): string | null {
		if (!project) return null;
		return project.profilePictureStorageUrl ?? project.profilePictureUrl ?? null;
	}

	function getLogoUrl(): string | null {
		if (!project) return null;
		return project.logoStorageUrl ?? getProfilePicture();
	}

	function getHandle(): string | null {
		if (!project) return null;
		if (project.instagramHandle) return project.instagramHandle;
		if (!project.instagramUrl) return null;
		try {
			const url = new URL(project.instagramUrl);
			const parts = url.pathname.split("/").filter(Boolean);
			return parts[0] ?? null;
		} catch {
			return null;
		}
	}

	// ── Brand kit inline save ──────────────────────────────────────────
	async function handleBrandKitUpdate(updated: BrandKitState) {
		if (!project || isSavingKit) return;
		isSavingKit = true;
		try {
			await client.mutation(api.projects.update, {
				projectId,
				brandKit: updated,
				brandKitStrategy: "replace",
			});
		} catch (err) {
			console.error("Failed to save brand kit:", err);
			showUserError(err);
		} finally {
			isSavingKit = false;
		}
	}

	// ── Delete project ─────────────────────────────────────────────────
	async function handleDeleteProject() {
		isDeletingProject = true;
		try {
			await client.mutation(api.projects.remove, { projectId });
			goto("/projects");
		} catch (err) {
			console.error("Failed to delete project:", err);
			showUserError(err);
		} finally {
			isDeletingProject = false;
		}
	}

	let launchPostsState = $derived(project?.launchPostsGeneration ?? null);
	let pendingLaunchPostIds = $state<ReadonlySet<string>>(get(pendingLaunchPosts));
	$effect(() => {
		const unsub = pendingLaunchPosts.subscribe((s) => {
			pendingLaunchPostIds = s;
		});
		return unsub;
	});

	let isLaunchPostsBusy = $derived(
		pendingLaunchPostIds.has(projectId) || launchPostsState?.status === "generating"
	);

	$effect(() => {
		if (project?.launchPostsGeneration) {
			pendingLaunchPosts.delete(projectId);
		}
	});
	let hasInstagramCapture = $derived(
		Boolean(project?.lastInstagramSyncAt && project?.instagramContentDigest)
	);
	let canGenerateLaunchPosts = $derived(
		!!project && hasInstagramCapture && !launchPostsState && !project.isFetching
	);
	let launchPostsProgressPercent = $derived(
		launchPostsState
			? Math.max(
				0,
				Math.min(
					100,
					(launchPostsState.completedPosts / Math.max(launchPostsState.totalPosts, 1)) * 100
				)
			  )
			: 0
	);

	function formatLaunchPostsTimestamp(timestamp?: number): string | null {
		if (!timestamp) return null;
		return new Date(timestamp).toLocaleString("pt-BR", {
			day: "2-digit",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function getLaunchPostsTitle(): string {
		if (!project) return "Gerar 5 posts";
		if (project.isFetching && !hasInstagramCapture) return "Aguardando captura do Instagram";
		if (!hasInstagramCapture) return "Capture o Instagram para gerar 5 posts";
		if (pendingLaunchPostIds.has(projectId) && !launchPostsState) return "Preparando 5 posts";
		if (!launchPostsState) return "Gerar 5 posts";
		if (launchPostsState.status === "generating") return "Gerando posts automáticos";
		if (launchPostsState.status === "completed") return "5 posts criados e agendados";
		if (launchPostsState.status === "partial") return `${launchPostsState.completedPosts} posts criados nesta demo`;
		return "Geração automática encerrada";
	}

	function getLaunchPostsDescription(): string {
		if (project?.isFetching && !hasInstagramCapture) {
			return "Assim que a captura leve do Instagram terminar, a Vanda libera a demo automática de posts.";
		}
		if (!hasInstagramCapture) {
			return "A demo exige uma captura do feed para evitar repetição de temas e montar os 5 posts com o contexto certo.";
		}
		if (pendingLaunchPostIds.has(projectId) && !launchPostsState) {
			return "Montando ideias e contexto antes de gerar imagens e agendar no calendário. Você pode sair desta página — a Vanda continua em segundo plano.";
		}
		if (!launchPostsState) {
			return "Cria imagens, legendas e agenda automaticamente 5 posts no calendário, uma única vez por projeto.";
		}
		if (launchPostsState.status === "generating") {
			return `A Vanda está criando e agendando ${launchPostsState.totalPosts} posts. ${launchPostsState.completedPosts} já estão prontos.`;
		}
		if (launchPostsState.status === "completed") {
			return "Os 5 posts de demonstração já foram criados e colocados no calendário às 12:00.";
		}
		if (launchPostsState.status === "partial") {
			return launchPostsState.errorMessage
				? `Parte da geração concluiu. ${formatUserFacingMessageFromText(launchPostsState.errorMessage)}`
				: "Parte da geração concluiu, mas nem todos os 5 posts ficaram prontos.";
		}
		return launchPostsState.errorMessage
			? formatUserFacingMessageFromText(launchPostsState.errorMessage)
			: "A execução foi consumida e não pode ser rodada novamente neste projeto.";
	}

	function handleGenerateLaunchPosts() {
		if (!canGenerateLaunchPosts || isLaunchPostsBusy) return;
		pendingLaunchPosts.add(projectId);
		void client
			.action(api.ai.postIdeas.generateLaunchPostsForProject, { projectId })
			.catch((error) => {
				console.error("Failed to generate launch posts:", error);
				showUserError(error);
			})
			.finally(() => {
				pendingLaunchPosts.delete(projectId);
			});
	}

</script>

<svelte:head>
	<title>{project?.name ?? "Projeto"} - Vanda Studio</title>
</svelte:head>

<div
	class="brand-central min-h-screen"
	style={brandGlowColor ? `--brand-glow: ${brandGlowColor}` : ""}
	class:has-brand-glow={!!brandGlowColor}
>
	<SignedOut>
		<div class="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-20">
			<div class="max-w-md text-center">
				<h2 class="text-2xl font-semibold">Entre para ver este projeto</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					Faça login para acessar seu painel de marca.
				</p>
			</div>
			<SignInButton mode="modal">
				<button class="h-10 bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
					Entrar
				</button>
			</SignInButton>
		</div>
	</SignedOut>

	<SignedIn>
		{#if isLoading}
			<div class="flex min-h-screen items-center justify-center">
				<Sparkles class="h-8 w-8 animate-pulse text-primary" />
			</div>
		{:else if !project}
			<div class="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-20 text-center">
				<h3 class="text-lg font-medium">Projeto não encontrado</h3>
				<p class="max-w-md text-sm text-muted-foreground">
					Este projeto pode ter sido removido ou você não tem permissão para acessá-lo.
				</p>
				<Button variant="outline" onclick={() => goto("/projects")}>Voltar para projetos</Button>
			</div>
		{:else}
			<!-- ── Minimal top bar ── -->
			<header class="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
				<div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
					<button
						type="button"
						class="group flex items-center gap-2 text-muted-foreground/60 transition-colors hover:text-foreground"
						onclick={() => goto("/projects")}
					>
						<ArrowLeft class="h-4 w-4" />
						<span class="text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">Projetos</span>
					</button>

					<div class="flex items-center gap-3">
					{#if getLogoUrl()}
						<div class="h-7 w-7 overflow-hidden border border-border/50">
							<img src={getLogoUrl()} alt={project.name} class="h-full w-full object-cover" />
							</div>
						{/if}
						<h1
							class="text-sm font-semibold tracking-tight"
							style={brandKit.typographyPrimary ? `font-family: ${fontFamily(brandKit.typographyPrimary)}` : ""}
						>
							{project.name}
						</h1>
						{#if getHandle() && project.instagramUrl}
							<a
								href={project.instagramUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
							>
								@{getHandle()}
							</a>
						{/if}
					</div>

					<div class="flex items-center gap-1">
						<button
							type="button"
							class="p-2 text-muted-foreground/50 transition-colors hover:text-foreground"
							onclick={() => (showSettings = true)}
							aria-label="Configurações"
						>
							<Settings class="h-4 w-4" />
						</button>
						<button
							type="button"
							class="p-2 text-muted-foreground/30 transition-colors hover:text-destructive"
							onclick={() => (showDeleteConfirm = true)}
							aria-label="Excluir projeto"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				</div>
			</header>

			<!-- ── Main content ── -->
			<main class="relative z-10 mx-auto max-w-6xl px-6 py-8">

				<!-- Vanda Sugere -->
				<section class="entrance-section" style="--entrance-delay: 0ms">
					<div class="mb-6 flex items-center gap-3">
						<Sparkles class="h-4 w-4 text-primary" />
						<h2 class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/50">
							Vanda sugere
						</h2>
					</div>

					<div class="max-w-sm">
						<div
							class="suggestion-card launch-posts-card relative flex h-full min-h-[11rem] flex-col overflow-hidden border border-primary/30 bg-card"
							style="--card-delay: 0ms"
						>
							{#if isLaunchPostsBusy}
								<div
									class="flex min-h-[11rem] flex-1 flex-col items-center justify-center gap-10 bg-card px-4 py-8"
									aria-busy="true"
									aria-label="Gerando posts automáticos"
								>
									<ImageGenerationPulseLoader
										message="Gerando o pacote de posts do projeto"
										density="comfortable"
										showBar={false}
										class="pointer-events-none [&_p]:sr-only"
									/>
									<div class="relative h-1.5 w-full max-w-[11rem] overflow-hidden rounded-full bg-muted">
										{#if launchPostsState?.status === "generating"}
											<div
												class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
												style={`width: ${launchPostsProgressPercent}%`}
											></div>
										{:else}
											<div class="launch-posts-bar-sweep absolute inset-y-0 w-[42%] rounded-full bg-primary"></div>
										{/if}
									</div>
								</div>
							{:else}
								<div class="flex flex-1 flex-col gap-3 p-5">
									<div class="flex shrink-0 items-start justify-between gap-3">
										<div class="flex h-8 w-8 items-center justify-center border border-primary/25 bg-primary/5 text-primary">
											<CalendarDays class="h-4 w-4" />
										</div>
										{#if launchPostsState}
											<Badge class="text-[9px]">
												{launchPostsState.status === "generating"
													? "Gerando"
													: launchPostsState.status === "completed"
														? "Concluído"
														: launchPostsState.status === "partial"
															? "Parcial"
															: "Encerrado"}
											</Badge>
										{:else if pendingLaunchPostIds.has(projectId)}
											<Badge class="text-[9px]">Processando</Badge>
										{:else}
											<Badge class="text-[9px]">Demo</Badge>
										{/if}
									</div>

									<div class="min-h-[5.25rem] shrink-0">
										<h3 class="text-sm font-medium">{getLaunchPostsTitle()}</h3>
										<p class="mt-1 text-xs leading-relaxed text-muted-foreground/70 line-clamp-4">
											{getLaunchPostsDescription()}
										</p>
									</div>

									<div class="mt-auto shrink-0 space-y-2">
										{#if canGenerateLaunchPosts}
											<Button class="w-full" size="sm" onclick={handleGenerateLaunchPosts}>
												Gerar 5 posts
											</Button>
											<p class="text-[10px] text-muted-foreground/50">
												Uma execução por projeto · agenda às 12:00.
											</p>
										{:else if !hasInstagramCapture}
											<Button variant="outline" class="w-full" size="sm" onclick={() => (showSettings = true)} disabled={project.isFetching}>
												{project.isFetching ? "Capturando Instagram..." : "Abrir captura do Instagram"}
											</Button>
										{:else}
											<Button variant="outline" class="w-full" size="sm" onclick={() => goto("/calendar")}>
												Ver calendário
											</Button>
											{#if launchPostsState?.completedAt}
												<p class="text-[10px] text-muted-foreground/50">
													Última atualização: {formatLaunchPostsTimestamp(launchPostsState.completedAt)}
												</p>
											{/if}
										{/if}
									</div>
								</div>
							{/if}
						</div>
					</div>
				</section>

				<!-- Memória do Instagram (digest + captura única) -->
				<section class="entrance-section mt-10" style="--entrance-delay: 100ms">
					<InstagramIntelCard
						digest={project.instagramContentDigest ?? null}
						lastInstagramSyncAt={project.lastInstagramSyncAt}
						lastInstagramSyncMode={project.lastInstagramSyncMode}
						brandAccent={brandGlowColor}
						onOpenSettings={() => (showSettings = true)}
					/>
				</section>

				<!-- Gradient divider -->
				<div class="my-10 entrance-section" style="--entrance-delay: 200ms">
					<div
						class="h-px w-full"
						style={brandGlowColor
							? `background: linear-gradient(90deg, transparent, ${brandGlowColor}40, transparent)`
							: "background: var(--border)"}
					></div>
				</div>

				<!-- Brand Board -->
				<section class="entrance-section" style="--entrance-delay: 300ms">
					<BrandSummaryCard
						{brandKit}
						brandName={project.name}
						logoUrl={getLogoUrl()}
						onupdate={handleBrandKitUpdate}
					/>
					{#if isSavingKit}
						<p class="mt-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground/40 animate-pulse">
							Salvando...
						</p>
					{/if}
				</section>
			</main>
		{/if}
	</SignedIn>
</div>

<!-- ── Settings slide-over panel ── -->
{#if showSettings && project}
	<div class="fixed inset-0 z-50">
		<!-- Backdrop -->
		<div
			class="absolute inset-0 bg-black/40 backdrop-blur-sm settings-backdrop"
			onclick={() => (showSettings = false)}
			onkeydown={(event) => event.key === "Escape" && (showSettings = false)}
			role="button"
			tabindex="0"
		></div>

		<!-- Panel -->
		<div class="settings-panel absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-border bg-background shadow-2xl">
			<div class="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/90 px-6 py-4 backdrop-blur-sm">
				<h2 class="text-sm font-semibold">Configurações</h2>
				<button
					type="button"
					class="p-1 text-muted-foreground/50 transition-colors hover:text-foreground"
					onclick={() => (showSettings = false)}
				>
					<X class="h-4 w-4" />
				</button>
			</div>
			<div class="p-6">
				<ProjectSettingsForm {projectId} {project} />
			</div>
		</div>
	</div>
{/if}

<!-- ── Delete confirmation dialog ── -->
{#if showDeleteConfirm}
	<div
		class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
		onclick={() => (showDeleteConfirm = false)}
		onkeydown={(event) => event.key === "Escape" && (showDeleteConfirm = false)}
		role="button"
		tabindex="0"
	></div>

	<div class="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 border border-border bg-background p-6 shadow-xl">
		<h3 class="text-lg font-semibold">Excluir projeto?</h3>
		<p class="mt-2 text-sm text-muted-foreground">
			Isso remove o projeto e os dados associados. Use com cuidado.
		</p>
		<div class="mt-6 flex justify-end gap-3">
			<Button variant="outline" onclick={() => (showDeleteConfirm = false)} disabled={isDeletingProject}>
				Cancelar
			</Button>
			<Button variant="destructive" onclick={handleDeleteProject} disabled={isDeletingProject}>
				{isDeletingProject ? "Excluindo..." : "Excluir"}
			</Button>
		</div>
	</div>
{/if}

<style>
	.brand-central {
		position: relative;
		background: var(--background);
	}

	.brand-central.has-brand-glow::before {
		content: "";
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 0;
		background:
			radial-gradient(
				ellipse 60% 40% at 50% 0%,
				color-mix(in oklch, var(--brand-glow) 12%, transparent) 0%,
				transparent 70%
			),
			radial-gradient(
				ellipse 30% 50% at 95% 40%,
				color-mix(in oklch, var(--brand-glow) 6%, transparent) 0%,
				transparent 50%
			);
	}

	.entrance-section {
		animation: entranceReveal 0.6s ease both;
		animation-delay: var(--entrance-delay, 0ms);
	}

	@keyframes entranceReveal {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.suggestion-card {
		animation: cardEntrance 0.4s ease both;
		animation-delay: calc(var(--entrance-delay, 300ms) + var(--card-delay, 0ms));
	}

	@keyframes cardEntrance {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Settings panel slide-in */
	.settings-panel {
		animation: slideInRight 0.3s ease both;
	}
	.settings-backdrop {
		animation: backdropFadeIn 0.2s ease both;
	}

	@keyframes slideInRight {
		from { transform: translateX(100%); }
		to { transform: translateX(0); }
	}
	@keyframes backdropFadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes launchPostsBarSweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(320%);
		}
	}

	.launch-posts-bar-sweep {
		left: 0;
		animation: launchPostsBarSweep 1.4s ease-in-out infinite;
	}
</style>

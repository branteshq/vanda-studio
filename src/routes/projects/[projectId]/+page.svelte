<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { ProjectSettingsForm, InstagramIntelCard } from "$lib/components/projects";
	import { BrandSummaryCard } from "$lib/components/wizard";
	import { Badge, Button } from "$lib/components/ui";
	import { emptyBrandKit, type BrandKitState } from "$lib/types/brandKit";
	import { loadGoogleFont, fontFamily } from "$lib/utils";
	import { api } from "../../../convex/_generated/api.js";
	import type { Id } from "../../../convex/_generated/dataModel.js";
	import { useConvexClient, useQuery } from "convex-svelte";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import {
		ArrowLeft,
		Settings,
		Trash2,
		X,
		Sparkles,
		Palette,
		PenLine,
		ImagePlus,
		CalendarDays,
		TrendingUp,
		ArrowRight,
	} from "lucide-svelte";

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
		} finally {
			isDeletingProject = false;
		}
	}

	// ── Vanda Sugere — mock suggestions ────────────────────────────────
	type Suggestion = {
		icon: typeof Palette;
		title: string;
		description: string;
		href?: string;
		comingSoon?: boolean;
	};

	let suggestions = $derived<Suggestion[]>([
		{
			icon: Palette,
			title: "Criar um logo",
			description: "Gere um logotipo que reflete sua identidade visual.",
			comingSoon: true,
		},
		{
			icon: PenLine,
			title: "Escrever primeiro post",
			description: "Crie conteúdo com o tom de voz da sua marca.",
			href: `/posts/create?projectId=${projectId}`,
		},
		{
			icon: ImagePlus,
			title: "Gerar imagem",
			description: "Produza imagens alinhadas com seu estilo.",
			href: `/images?projectId=${projectId}`,
		},
		{
			icon: CalendarDays,
			title: "Agendar conteúdo",
			description: "Monte um calendário editorial semanal.",
			comingSoon: true,
		},
		{
			icon: TrendingUp,
			title: "Analisar concorrentes",
			description: "Descubra oportunidades no seu mercado.",
			comingSoon: true,
		},
	]);
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

					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
						{#each suggestions as suggestion, i}
							{@const Icon = suggestion.icon}
							{#if suggestion.href && !suggestion.comingSoon}
								<a
									href={suggestion.href}
									class="suggestion-card group relative flex flex-col gap-3 border border-border bg-card p-5 transition-all hover:border-foreground/20"
									style="--card-delay: {i * 60}ms"
								>
									<div class="flex items-center justify-between">
										<div class="flex h-8 w-8 items-center justify-center border border-border/50 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary">
											<Icon class="h-4 w-4" />
										</div>
										<ArrowRight class="h-3 w-3 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
									</div>
									<div>
										<h3 class="text-sm font-medium">{suggestion.title}</h3>
										<p class="mt-1 text-xs leading-relaxed text-muted-foreground/70">{suggestion.description}</p>
									</div>
								</a>
							{:else}
								<div
									class="suggestion-card group relative flex flex-col gap-3 border border-border/50 bg-card/50 p-5 opacity-60"
									style="--card-delay: {i * 60}ms"
								>
									<div class="flex items-center justify-between">
										<div class="flex h-8 w-8 items-center justify-center border border-border/30 text-muted-foreground/50">
											<Icon class="h-4 w-4" />
										</div>
										<Badge class="text-[9px]">Em breve</Badge>
									</div>
									<div>
										<h3 class="text-sm font-medium text-foreground/70">{suggestion.title}</h3>
										<p class="mt-1 text-xs leading-relaxed text-muted-foreground/50">{suggestion.description}</p>
									</div>
								</div>
							{/if}
						{/each}
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
</style>

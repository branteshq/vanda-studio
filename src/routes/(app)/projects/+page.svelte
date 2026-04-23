<script lang="ts">
	import { goto } from "$app/navigation";
	import Navbar from "$lib/components/Navbar.svelte";
	import { Button } from "$lib/components/ui";
	import { formatUserFacingMessage, showUserError } from "$lib/errors";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import { useConvexClient, useQuery } from "convex-svelte";
	import type { FunctionReturnType } from "convex/server";
	import {
		AlertCircle,
		CalendarDays,
		CheckCircle2,
		ChevronRight,
		ExternalLink,
		Instagram,
		Lightbulb,
		Loader2,
		MoreHorizontal,
		Plus,
		RefreshCw,
		Search,
		SquarePen,
		Layers3,
		Trash2,
	} from "lucide-svelte";
	import { api } from "../../../convex/_generated/api.js";
	import type { Id } from "../../../convex/_generated/dataModel.js";

	type ProjectSummary = FunctionReturnType<typeof api.projects.listSummaries>[number];
	type FilterMode = "all" | "connected" | "attention";
	type ProjectStatus = "connected" | "disconnected" | "attention";

	const client = useConvexClient();
	const projectsQuery = useQuery(api.projects.listSummaries, () => ({}));

	let search = $state("");
	let filter = $state<FilterMode>("all");
	let deleteConfirmId = $state<Id<"projects"> | null>(null);
	let isDeleting = $state(false);
	let syncingProjectId = $state<Id<"projects"> | "all" | null>(null);
	let actionError = $state<string | null>(null);

	let projects = $derived((projectsQuery.data ?? []) as ProjectSummary[]);
	let isLoading = $derived(projectsQuery.isLoading);
	let filteredProjects = $derived(
		projects.filter((project) => {
			const haystack = `${project.name} ${project.instagramHandle ?? ""} ${project.instagramConnection?.handle ?? ""}`.toLowerCase();
			const matchesSearch = haystack.includes(search.trim().toLowerCase());
			const status = getStatus(project);
			const matchesFilter =
				filter === "all" ||
				(filter === "connected" && status === "connected") ||
				(filter === "attention" && status === "attention");
			return matchesSearch && matchesFilter;
		})
	);
	let connectedCount = $derived(projects.filter((project) => getStatus(project) === "connected").length);
	let attentionCount = $derived(projects.filter((project) => getStatus(project) === "attention").length);
	let syncableCount = $derived(projects.filter((project) => getStatus(project) !== "disconnected").length);

	function getStatus(project: ProjectSummary): ProjectStatus {
		if (project.instagramConnection?.lastError) return "attention";
		if (project.instagramConnection?.status === "connected") return "connected";
		return "disconnected";
	}

	function getHandle(project: ProjectSummary): string | null {
		if (project.instagramConnection?.handle) return project.instagramConnection.handle;
		if (project.instagramHandle) return project.instagramHandle;
		if (!project.instagramUrl) return null;
		try {
			const url = new URL(project.instagramUrl);
			return url.pathname.split("/").filter(Boolean)[0] ?? null;
		} catch {
			return null;
		}
	}

	function getAvatar(project: ProjectSummary): string | null {
		return project.logoStorageUrl ?? project.profilePictureStorageUrl ?? project.profilePictureUrl ?? null;
	}

	function formatSync(project: ProjectSummary): string {
		const status = getStatus(project);
		if (status === "disconnected") return "Instagram não conectado";
		if (project.instagramConnection?.lastError) return "Falha na última sincronização";
		const stamp = project.instagramConnection?.lastSyncAt ?? project.lastInstagramSyncAt;
		if (!stamp) return "Aguardando primeira sincronização";
		const minutes = Math.max(1, Math.round((Date.now() - stamp) / 60000));
		if (minutes < 60) return `Sincronizado há ${minutes} min`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `Sincronizado há ${hours} h`;
		return `Sincronizado há ${Math.round(hours / 24)} d`;
	}

	function followerMetric(project: ProjectSummary): string {
		const current = project.metrics.followersCount;
		const delta = project.metrics.followersDelta;
		if (!current || delta === null) return "—";
		const previous = current - delta;
		if (previous <= 0) return delta >= 0 ? "+100%" : "—";
		return formatPercent(delta / previous);
	}

	function engagementMetric(project: ProjectSummary): string {
		const engagement = project.metrics.avgEngagement;
		if (engagement === null) return "—";
		return formatPercent(engagement);
	}

	function formatPercent(value: number): string {
		const percent = value * 100;
		const sign = percent > 0 ? "+" : "";
		return `${sign}${percent.toLocaleString("pt-BR", {
			maximumFractionDigits: 1,
			minimumFractionDigits: 1,
		})}%`;
	}

	function isPositiveMetric(value: string): boolean {
		return value.startsWith("+");
	}

	function recommendationsCount(project: ProjectSummary): number {
		return project.brandIntelligence?.recommendationNotes.length ?? 0;
	}

	function draftCount(project: ProjectSummary): number {
		return Math.max(0, project.postCount - project.scheduledCount - project.publishedCount);
	}

	function nextPostLabel(project: ProjectSummary): string {
		if (project.scheduledCount > 0) return "Próximo post agendado";
		if (getStatus(project) === "connected") return "Crie ou agende o próximo conteúdo";
		return "Conecte o Instagram para importar conteúdo, métricas e gerar estratégia.";
	}

	function sparkPath(project: ProjectSummary, kind: "followers" | "engagement"): string {
		const seed = Array.from(project._id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
		const positive = kind === "followers"
			? isPositiveMetric(followerMetric(project))
			: isPositiveMetric(engagementMetric(project));
		const neutral = kind === "followers"
			? followerMetric(project) === "—"
			: engagementMetric(project) === "—";
		const points = Array.from({ length: 13 }, (_, index) => {
			const wave = Math.sin((seed + index * 19) * 0.55) * 5;
			const drift = neutral ? 0 : positive ? -index * 0.9 : index * 0.8;
			const y = 24 + wave + drift;
			return `${index * 8},${Math.max(5, Math.min(42, y))}`;
		});
		return `M ${points.join(" L ")}`;
	}

	async function syncProject(project: ProjectSummary) {
		if (!project.instagramConnection || getStatus(project) === "disconnected") {
			goto(`/integrations/instagram/connect?projectId=${project._id}`);
			return;
		}
		syncingProjectId = project._id;
		actionError = null;
		try {
			await client.action(api.instagramGraphActions.importProjectPosts, {
				projectId: project._id,
				limit: 30,
			});
		} catch (err) {
			actionError = formatUserFacingMessage(err);
		} finally {
			syncingProjectId = null;
		}
	}

	async function syncAll() {
		const connected = projects.filter((project) => getStatus(project) !== "disconnected");
		if (connected.length === 0) return;
		syncingProjectId = "all";
		actionError = null;
		try {
			for (const project of connected) {
				await client.action(api.instagramGraphActions.importProjectPosts, {
					projectId: project._id,
					limit: 30,
				});
			}
		} catch (err) {
			actionError = formatUserFacingMessage(err);
		} finally {
			syncingProjectId = null;
		}
	}

	function connectProject(project: ProjectSummary) {
		goto(`/integrations/instagram/connect?projectId=${project._id}`);
	}

	function openProject(project: ProjectSummary) {
		goto(`/projects/${project._id}`);
	}

	function createPost(project: ProjectSummary) {
		goto(`/library?projectId=${project._id}`);
	}

	function requestDelete(projectId: Id<"projects">, event: MouseEvent) {
		event.stopPropagation();
		deleteConfirmId = projectId;
	}

	async function confirmDelete() {
		if (!deleteConfirmId) return;
		isDeleting = true;
		try {
			await client.mutation(api.projects.remove, { projectId: deleteConfirmId });
			deleteConfirmId = null;
		} catch (err) {
			showUserError(err);
		} finally {
			isDeleting = false;
		}
	}
</script>

<svelte:head>
	<title>Projetos - Vanda Studio</title>
</svelte:head>

<div class="min-h-screen bg-[#0f1014] text-zinc-100">
	<Navbar />

	<main class="relative overflow-hidden">
		<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_8%,rgba(219,39,119,0.15),transparent_35%),radial-gradient(circle_at_24%_45%,rgba(20,184,166,0.05),transparent_34%)]"></div>
		<div class="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.9)_1px,transparent_1px)] [background-size:28px_28px]"></div>

		<SignedOut>
			<section class="relative flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-20">
				<div class="max-w-md border border-zinc-800 bg-zinc-950/70 p-8 text-center shadow-2xl">
					<h1 class="font-serif text-4xl font-semibold text-white">Entre para ver seus projetos</h1>
					<p class="mt-3 text-sm text-zinc-400">Faça login para gerenciar marcas, métricas e publicações.</p>
					<SignInButton mode="modal">
						<button class="mt-7 inline-flex h-11 items-center justify-center bg-pink-500 px-6 text-sm font-semibold text-white hover:bg-pink-400">
							Entrar
						</button>
					</SignInButton>
				</div>
			</section>
		</SignedOut>

		<SignedIn>
			<section class="relative border-b border-zinc-800/90 px-8 py-5 lg:px-10">
				<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<div>
						<h1 class="font-serif text-3xl font-semibold leading-none tracking-[-0.02em] text-white md:text-4xl">
							Projetos
						</h1>
						<p class="mt-2 text-sm text-zinc-400">
							Cada projeto é um workspace de marca conectado ao Instagram
						</p>
					</div>

					<div class="flex flex-wrap items-center gap-4">
						<button
							type="button"
							class="inline-flex h-12 items-center gap-3 border border-zinc-700 bg-zinc-950/40 px-7 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
							onclick={syncAll}
							disabled={syncingProjectId === "all" || syncableCount === 0}
						>
							{#if syncingProjectId === "all"}
								<Loader2 class="h-4 w-4 animate-spin" />
							{:else}
								<RefreshCw class="h-4 w-4" />
							{/if}
							Sincronizar tudo
						</button>
						<button
							type="button"
							class="inline-flex h-12 items-center gap-3 bg-pink-500 px-7 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(236,72,153,0.22)] transition hover:bg-pink-400"
							onclick={() => goto("/projects/new")}
						>
							<Plus class="h-4 w-4" />
							Novo projeto
						</button>
					</div>
				</div>
			</section>

			<section class="relative px-8 py-6 lg:px-10">
				<div class="grid gap-5 xl:grid-cols-[1fr_auto] xl:items-center">
					<div class="flex flex-col gap-4 md:flex-row">
						<label class="flex h-12 min-w-0 flex-1 items-center gap-3 border border-zinc-800 bg-zinc-950/45 px-4 text-zinc-400 md:max-w-sm">
							<Search class="h-5 w-5" />
							<input
								bind:value={search}
								class="h-full min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
								placeholder="Buscar projeto..."
							/>
						</label>

						<div class="flex h-12 border border-zinc-800 bg-zinc-950/35 p-0">
							<button
								type="button"
								class="border-r border-zinc-800 px-5 text-sm font-semibold transition {filter === 'all' ? 'border-pink-500/60 bg-pink-500/10 text-pink-400' : 'text-zinc-300 hover:bg-zinc-900'}"
								onclick={() => filter = "all"}
							>
								Todos
							</button>
							<button
								type="button"
								class="border-r border-zinc-800 px-5 text-sm font-semibold transition {filter === 'connected' ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-300 hover:bg-zinc-900'}"
								onclick={() => filter = "connected"}
							>
								<span class="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500"></span>Conectados
							</button>
							<button
								type="button"
								class="px-5 text-sm font-semibold transition {filter === 'attention' ? 'bg-red-500/10 text-red-400' : 'text-zinc-300 hover:bg-zinc-900'}"
								onclick={() => filter = "attention"}
							>
								<span class="mr-2 inline-block h-2 w-2 rounded-full bg-red-500"></span>Atenção
							</button>
						</div>
					</div>

					<div class="grid gap-3 sm:grid-cols-3">
						<div class="flex min-w-56 items-center gap-4 border border-zinc-800 bg-zinc-950/35 px-5 py-4">
							<Layers3 class="h-6 w-6 text-zinc-100" />
							<div>
								<p class="text-base font-semibold text-white">{projects.length} projetos</p>
								<p class="text-sm text-zinc-500">Total de workspaces</p>
							</div>
						</div>
						<div class="flex min-w-56 items-center gap-4 border border-zinc-800 bg-zinc-950/35 px-5 py-4">
							<CheckCircle2 class="h-6 w-6 text-emerald-500" />
							<div>
								<p class="text-base font-semibold text-white">{connectedCount} conectados</p>
								<p class="text-sm text-zinc-500">Sincronizados</p>
							</div>
						</div>
						<div class="flex min-w-56 items-center gap-4 border border-zinc-800 bg-zinc-950/35 px-5 py-4">
							<AlertCircle class="h-6 w-6 text-red-500" />
							<div>
								<p class="text-base font-semibold text-white">{attentionCount} precisa reconectar</p>
								<p class="text-sm text-zinc-500">Atenção necessária</p>
							</div>
						</div>
					</div>
				</div>

				{#if actionError}
					<div class="mt-5 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
						{actionError}
					</div>
				{/if}
			</section>

			<section class="relative px-8 pb-10 lg:px-10">
				{#if isLoading}
					<div class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
						{#each Array.from({ length: 6 }) as _, index}
							<div class="h-[306px] animate-pulse border border-zinc-800 bg-zinc-900/35" aria-label={`Carregando projeto ${index + 1}`}></div>
						{/each}
					</div>
				{:else if projects.length === 0}
					<div class="flex min-h-[420px] items-center justify-center border border-dashed border-pink-500/40 bg-zinc-950/30">
						<div class="max-w-sm text-center">
							<div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-pink-500 text-pink-400">
								<Plus class="h-8 w-8" />
							</div>
							<h2 class="mt-6 font-serif text-2xl font-semibold text-white">Adicionar novo projeto</h2>
							<p class="mt-3 text-sm leading-6 text-zinc-400">
								Conecte uma nova marca ao Instagram e comece a gerenciar conteúdo, métricas e estratégia em um só lugar.
							</p>
							<Button class="mt-6 bg-pink-500 text-white hover:bg-pink-400" onclick={() => goto("/projects/new")}>
								<Plus class="mr-2 h-4 w-4" />
								Novo projeto
							</Button>
						</div>
					</div>
				{:else}
					<div class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
						{#each filteredProjects as project (project._id)}
							{@const status = getStatus(project)}
							{@const handle = getHandle(project)}
							{@const avatar = getAvatar(project)}
							{@const followers = followerMetric(project)}
							{@const engagement = engagementMetric(project)}
							<article
								class="group border border-zinc-800 bg-zinc-950/35 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.16)] transition hover:border-zinc-700 hover:bg-zinc-900/45"
							>
								<div class="flex items-start gap-4">
									<button
										type="button"
										class="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-900"
										onclick={() => openProject(project)}
										aria-label={`Abrir ${project.name}`}
									>
										{#if avatar}
											<img src={avatar} alt={project.name} class="h-full w-full object-cover" />
										{:else}
											<span class="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-400">
												{project.name.charAt(0).toUpperCase()}
											</span>
										{/if}
									</button>

									<div class="min-w-0 flex-1 pt-2">
										<div class="flex items-start justify-between gap-3">
											<div class="min-w-0">
												<h2 class="truncate font-serif text-xl font-semibold text-white">{project.name}</h2>
												<p class="mt-1 truncate text-sm text-zinc-400">
													{handle ? `@${handle}` : "Instagram não conectado"}
												</p>
											</div>
											<button
												type="button"
												class="text-zinc-400 transition hover:text-white"
												aria-label="Excluir projeto"
												onclick={(event) => requestDelete(project._id, event)}
											>
												<MoreHorizontal class="h-5 w-5" />
											</button>
										</div>

										<div class="mt-3 flex flex-wrap items-center gap-2">
											{#if status === "connected"}
												<span class="inline-flex items-center gap-2 border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
													<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
													Conectado
												</span>
											{:else if status === "attention"}
												<span class="inline-flex items-center gap-2 border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-400">
													<span class="h-2 w-2 rounded-full bg-red-500"></span>
													Erro de sincronização
												</span>
											{:else}
												<span class="inline-flex items-center gap-2 border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-400">
													<span class="h-2 w-2 rounded-full bg-zinc-500"></span>
													Não conectado
												</span>
											{/if}
											<span class="text-xs {status === 'attention' ? 'text-red-400' : status === 'connected' ? 'text-zinc-400' : 'text-zinc-500'}">
												{formatSync(project)}
											</span>
										</div>
									</div>
								</div>

								<div class="mt-5 grid grid-cols-2 border-y border-zinc-800">
									<div class="border-r border-zinc-800 py-3 pr-4">
										<p class="text-xs text-zinc-500">Seguidores</p>
										<div class="mt-2 flex items-end justify-between gap-3">
											<div>
												<p class="text-xl font-semibold {isPositiveMetric(followers) ? 'text-white' : followers.startsWith('-') ? 'text-red-400' : 'text-zinc-300'}">{followers}</p>
												<p class="text-xs text-zinc-500">30d</p>
											</div>
											<svg viewBox="0 0 96 48" class="h-9 w-24 overflow-visible">
												<path d={sparkPath(project, "followers")} fill="none" stroke={status === "attention" ? "#ef4444" : "#22c55e"} stroke-width="2" />
												<path d={`${sparkPath(project, "followers")} L 96 48 L 0 48 Z`} fill={status === "attention" ? "rgba(239,68,68,.14)" : "rgba(34,197,94,.14)"} />
											</svg>
										</div>
									</div>
									<div class="py-3 pl-4">
										<p class="text-xs text-zinc-500">Engajamento</p>
										<div class="mt-2 flex items-end justify-between gap-3">
											<div>
												<p class="text-xl font-semibold {isPositiveMetric(engagement) ? 'text-white' : engagement.startsWith('-') ? 'text-red-400' : 'text-zinc-300'}">{engagement}</p>
												<p class="text-xs text-zinc-500">30d</p>
											</div>
											<svg viewBox="0 0 96 48" class="h-9 w-24 overflow-visible">
												<path d={sparkPath(project, "engagement")} fill="none" stroke={status === "attention" ? "#ef4444" : "#22c55e"} stroke-width="2" />
												<path d={`${sparkPath(project, "engagement")} L 96 48 L 0 48 Z`} fill={status === "attention" ? "rgba(239,68,68,.14)" : "rgba(34,197,94,.14)"} />
											</svg>
										</div>
									</div>
								</div>

								<div class="grid grid-cols-2 border-b border-zinc-800 py-4">
									<div class="flex items-center gap-3 border-r border-zinc-800">
										<CalendarDays class="h-5 w-5 text-zinc-200" />
										<div>
											<p class="text-lg font-semibold text-white">{project.scheduledCount || draftCount(project)}</p>
											<p class="text-xs text-zinc-400">{project.scheduledCount ? "agendados" : "rascunhos"}</p>
										</div>
									</div>
									<div class="flex items-center gap-3 pl-5">
										<Lightbulb class="h-5 w-5 text-zinc-200" />
										<div>
											<p class="text-lg font-semibold text-white">{recommendationsCount(project)}</p>
											<p class="text-xs text-zinc-400">{recommendationsCount(project) === 1 ? "recomendação" : "recomendações"}</p>
										</div>
									</div>
								</div>

								<button
									type="button"
									class="mt-4 flex w-full items-center justify-between border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-left text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
									onclick={() => status === "disconnected" ? connectProject(project) : openProject(project)}
								>
									<span class="flex min-w-0 items-center gap-3">
										{#if status === "disconnected"}
											<AlertCircle class="h-5 w-5 shrink-0 text-zinc-500" />
										{:else}
											<CalendarDays class="h-5 w-5 shrink-0 text-zinc-500" />
										{/if}
										<span class="truncate">{nextPostLabel(project)}</span>
									</span>
									<ChevronRight class="h-4 w-4 shrink-0" />
								</button>

								<div class="mt-4 grid grid-cols-3 gap-3">
									{#if status === "disconnected"}
										<button
											type="button"
											class="col-span-2 inline-flex h-10 items-center justify-center gap-2 bg-pink-500 px-3 text-sm font-semibold text-white transition hover:bg-pink-400"
											onclick={() => connectProject(project)}
										>
											<Instagram class="h-4 w-4" />
											Conectar Instagram
										</button>
									{:else if status === "attention"}
										<button
											type="button"
											class="inline-flex h-10 items-center justify-center gap-2 bg-pink-500 px-3 text-sm font-semibold text-white transition hover:bg-pink-400"
											onclick={() => connectProject(project)}
										>
											<RefreshCw class="h-4 w-4" />
											Reconectar
										</button>
										<button
											type="button"
											class="inline-flex h-10 items-center justify-center gap-2 border border-zinc-700 px-3 text-sm font-semibold text-white transition hover:bg-zinc-900 disabled:opacity-60"
											disabled={syncingProjectId === project._id}
											onclick={() => syncProject(project)}
										>
											{#if syncingProjectId === project._id}
												<Loader2 class="h-4 w-4 animate-spin" />
											{:else}
												<RefreshCw class="h-4 w-4" />
											{/if}
											Sinc.
										</button>
									{:else}
										<button
											type="button"
											class="inline-flex h-10 items-center justify-center gap-2 border border-zinc-700 px-3 text-sm font-semibold text-white transition hover:bg-zinc-900"
											onclick={() => openProject(project)}
										>
											<ExternalLink class="h-4 w-4" />
											Abrir
										</button>
										<button
											type="button"
											class="inline-flex h-10 items-center justify-center gap-2 border border-zinc-700 px-3 text-sm font-semibold text-white transition hover:bg-zinc-900 disabled:opacity-60"
											disabled={syncingProjectId === project._id}
											onclick={() => syncProject(project)}
										>
											{#if syncingProjectId === project._id}
												<Loader2 class="h-4 w-4 animate-spin" />
											{:else}
												<RefreshCw class="h-4 w-4" />
											{/if}
											Sinc.
										</button>
									{/if}
									<button
										type="button"
										class="inline-flex h-10 items-center justify-center gap-2 border border-zinc-700 px-3 text-sm font-semibold text-white transition hover:bg-zinc-900"
										onclick={() => status === "disconnected" ? openProject(project) : createPost(project)}
									>
										<SquarePen class="h-4 w-4" />
										{status === "disconnected" ? "Abrir" : "Criar"}
									</button>
								</div>
							</article>
						{/each}

						<button
							type="button"
							class="flex min-h-[306px] flex-col items-center justify-center border border-dashed border-pink-500/45 bg-zinc-950/20 p-8 text-center transition hover:bg-pink-500/5"
							onclick={() => goto("/projects/new")}
						>
							<span class="flex h-16 w-16 items-center justify-center rounded-full border border-pink-500 text-pink-400">
								<Plus class="h-8 w-8" />
							</span>
							<span class="mt-7 font-serif text-xl font-semibold text-white">Adicionar novo projeto</span>
							<span class="mt-3 max-w-xs text-sm leading-6 text-zinc-400">
								Conecte uma nova marca no Instagram e comece a gerenciar conteúdo, métricas e estratégia em um só lugar.
							</span>
							<span class="mt-8 inline-flex h-11 items-center gap-2 bg-pink-500 px-6 text-sm font-semibold text-white">
								<Plus class="h-4 w-4" />
								Novo projeto
							</span>
						</button>
					</div>

					{#if filteredProjects.length === 0}
						<div class="mt-6 border border-zinc-800 bg-zinc-950/35 px-5 py-8 text-center text-sm text-zinc-400">
							Nenhum projeto corresponde aos filtros atuais.
						</div>
					{/if}
				{/if}
			</section>
		</SignedIn>
	</main>
</div>

{#if deleteConfirmId}
	<div
		class="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm"
		onclick={() => deleteConfirmId = null}
		onkeydown={(event) => event.key === "Enter" && (deleteConfirmId = null)}
		role="button"
		tabindex="0"
	></div>

	<div class="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 border border-zinc-800 bg-[#111216] p-6 text-zinc-100 shadow-2xl">
		<div class="flex items-start gap-3">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center border border-red-500/30 bg-red-500/10 text-red-400">
				<Trash2 class="h-5 w-5" />
			</div>
			<div>
				<h3 class="font-serif text-xl font-semibold text-white">Excluir projeto?</h3>
				<p class="mt-2 text-sm leading-6 text-zinc-400">
					Esta ação irá excluir o projeto e todos os posts associados permanentemente.
				</p>
			</div>
		</div>
		<div class="mt-6 flex justify-end gap-3">
			<Button variant="outline" onclick={() => deleteConfirmId = null} disabled={isDeleting}>
				Cancelar
			</Button>
			<Button variant="destructive" onclick={confirmDelete} disabled={isDeleting}>
				{isDeleting ? "Excluindo..." : "Excluir"}
			</Button>
		</div>
	</div>
{/if}

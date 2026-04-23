<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import Navbar from "$lib/components/Navbar.svelte";
	import { ProjectSettingsForm } from "$lib/components/projects";
	import { Badge, Button } from "$lib/components/ui";
	import { formatUserFacingMessage } from "$lib/errors";
	import { api } from "../../../../convex/_generated/api.js";
	import type { Id } from "../../../../convex/_generated/dataModel.js";
	import { useConvexClient, useQuery } from "convex-svelte";
	import type { FunctionReturnType } from "convex/server";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import {
		BarChart3,
		CalendarDays,
		Check,
		ChevronRight,
		Circle,
		Cog,
		ExternalLink,
		Instagram,
		LayoutDashboard,
		Lightbulb,
		Loader2,
		Plus,
		RefreshCw,
		SquarePen,
		Target,
		TrendingUp,
	} from "lucide-svelte";

	type ProjectDetail = FunctionReturnType<typeof api.projects.get>;
	type ProjectSummary = FunctionReturnType<typeof api.projects.listSummaries>[number];
	type SocialPost = FunctionReturnType<typeof api.socialPosts.listByProject>[number];
	type GeneratedPost = FunctionReturnType<typeof api.scheduledPosts.getProjectPosts>[number];
	type TabId = "overview" | "instagram" | "strategy" | "calendar" | "posts" | "settings";

	const client = useConvexClient();
	let projectId = $derived($page.params.projectId as Id<"projects">);

	const projectQuery = useQuery(api.projects.get, () => ({ projectId }));
	let projectFallback = $state<ProjectDetail | undefined>(undefined);
	let projectLoadError = $state<string | null>(null);

	$effect(() => {
		const id = projectId;
		let cancelled = false;
		projectFallback = undefined;
		projectLoadError = null;

		const timeout = window.setTimeout(() => {
			if (cancelled || projectFallback !== undefined) return;
			projectLoadError = "A consulta do projeto demorou mais que o esperado. Verifique a sessão/Convex e tente recarregar.";
			projectFallback = null;
		}, 8000);

		void client
			.query(api.projects.get, { projectId: id })
			.then((data) => {
				if (cancelled) return;
				window.clearTimeout(timeout);
				projectFallback = data;
			})
			.catch((err) => {
				if (cancelled) return;
				window.clearTimeout(timeout);
				projectLoadError = formatUserFacingMessage(err);
				projectFallback = null;
			});

		return () => {
			cancelled = true;
			window.clearTimeout(timeout);
		};
	});

	let project = $derived(projectQuery.data !== undefined ? projectQuery.data : projectFallback);

	// Keep the critical route query isolated. These aggregate/detail queries should
	// not start until the project exists; otherwise one slow subscription can make
	// the first paint feel like the whole route is stuck.
	const summariesQuery = useQuery(api.projects.listSummaries, () => (project ? {} : "skip"));
	const socialPostsQuery = useQuery(api.socialPosts.listByProject, () => (project ? { projectId, limit: 24 } : "skip"));
	const generatedPostsQuery = useQuery(api.scheduledPosts.getProjectPosts, () => (project ? { projectId, limit: 50 } : "skip"));

	let summary = $derived((summariesQuery.data ?? []).find((item) => item._id === projectId) as ProjectSummary | undefined);
	let socialPosts = $derived((socialPostsQuery.data ?? []) as SocialPost[]);
	let generatedPosts = $derived((generatedPostsQuery.data ?? []) as GeneratedPost[]);
	// Only gate the page shell on the direct project query. Summary data is additive
	// and can arrive later; otherwise a slow/stuck aggregate query leaves the whole
	// detail route on the spinner even though the project itself loaded.
	let isLoading = $derived(project === undefined && !projectQuery.error && !projectLoadError);

	let activeTab = $state<TabId>("overview");
	let isSyncing = $state(false);
	let isGeneratingStrategy = $state(false);
	let actionError = $state<string | null>(null);

	const tabs: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
		{ id: "overview", label: "Visão Geral", icon: LayoutDashboard },
		{ id: "instagram", label: "Instagram", icon: Instagram },
		{ id: "strategy", label: "Estratégia", icon: BarChart3 },
		{ id: "calendar", label: "Calendário", icon: CalendarDays },
		{ id: "posts", label: "Posts", icon: SquarePen },
		{ id: "settings", label: "Configurações", icon: Cog },
	];

	let upcomingPosts = $derived(
		generatedPosts
			.filter((post) => post.scheduledFor && post.scheduledFor >= Date.now() && post.schedulingStatus === "scheduled")
			.sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))
	);
	let publishedGeneratedPosts = $derived(generatedPosts.filter((post) => post.schedulingStatus === "posted"));
	let failedGeneratedPosts = $derived(generatedPosts.filter((post) => post.schedulingStatus === "publish_failed"));
	let postsThisMonth = $derived(generatedPosts.filter((post) => isThisMonth(post.publishedAt ?? post.scheduledFor ?? post.createdAt)).length);
	let publicationRate = $derived(generatedPosts.length > 0 ? publishedGeneratedPosts.length / generatedPosts.length : null);
	let totalInteractions = $derived(socialPosts.reduce((sum, post) => sum + (post.likeCount ?? 0) + (post.commentsCount ?? 0), 0));
	let bestPost = $derived([...socialPosts].sort((a, b) => postScore(b) - postScore(a))[0] ?? null);

	function getAvatar(): string | null {
		return project?.logoStorageUrl ?? project?.profilePictureStorageUrl ?? project?.profilePictureUrl ?? null;
	}

	function getHandle(): string | null {
		if (project?.instagramConnection?.handle) return project.instagramConnection.handle;
		if (project?.instagramHandle) return project.instagramHandle;
		if (!project?.instagramUrl) return null;
		try {
			return new URL(project.instagramUrl).pathname.split("/").filter(Boolean)[0] ?? null;
		} catch {
			return null;
		}
	}

	function isConnected(): boolean {
		return project?.instagramConnection?.status === "connected";
	}

	function formatSync(): string {
		if (!isConnected()) return "Instagram não conectado";
		if (project?.instagramConnection?.lastError) return "Falha na última sincronização";
		const stamp = project?.instagramConnection?.lastSyncAt ?? project?.lastInstagramSyncAt;
		if (!stamp) return "Aguardando primeira sincronização";
		const minutes = Math.max(1, Math.round((Date.now() - stamp) / 60000));
		if (minutes < 60) return `Última sincronização: há ${minutes} min`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `Última sincronização: há ${hours} h`;
		return `Última sincronização: há ${Math.round(hours / 24)} d`;
	}

	function formatNumber(value: number | null | undefined): string {
		if (value === null || value === undefined) return "—";
		return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
	}

	function formatPercent(value: number | null | undefined, signed = false): string {
		if (value === null || value === undefined) return "—";
		const percent = value * 100;
		const sign = signed && percent > 0 ? "+" : "";
		return `${sign}${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
	}

	function followerGrowth(): number | null {
		const delta = summary?.metrics.followersDelta;
		const current = summary?.metrics.followersCount;
		if (delta === null || delta === undefined || !current) return null;
		const previous = current - delta;
		return previous > 0 ? delta / previous : null;
	}

	function recommendationCount(): number {
		return summary?.brandIntelligence?.recommendationNotes.length ?? project?.brandIntelligence?.recommendationNotes.length ?? 0;
	}

	function postScore(post: SocialPost): number {
		return (post.likeCount ?? 0) + (post.commentsCount ?? 0) * 2 + (post.engagementScore ?? 0) * 1000;
	}

	function formatDate(value: number | undefined): string {
		if (!value) return "Sem data";
		return new Intl.DateTimeFormat("pt-BR", {
			day: "2-digit",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(value));
	}

	function isThisMonth(value: number): boolean {
		const date = new Date(value);
		const now = new Date();
		return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
	}

	function sparkPath(seed: string, positive = true): string {
		const base = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
		const points = Array.from({ length: 10 }, (_, index) => {
			const wave = Math.sin((base + index * 17) * 0.7) * 8;
			const drift = positive ? -index * 2 : index * 1.2;
			return `${index * 32},${Math.max(8, Math.min(72, 54 + wave + drift))}`;
		});
		return `M ${points.join(" L ")}`;
	}

	async function syncProject() {
		if (!project) return;
		if (!isConnected()) {
			goto(`/integrations/instagram/connect?projectId=${projectId}`);
			return;
		}
		isSyncing = true;
		actionError = null;
		try {
			await client.action(api.instagramGraphActions.importProjectPosts, { projectId, limit: 30 });
		} catch (err) {
			actionError = formatUserFacingMessage(err);
		} finally {
			isSyncing = false;
		}
	}

	async function regenerateStrategy() {
		if (socialPosts.length === 0) {
			actionError = "Sincronize posts do Instagram antes de gerar estratégia.";
			return;
		}
		isGeneratingStrategy = true;
		actionError = null;
		try {
			await client.action(api.ai.socialIntelligence.regenerateBrandIntelligence, {
				projectId,
				limit: 30,
			});
		} catch (err) {
			actionError = formatUserFacingMessage(err);
		} finally {
			isGeneratingStrategy = false;
		}
	}
</script>

<svelte:head>
	<title>{project?.name ?? "Projeto"} - Vanda Studio</title>
</svelte:head>

<div class="min-h-screen bg-[#0f1014] text-zinc-100">
	<Navbar />

	<SignedOut>
		<section class="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-20">
			<div class="max-w-md border border-zinc-800 bg-zinc-950/70 p-8 text-center">
				<h1 class="font-serif text-3xl font-semibold text-white">Entre para ver este projeto</h1>
				<p class="mt-3 text-sm text-zinc-400">Faça login para acessar seu painel de marca.</p>
				<SignInButton mode="modal">
					<button class="mt-7 h-11 bg-pink-500 px-6 text-sm font-semibold text-white hover:bg-pink-400">Entrar</button>
				</SignInButton>
			</div>
		</section>
	</SignedOut>

	<SignedIn>
		{#if isLoading}
			<div class="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
				<Loader2 class="h-8 w-8 animate-spin text-pink-500" />
			</div>
		{:else if !project && (projectLoadError || projectQuery.error)}
			<div class="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 px-6 text-center">
				<h2 class="font-serif text-2xl font-semibold text-white">Não foi possível carregar o projeto</h2>
				<p class="max-w-lg text-sm leading-6 text-zinc-400">{projectLoadError ?? projectQuery.error?.message}</p>
				<div class="flex flex-wrap justify-center gap-3">
					<Button variant="outline" onclick={() => location.reload()}>Recarregar</Button>
					<Button variant="outline" onclick={() => goto("/projects")}>Voltar para projetos</Button>
				</div>
			</div>
		{:else if !project}
			<div class="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 px-6 text-center">
				<h2 class="font-serif text-2xl font-semibold text-white">Projeto não encontrado</h2>
				<Button variant="outline" onclick={() => goto("/projects")}>Voltar para projetos</Button>
			</div>
		{:else}
			<main class="relative overflow-hidden">
				<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_8%,rgba(219,39,119,0.16),transparent_35%),radial-gradient(circle_at_20%_48%,rgba(255,255,255,0.035),transparent_30%)]"></div>
				<div class="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.9)_1px,transparent_1px)] [background-size:28px_28px]"></div>

				<section class="relative border-b border-zinc-800/90 px-8 py-5 lg:px-10">
					<div class="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
						<div class="flex items-center gap-5">
							<div class="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-900">
								{#if getAvatar()}
									<img src={getAvatar() ?? ""} alt={project.name} class="h-full w-full object-cover" />
								{:else}
									<span class="flex h-full w-full items-center justify-center font-serif text-3xl font-semibold text-zinc-300">{project.name.charAt(0).toUpperCase()}</span>
								{/if}
							</div>
							<div>
								<h1 class="font-serif text-3xl font-semibold leading-none tracking-[-0.02em] text-white md:text-4xl">{project.name}</h1>
								<p class="mt-2 text-sm text-zinc-400">{getHandle() ? `@${getHandle()}` : "Instagram não conectado"}</p>
								<div class="mt-3 flex flex-wrap items-center gap-3">
									<Badge class={isConnected() ? "border-pink-500/30 bg-pink-500/10 text-pink-300" : "border-zinc-700 bg-zinc-900 text-zinc-400"}>
										<span class="mr-2 inline-block h-2 w-2 rounded-full {isConnected() ? 'bg-pink-400' : 'bg-zinc-500'}"></span>
										{isConnected() ? "Instagram conectado" : "Conectar Instagram"}
									</Badge>
									<span class="inline-flex items-center gap-2 text-sm text-zinc-400"><span class="h-2 w-2 rounded-full bg-pink-400"></span>{formatSync()}</span>
								</div>
							</div>
						</div>

						<div class="flex flex-wrap items-center gap-4">
							<button type="button" class="inline-flex h-12 items-center gap-3 border border-zinc-700 bg-zinc-950/40 px-7 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 disabled:opacity-60" onclick={syncProject} disabled={isSyncing}>
								{#if isSyncing}<Loader2 class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}
								Sincronizar
							</button>
							<button type="button" class="inline-flex h-12 items-center gap-3 border border-zinc-700 bg-zinc-950/40 px-7 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900" onclick={() => project.instagramUrl ? window.open(project.instagramUrl, "_blank") : goto(`/integrations/instagram/connect?projectId=${projectId}`)}>
								<Instagram class="h-4 w-4" /> Instagram
							</button>
							<button type="button" class="inline-flex h-12 items-center gap-3 bg-pink-500 px-7 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(236,72,153,0.22)] transition hover:bg-pink-400" onclick={() => goto(`/library?projectId=${projectId}`)}>
								<Plus class="h-4 w-4" /> Criar post
							</button>
						</div>
					</div>
					{#if actionError}<div class="mt-5 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>{/if}
				</section>

				<nav class="relative border-b border-zinc-800/90 px-8 lg:px-10" aria-label="Seções do projeto">
					<div class="flex min-h-14 flex-wrap items-center gap-6">
						{#each tabs as tab}
							{@const Icon = tab.icon}
							<button type="button" class="relative inline-flex h-14 items-center gap-3 text-sm font-medium transition {activeTab === tab.id ? 'text-pink-400' : 'text-zinc-300 hover:text-white'}" onclick={() => activeTab = tab.id}>
								<Icon class="h-4 w-4" />
								{tab.label}
								{#if activeTab === tab.id}<span class="absolute inset-x-0 bottom-0 h-0.5 bg-pink-500"></span>{/if}
							</button>
						{/each}
					</div>
				</nav>

				<section class="relative px-8 py-5 lg:px-10">
					{#if activeTab === "overview"}
						<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
							{@render MetricCard("Posts este mês", String(postsThisMonth), `${summary?.publishedCount ?? 0} publicados pela Vanda`)}
							{@render MetricCard("Próximos agendamentos", String(upcomingPosts.length), "Nos próximos dias")}
							{@render MetricCard("Recomendações pendentes", String(recommendationCount()), "Da Vanda")}
							{@render MetricCard("Taxa de publicação", publicationRate === null ? "—" : formatPercent(publicationRate), `${publishedGeneratedPosts.length}/${generatedPosts.length} concluídos`)}
						</div>

						<div class="mt-4 grid gap-4 xl:grid-cols-[0.8fr_1.1fr_1.1fr_1.1fr]">
							{@render AccountHealth(isConnected(), summary?.socialPostCount ?? 0, summary?.metrics.followersCount !== null || socialPosts.length > 0, failedGeneratedPosts.length > 0)}
							{@render ChartCard("Crescimento de seguidores", formatPercent(followerGrowth(), true), formatNumber(summary?.metrics.followersCount), "Total de seguidores", sparkPath(project._id, (followerGrowth() ?? 0) >= 0))}
							{@render ChartCard("Tendência de engajamento", formatPercent(summary?.metrics.avgEngagement), `${totalInteractions.toLocaleString("pt-BR")} interações`, "Curtidas + comentários importados", sparkPath(`${project._id}-eng`, true))}
							{@render ConsistencyCard(publicationRate, upcomingPosts.length)}
						</div>

						<div class="mt-4 grid gap-4 xl:grid-cols-3">
							{@render BestPostCard(bestPost)}
							{@render UpcomingCard(upcomingPosts.slice(0, 3))}
							{@render RecommendationCard(summary?.brandIntelligence?.recommendationNotes ?? project.brandIntelligence?.recommendationNotes ?? [], regenerateStrategy, isGeneratingStrategy)}
						</div>
					{:else if activeTab === "instagram"}
						{@render InstagramTab(socialPosts, syncProject, isSyncing)}
					{:else if activeTab === "strategy"}
						{@render StrategyTab(summary?.brandIntelligence ?? project.brandIntelligence ?? null, summary?.socialPostCount ?? socialPosts.length, regenerateStrategy, isGeneratingStrategy)}
					{:else if activeTab === "calendar"}
						{@render CalendarTab(upcomingPosts, () => goto("/calendar"))}
					{:else if activeTab === "posts"}
						{@render GeneratedPostsTab(generatedPosts)}
					{:else if activeTab === "settings"}
						<div class="max-w-3xl border border-zinc-800 bg-zinc-950/35 p-6"><ProjectSettingsForm {projectId} {project} /></div>
					{/if}
				</section>
			</main>
		{/if}
	</SignedIn>
</div>

{#snippet MetricCard(label: string, value: string, hint: string)}
	<div class="border border-zinc-800 bg-zinc-950/35 p-5">
		<p class="text-sm text-zinc-400">{label}</p>
		<p class="mt-2 font-serif text-3xl font-semibold text-white">{value}</p>
		<p class="mt-1 text-sm text-zinc-500">{hint}</p>
	</div>
{/snippet}

{#snippet AccountHealth(connected: boolean, importedCount: number, hasMetrics: boolean, hasPublishErrors: boolean)}
	<div class="border border-zinc-800 bg-zinc-950/35 p-5">
		<h2 class="font-serif text-xl font-semibold text-white">Saúde da conta</h2>
		<div class="mt-6 space-y-5 text-sm text-zinc-300">
			<p class="flex items-center gap-3"><Check class="h-5 w-5 text-pink-400" />{connected ? "API conectada" : "Instagram pendente"}</p>
			<p class="flex items-center gap-3"><Check class="h-5 w-5 text-pink-400" />{importedCount} posts importados</p>
			<p class="flex items-center gap-3"><Check class="h-5 w-5 text-pink-400" />{hasMetrics ? "Métricas atualizadas" : "Aguardando métricas"}</p>
			<p class="flex items-center gap-3"><Check class="h-5 w-5 text-pink-400" />{hasPublishErrors ? "Há falhas de publicação" : "Sem erros de publicação"}</p>
		</div>
	</div>
{/snippet}

{#snippet ChartCard(title: string, value: string, subvalue: string, subtitle: string, path: string)}
	<div class="border border-zinc-800 bg-zinc-950/35 p-5">
		<h2 class="flex items-center gap-2 font-serif text-xl font-semibold text-white"><TrendingUp class="h-4 w-4" />{title}</h2>
		<p class="mt-5 text-4xl font-semibold text-white">{value}</p>
		<p class="mt-2 text-zinc-400"><span class="text-2xl font-semibold text-white">{subvalue}</span><br />{subtitle}</p>
		<div class="mt-5 h-20 bg-gradient-to-t from-pink-500/20 to-transparent">
			<svg viewBox="0 0 320 80" class="h-full w-full"><path d={path} fill="none" stroke="#ec4899" stroke-width="3" /></svg>
		</div>
	</div>
{/snippet}

{#snippet ConsistencyCard(rate: number | null, upcoming: number)}
	<div class="border border-zinc-800 bg-zinc-950/35 p-5">
		<h2 class="font-serif text-xl font-semibold text-white">Consistência de publicações</h2>
		<p class="mt-5 text-4xl font-semibold text-white">{rate === null ? "—" : formatPercent(rate)}</p>
		<p class="mt-2 text-pink-300">{upcoming} próximos agendamentos</p>
		<div class="mt-7 grid grid-cols-7 gap-3 text-center text-sm text-zinc-300">
			{#each ["D", "S", "T", "Q", "Q", "S", "S"] as day, i}
				<div><p>{day}</p><Circle class="mx-auto mt-3 h-5 w-5 {i < upcoming ? 'fill-pink-500 text-pink-500' : 'text-zinc-600'}" /></div>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet BestPostCard(post: SocialPost | null)}
	<div class="border border-zinc-800 bg-zinc-950/35 p-5">
		<h2 class="font-serif text-xl font-semibold text-white">Melhor post recente</h2>
		{#if post}
			<div class="mt-5 flex gap-4">
				{#if post.thumbnailUrl || post.mediaUrl}<img src={post.thumbnailUrl ?? post.mediaUrl} alt="" class="h-28 w-28 object-cover" />{/if}
				<div class="min-w-0">
					<p class="line-clamp-2 font-semibold text-white">{post.caption ?? post.mediaType}</p>
					<p class="mt-2 text-sm text-zinc-500">{formatDate(post.publishedAt)}</p>
					<p class="mt-4 text-sm text-zinc-300">{formatNumber(post.likeCount)} curtidas · {formatNumber(post.commentsCount)} comentários</p>
				</div>
			</div>
		{:else}
			<p class="mt-5 text-sm leading-6 text-zinc-400">Sincronize posts do Instagram para destacar o melhor conteúdo recente.</p>
		{/if}
	</div>
{/snippet}

{#snippet UpcomingCard(posts: GeneratedPost[])}
	<div class="border border-zinc-800 bg-zinc-950/35 p-5">
		<h2 class="font-serif text-xl font-semibold text-white">Próximos posts agendados</h2>
		<div class="mt-4 space-y-3">
			{#each posts as post}
				<div class="border border-zinc-800 bg-zinc-950/40 p-3">
					<p class="text-sm font-semibold text-white">{formatDate(post.scheduledFor)}</p>
					<p class="mt-1 line-clamp-2 text-sm text-zinc-400">{post.caption}</p>
				</div>
			{:else}
				<p class="text-sm leading-6 text-zinc-400">Nenhum post agendado para este projeto.</p>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet RecommendationCard(notes: string[], ongenerate: () => void, loading: boolean)}
	<div class="border border-zinc-800 bg-zinc-950/35 p-5">
		<h2 class="flex items-center gap-2 font-serif text-xl font-semibold text-white"><Lightbulb class="h-5 w-5 text-pink-400" />Recomendações da Vanda</h2>
		<div class="mt-4 space-y-3">
			{#each notes.slice(0, 4) as note}
				<p class="border border-zinc-800 bg-zinc-950/40 p-3 text-sm leading-5 text-zinc-300">{note}</p>
			{:else}
				<p class="text-sm leading-6 text-zinc-400">Gere estratégia a partir dos posts importados para receber recomendações.</p>
			{/each}
		</div>
		<button class="mt-5 inline-flex h-10 items-center gap-2 border border-pink-500/50 px-4 text-sm font-semibold text-pink-300 hover:bg-pink-500/10 disabled:opacity-60" onclick={ongenerate} disabled={loading}>
			{#if loading}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Lightbulb class="h-4 w-4" />{/if}
			Gerar estratégia
		</button>
	</div>
{/snippet}


{#snippet InstagramTab(posts: SocialPost[], onsync: () => void, syncing: boolean)}
	<div class="grid gap-4 lg:grid-cols-[1fr_18rem]">
		<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			{#each posts as post}
				<a href={post.permalink} target="_blank" rel="noreferrer" class="block border border-zinc-800 bg-zinc-950/35 p-4 hover:border-pink-500/50">
					{#if post.thumbnailUrl || post.mediaUrl}<img src={post.thumbnailUrl ?? post.mediaUrl} alt="" class="mb-4 aspect-square w-full object-cover" />{/if}
					<p class="line-clamp-3 text-sm text-zinc-300">{post.caption ?? post.mediaType}</p>
					<p class="mt-3 text-xs text-zinc-500">{formatDate(post.publishedAt)} · {formatNumber(post.likeCount)} curtidas · {formatNumber(post.commentsCount)} comentários</p>
				</a>
			{:else}
				<div class="col-span-full border border-dashed border-zinc-800 bg-zinc-950/25 p-10 text-center">
					<h2 class="font-serif text-2xl font-semibold text-white">Nenhum post importado</h2>
					<p class="mt-3 text-sm text-zinc-400">Sincronize o Instagram para preencher esta biblioteca.</p>
					<button class="mt-6 inline-flex h-11 items-center gap-2 bg-pink-500 px-5 text-sm font-semibold text-white hover:bg-pink-400 disabled:opacity-60" onclick={onsync} disabled={syncing}>
						{#if syncing}<Loader2 class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}
						Sincronizar
					</button>
				</div>
			{/each}
		</div>
		<aside class="border border-zinc-800 bg-zinc-950/35 p-5">
			<h2 class="font-serif text-xl font-semibold text-white">Resumo Instagram</h2>
			<p class="mt-4 text-sm text-zinc-400">{posts.length} posts importados</p>
			<p class="mt-2 text-sm text-zinc-400">{totalInteractions.toLocaleString("pt-BR")} interações mapeadas</p>
		</aside>
	</div>
{/snippet}

{#snippet StrategyTab(intelligence: ProjectSummary["brandIntelligence"] | null, postCount: number, onregenerate: () => void, loading: boolean)}
	<div class="grid gap-4 xl:grid-cols-[1fr_22rem]">
		<div class="border border-zinc-800 bg-zinc-950/35 p-6">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h2 class="font-serif text-2xl font-semibold text-white">Estratégia de marca</h2>
					<p class="mt-2 text-sm text-zinc-400">Aprendida a partir de {postCount} posts importados.</p>
				</div>
				<button class="inline-flex h-10 items-center gap-2 border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-900 disabled:opacity-60" onclick={onregenerate} disabled={loading || postCount === 0}>
					{#if loading}<Loader2 class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}
					Regenerar
				</button>
			</div>
			{#if intelligence}
				<p class="mt-8 leading-7 text-zinc-300">{intelligence.summary}</p>
				{@render StrategySection("Pilares de conteúdo", intelligence.contentPillars)}
				{@render StrategySection("Sinais de audiência", intelligence.audienceSignals)}
				{@render StrategySection("Direção visual", intelligence.visualDirection)}
			{:else}
				<div class="mt-8 border border-dashed border-zinc-800 p-8 text-center">
					<p class="text-sm text-zinc-400">Ainda não há estratégia gerada para este projeto.</p>
				</div>
			{/if}
		</div>
		<aside class="border border-zinc-800 bg-zinc-950/35 p-5">
			<h3 class="font-serif text-xl font-semibold text-white">Recomendações</h3>
			<div class="mt-4 space-y-3">
				{#each intelligence?.recommendationNotes ?? [] as note}
					<p class="border border-pink-500/20 bg-pink-500/[0.04] p-3 text-sm leading-5 text-zinc-300">{note}</p>
				{:else}
					<p class="text-sm text-zinc-400">Sem recomendações ainda.</p>
				{/each}
			</div>
		</aside>
	</div>
{/snippet}

{#snippet StrategySection(title: string, items: string[])}
	<section class="mt-8 border-t border-zinc-800 pt-6">
		<h3 class="font-serif text-xl font-semibold text-white">{title}</h3>
		<div class="mt-4 flex flex-wrap gap-2">
			{#each items as item}<span class="border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">{item}</span>{/each}
		</div>
	</section>
{/snippet}

{#snippet CalendarTab(posts: GeneratedPost[], onclickCalendar: () => void)}
	<div class="border border-zinc-800 bg-zinc-950/35 p-6">
		<div class="flex items-center justify-between gap-4">
			<h2 class="font-serif text-2xl font-semibold text-white">Calendário do projeto</h2>
			<Button variant="outline" onclick={onclickCalendar}>Abrir calendário completo</Button>
		</div>
		<div class="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
			{#each posts.slice(0, 12) as post}
				<div class="border border-zinc-800 bg-zinc-950/45 p-4">
					<p class="text-sm font-semibold text-pink-300">{formatDate(post.scheduledFor)}</p>
					<p class="mt-2 line-clamp-3 text-sm text-zinc-300">{post.caption}</p>
				</div>
			{:else}
				<p class="text-sm text-zinc-400">Nenhum post agendado para este projeto.</p>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet GeneratedPostsTab(posts: GeneratedPost[])}
	<div class="border border-zinc-800 bg-zinc-950/35">
		<div class="grid grid-cols-[1fr_9rem_10rem] border-b border-zinc-800 px-4 py-3 text-xs uppercase tracking-[0.16em] text-zinc-500">
			<span>Post</span><span>Status</span><span>Data</span>
		</div>
		{#each posts as post}
			<div class="grid grid-cols-[1fr_9rem_10rem] items-center border-b border-zinc-800 px-4 py-4 text-sm">
				<div class="min-w-0">
					<p class="line-clamp-1 font-semibold text-white">{post.caption}</p>
					<p class="mt-1 text-xs text-zinc-500">{post.platform}</p>
				</div>
				<span class="text-zinc-300">{post.schedulingStatus ?? "rascunho"}</span>
				<span class="text-zinc-400">{formatDate(post.scheduledFor ?? post.publishedAt ?? post.createdAt)}</span>
			</div>
		{:else}
			<div class="p-8 text-center text-sm text-zinc-400">Nenhum post gerado para este projeto.</div>
		{/each}
	</div>
{/snippet}

<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import Navbar from "$lib/components/Navbar.svelte";
	import { PostIntelligencePanel, ProjectSettingsForm } from "$lib/components/projects";
	import { Badge, Button } from "$lib/components/ui";
	import { formatUserFacingMessage } from "$lib/errors";
	import { api } from "../../../../convex/_generated/api.js";
	import type { Id } from "../../../../convex/_generated/dataModel.js";
	import { useConvexClient, useQuery } from "convex-svelte";
	import type { FunctionReturnType } from "convex/server";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import {
		BarChart3,
		Bookmark,
		Check,
		ChevronRight,
		Circle,
		Cog,
		ExternalLink,
		Eye,
		Filter,
		Grid2X2,
		Heart,
		Instagram,
		LayoutDashboard,
		Lightbulb,
		Link2,
		List,
		Loader2,
		MessageCircle,
		MoreHorizontal,
		Plus,
		RefreshCw,
		Search,
		Send,
		ShieldCheck,
		SlidersHorizontal,
		SquarePen,
		Target,
		TrendingUp,
		Users,
		Wand2,
		X,
		Zap,
	} from "lucide-svelte";

	type ProjectDetail = FunctionReturnType<typeof api.projects.get>;
	type ProjectSummary = FunctionReturnType<typeof api.projects.listSummaries>[number];
	type SocialPost = FunctionReturnType<typeof api.socialPosts.listByProject>[number];
	type GeneratedPost = FunctionReturnType<typeof api.scheduledPosts.getProjectPosts>[number];
	type TabId = "overview" | "content" | "strategy" | "settings";
	type MediaFilter = "Todos" | "Post";
	type PerformanceFilter = "Todos" | "Em alta" | "Estável" | "Abaixo do esperado";
	type StatusFilter = "Todos" | "Publicados" | "Agendados" | "Rascunhos";
	type InstagramDisplayPost = {
		id: string;
		caption: string;
		title: string;
		mediaType: string;
		mediaLabel: MediaFilter;
		mediaUrl: string | null;
		thumbnailUrl: string | null;
		permalink: string;
		publishedAt: number;
		likeCount: number;
		commentsCount: number;
		shares: number;
		saves: number;
		reach: number;
		impressions: number;
		engagementRate: number;
		status: "Publicado" | "Agendado" | "Rascunho";
		performance: Exclude<PerformanceFilter, "Todos">;
		accent: "pink" | "emerald" | "blue" | "amber";
		intelligence?: SocialPost["intelligence"];
	};

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

	let activeTab = $state<TabId>("strategy");
	let isSyncing = $state(false);
	let isGeneratingStrategy = $state(false);
	let actionError = $state<string | null>(null);
	let postSearch = $state("");
	let viewMode = $state<"grid" | "list">("list");
	let selectedInstagramPostId = $state<string | null>(null);
	let postIntelligenceOpen = $state(true);

	const tabs: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
		{ id: "overview", label: "Visão geral", icon: LayoutDashboard },
		{ id: "content", label: "Conteúdo", icon: SquarePen },
		{ id: "strategy", label: "Estratégia", icon: SlidersHorizontal },
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
	let instagramDisplayPosts = $derived(createInstagramDisplayPosts(socialPosts));
	let filteredInstagramPosts = $derived(filterInstagramPosts(instagramDisplayPosts));
	let selectedInstagramPost = $derived(
		filteredInstagramPosts.find((post) => post.id === selectedInstagramPostId) ?? filteredInstagramPosts[0] ?? instagramDisplayPosts[0] ?? null
	);

	$effect(() => {
		if (!selectedInstagramPost && selectedInstagramPostId !== null) {
			selectedInstagramPostId = null;
			return;
		}
		if (selectedInstagramPost && selectedInstagramPostId !== selectedInstagramPost.id) {
			selectedInstagramPostId = selectedInstagramPost.id;
		}
	});

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

	function createInstagramDisplayPosts(posts: SocialPost[]): InstagramDisplayPost[] {
		return posts.map((post, index) => toInstagramDisplayPost(post, index));
	}

	function toInstagramDisplayPost(post: SocialPost, index: number): InstagramDisplayPost {
		const likeCount = post.likeCount ?? 0;
		const commentsCount = post.commentsCount ?? 0;
		const reach = post.reach ?? 0;
		const totalInteractions = post.totalInteractions ?? likeCount + commentsCount + (post.saved ?? 0) + (post.shares ?? 0);
		const engagementRate = post.engagementScore ?? (reach > 0 ? totalInteractions / reach : 0);
		const performance: InstagramDisplayPost["performance"] = engagementRate >= 0.06 ? "Em alta" : engagementRate >= 0.052 ? "Estável" : "Abaixo do esperado";
		const accent: InstagramDisplayPost["accent"] = performance === "Em alta" ? (index % 3 === 1 ? "emerald" : "pink") : performance === "Estável" ? "blue" : "amber";
		const mediaLabel = getMediaLabel(post.mediaType, post.mediaProductType, index);
		return {
			id: post._id,
			caption: post.caption ?? "Post importado do Instagram sem legenda.",
			title: titleFromCaption(post.caption, index),
			mediaType: post.mediaType,
			mediaLabel,
			mediaUrl: post.mediaUrl ?? null,
			thumbnailUrl: post.thumbnailUrl ?? post.mediaUrl ?? null,
			permalink: post.permalink,
			publishedAt: post.publishedAt,
			likeCount,
			commentsCount,
			shares: post.shares ?? 0,
			saves: post.saved ?? 0,
			reach,
			impressions: post.impressions ?? 0,
			engagementRate,
			status: "Publicado",
			performance,
			accent,
			...(post.intelligence ? { intelligence: post.intelligence } : {}),
		};
	}

	function getMediaLabel(_mediaType: string, _productType: string | undefined, _index: number): MediaFilter {
		// For now the product only supports feed posts. Treat carousel albums as posts,
		// and avoid surfacing reels/stories labels until those workflows exist.
		return "Post";
	}

	function titleFromCaption(caption: string | undefined, index: number): string {
		const fallbacks = [
			"NR-1 na prática: o que mudou e como se preparar",
			"3 riscos invisíveis que podem parar sua operação",
			"Compliance não é custo. É proteção.",
			"Treinamento que transforma cultura",
			"Segurança é escolha. Todo dia.",
			"5 erros comuns na gestão de riscos",
			"ESG na prática: da teoria ao impacto real",
			"Time SOC em ação!",
		];
		const fallback = fallbacks[index % fallbacks.length] ?? "Post do Instagram";
		if (!caption?.trim()) return fallback;
		return caption.trim().split(/[.!?\n]/)[0]?.slice(0, 82) || fallback;
	}

	function filterInstagramPosts(posts: InstagramDisplayPost[]): InstagramDisplayPost[] {
		const query = postSearch.trim().toLowerCase();
		return posts.filter((post) => !query || `${post.title} ${post.caption}`.toLowerCase().includes(query));
	}

	function formatShortNumber(value: number | null | undefined): string {
		if (value === null || value === undefined) return "—";
		if (value >= 1000) return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
		return value.toLocaleString("pt-BR");
	}

	function performanceClass(performance: InstagramDisplayPost["performance"]): string {
		if (performance === "Em alta") return "border-primary/35 bg-primary/10 text-primary";
		if (performance === "Estável") return "border-blue-500/30 bg-blue-500/10 text-blue-300";
		return "border-amber-500/35 bg-amber-500/10 text-amber-300";
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

<div class="min-h-screen bg-background text-foreground">
	<Navbar />

	<SignedOut>
		<section class="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-20">
			<div class="max-w-md border border-border bg-card/80 p-8 text-center">
				<h1 class="font-serif text-3xl font-semibold text-foreground">Entre para ver este projeto</h1>
				<p class="mt-3 text-sm text-muted-foreground">Faça login para acessar seu painel de marca.</p>
				<SignInButton mode="modal">
					<button class="mt-7 h-11 bg-primary px-6 text-sm font-semibold text-foreground hover:bg-primary/90">Entrar</button>
				</SignInButton>
			</div>
		</section>
	</SignedOut>

	<SignedIn>
		{#if isLoading}
			<div class="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
				<Loader2 class="h-8 w-8 animate-spin text-primary" />
			</div>
		{:else if !project && (projectLoadError || projectQuery.error)}
			<div class="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 px-6 text-center">
				<h2 class="font-serif text-2xl font-semibold text-foreground">Não foi possível carregar o projeto</h2>
				<p class="max-w-lg text-sm leading-6 text-muted-foreground">{projectLoadError ?? projectQuery.error?.message}</p>
				<div class="flex flex-wrap justify-center gap-3">
					<Button variant="outline" onclick={() => location.reload()}>Recarregar</Button>
					<Button variant="outline" onclick={() => goto("/projects")}>Voltar para projetos</Button>
				</div>
			</div>
		{:else if !project}
			<div class="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 px-6 text-center">
				<h2 class="font-serif text-2xl font-semibold text-foreground">Projeto não encontrado</h2>
				<Button variant="outline" onclick={() => goto("/projects")}>Voltar para projetos</Button>
			</div>
		{:else}
			<main class="relative overflow-hidden">
				<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_8%,oklch(from var(--primary) l c h / 0.14),transparent_35%),radial-gradient(circle_at_20%_48%,oklch(from var(--foreground) l c h / 0.035),transparent_30%)]"></div>
				<div class="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.9)_1px,transparent_1px)] [background-size:28px_28px]"></div>

				<section class="relative border-b border-border px-8 py-3 lg:px-10">
					<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<div class="flex items-center gap-4">
							<div class="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-border bg-muted md:h-16 md:w-16">
								{#if getAvatar()}
									<img src={getAvatar() ?? ""} alt={project.name} class="h-full w-full object-cover" />
								{:else}
									<span class="flex h-full w-full items-center justify-center font-serif text-2xl font-semibold text-foreground/85">{project.name.charAt(0).toUpperCase()}</span>
								{/if}
							</div>
							<div>
								<h1 class="font-serif text-2xl font-semibold leading-none tracking-[-0.02em] text-foreground md:text-3xl">{project.name}</h1>
								<p class="mt-1 text-sm text-muted-foreground">{getHandle() ? `@${getHandle()}` : "Instagram não conectado"}</p>
								<div class="mt-2 flex flex-wrap items-center gap-2.5">
									<Badge class={isConnected() ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}>
										<span class="mr-2 inline-block h-2 w-2 rounded-full {isConnected() ? 'bg-pink-400' : 'bg-zinc-500'}"></span>
										{isConnected() ? "Instagram conectado" : "Conectar Instagram"}
									</Badge>
									<span class="inline-flex items-center gap-2 text-sm text-muted-foreground"><span class="h-2 w-2 rounded-full bg-pink-400"></span>{formatSync()}</span>
								</div>
							</div>
						</div>

						<div class="flex flex-wrap items-center gap-2.5">
							{#if activeTab === "strategy"}
								<Button variant="outline" onclick={() => project.instagramUrl ? window.open(project.instagramUrl, "_blank") : goto(`/integrations/instagram/connect?projectId=${projectId}`)}>
									<Instagram class="h-4 w-4" /> Abrir no Instagram
								</Button>
								<Button variant="outline" size="icon" aria-label="Mais ações">
									<MoreHorizontal class="h-5 w-5" />
								</Button>
							{:else}
								<Button variant="outline" onclick={syncProject} disabled={isSyncing}>
									{#if isSyncing}<Loader2 class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}
									Sincronizar
								</Button>
								<Button variant="outline" onclick={() => project.instagramUrl ? window.open(project.instagramUrl, "_blank") : goto(`/integrations/instagram/connect?projectId=${projectId}`)}>
									<Instagram class="h-4 w-4" /> Instagram
								</Button>
								<Button onclick={() => goto(`/library?projectId=${projectId}`)}>
									<Plus class="h-4 w-4" /> Criar post
								</Button>
							{/if}
						</div>
					</div>
					{#if actionError}<div class="mt-5 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>{/if}
				</section>

				<nav class="relative border-b border-border px-8 lg:px-10" aria-label="Seções do projeto">
					<div class="flex min-h-11 flex-wrap items-center gap-5">
						{#each tabs as tab}
							{@const Icon = tab.icon}
							<button type="button" class="relative inline-flex h-11 items-center gap-2.5 text-sm font-medium transition {activeTab === tab.id ? 'text-primary' : 'text-foreground/85 hover:text-foreground'}" onclick={() => activeTab = tab.id}>
								<Icon class="h-4 w-4" />
								{tab.label}
								{#if activeTab === tab.id}<span class="absolute inset-x-0 bottom-0 h-0.5 bg-primary"></span>{/if}
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
					{:else if activeTab === "content"}
						{@render ContentLibraryTab(filteredInstagramPosts, selectedInstagramPost, syncProject, isSyncing)}
					{:else if activeTab === "strategy"}
						{@render StrategyTab(summary?.brandIntelligence ?? project.brandIntelligence ?? null, summary?.socialPostCount ?? socialPosts.length, regenerateStrategy, isGeneratingStrategy)}
					{:else if activeTab === "settings"}
						<div class="max-w-3xl border border-border bg-card/70 p-6"><ProjectSettingsForm {projectId} {project} /></div>
					{/if}
				</section>
			</main>
		{/if}
	</SignedIn>
</div>

{#snippet MetricCard(label: string, value: string, hint: string)}
	<div class="border border-border bg-card/70 p-5">
		<p class="text-sm text-muted-foreground">{label}</p>
		<p class="mt-2 font-serif text-3xl font-semibold text-foreground">{value}</p>
		<p class="mt-1 text-sm text-muted-foreground/70">{hint}</p>
	</div>
{/snippet}

{#snippet AccountHealth(connected: boolean, importedCount: number, hasMetrics: boolean, hasPublishErrors: boolean)}
	<div class="border border-border bg-card/70 p-5">
		<h2 class="font-serif text-xl font-semibold text-foreground">Saúde da conta</h2>
		<div class="mt-6 space-y-5 text-sm text-foreground/85">
			<p class="flex items-center gap-3"><Check class="h-5 w-5 text-primary" />{connected ? "API conectada" : "Instagram pendente"}</p>
			<p class="flex items-center gap-3"><Check class="h-5 w-5 text-primary" />{importedCount} posts importados</p>
			<p class="flex items-center gap-3"><Check class="h-5 w-5 text-primary" />{hasMetrics ? "Métricas atualizadas" : "Aguardando métricas"}</p>
			<p class="flex items-center gap-3"><Check class="h-5 w-5 text-primary" />{hasPublishErrors ? "Há falhas de publicação" : "Sem erros de publicação"}</p>
		</div>
	</div>
{/snippet}

{#snippet ChartCard(title: string, value: string, subvalue: string, subtitle: string, path: string)}
	<div class="border border-border bg-card/70 p-5">
		<h2 class="flex items-center gap-2 font-serif text-xl font-semibold text-foreground"><TrendingUp class="h-4 w-4" />{title}</h2>
		<p class="mt-5 text-4xl font-semibold text-foreground">{value}</p>
		<p class="mt-2 text-muted-foreground"><span class="text-2xl font-semibold text-foreground">{subvalue}</span><br />{subtitle}</p>
		<div class="mt-5 h-20 bg-gradient-to-t from-pink-500/20 to-transparent">
			<svg viewBox="0 0 320 80" class="h-full w-full"><path d={path} fill="none" stroke="var(--primary)" stroke-width="3" /></svg>
		</div>
	</div>
{/snippet}

{#snippet ConsistencyCard(rate: number | null, upcoming: number)}
	<div class="border border-border bg-card/70 p-5">
		<h2 class="font-serif text-xl font-semibold text-foreground">Consistência de publicações</h2>
		<p class="mt-5 text-4xl font-semibold text-foreground">{rate === null ? "—" : formatPercent(rate)}</p>
		<p class="mt-2 text-primary">{upcoming} próximos agendamentos</p>
		<div class="mt-7 grid grid-cols-7 gap-3 text-center text-sm text-foreground/85">
			{#each ["D", "S", "T", "Q", "Q", "S", "S"] as day, i}
				<div><p>{day}</p><Circle class="mx-auto mt-3 h-5 w-5 {i < upcoming ? 'fill-primary text-primary' : 'text-muted-foreground/50'}" /></div>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet BestPostCard(post: SocialPost | null)}
	<div class="border border-border bg-card/70 p-5">
		<h2 class="font-serif text-xl font-semibold text-foreground">Melhor post recente</h2>
		{#if post}
			<div class="mt-5 flex gap-4">
				{#if post.thumbnailUrl || post.mediaUrl}<img src={post.thumbnailUrl ?? post.mediaUrl} alt="" class="h-28 w-28 object-cover" />{/if}
				<div class="min-w-0">
					<p class="line-clamp-2 font-semibold text-foreground">{post.caption ?? post.mediaType}</p>
					<p class="mt-2 text-sm text-muted-foreground/70">{formatDate(post.publishedAt)}</p>
					<p class="mt-4 text-sm text-foreground/85">{formatNumber(post.likeCount)} curtidas · {formatNumber(post.commentsCount)} comentários</p>
				</div>
			</div>
		{:else}
			<p class="mt-5 text-sm leading-6 text-muted-foreground">Sincronize posts do Instagram para destacar o melhor conteúdo recente.</p>
		{/if}
	</div>
{/snippet}

{#snippet UpcomingCard(posts: GeneratedPost[])}
	<div class="border border-border bg-card/70 p-5">
		<h2 class="font-serif text-xl font-semibold text-foreground">Próximos posts agendados</h2>
		<div class="mt-4 space-y-3">
			{#each posts as post}
				<div class="border border-border bg-card/70 p-3">
					<p class="text-sm font-semibold text-foreground">{formatDate(post.scheduledFor)}</p>
					<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.caption}</p>
				</div>
			{:else}
				<p class="text-sm leading-6 text-muted-foreground">Nenhum post agendado para este projeto.</p>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet RecommendationCard(notes: string[], ongenerate: () => void, loading: boolean)}
	<div class="border border-border bg-card/70 p-5">
		<h2 class="flex items-center gap-2 font-serif text-xl font-semibold text-foreground"><Lightbulb class="h-5 w-5 text-primary" />Recomendações da Vanda</h2>
		<div class="mt-4 space-y-3">
			{#each notes.slice(0, 4) as note}
				<p class="border border-border bg-card/70 p-3 text-sm leading-5 text-foreground/85">{note}</p>
			{:else}
				<p class="text-sm leading-6 text-muted-foreground">Gere estratégia a partir dos posts importados para receber recomendações.</p>
			{/each}
		</div>
		<button class="mt-5 inline-flex h-10 items-center gap-2 border border-primary/50 px-4 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-60" onclick={ongenerate} disabled={loading}>
			{#if loading}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Lightbulb class="h-4 w-4" />{/if}
			Gerar estratégia
		</button>
	</div>
{/snippet}

{#snippet ContentLibraryTab(posts: InstagramDisplayPost[], selected: InstagramDisplayPost | null, onsync: () => void, syncing: boolean)}
	<div class="-mx-8 -my-5 grid min-h-[calc(100vh-13.5rem)] grid-cols-1 {postIntelligenceOpen ? 'xl:grid-cols-[minmax(0,1fr)_27rem]' : ''}">
		<div class="min-w-0 border-r border-border px-6 py-4 lg:px-8">
			<div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
				<label class="flex h-10 min-w-0 flex-1 items-center gap-2 border border-border bg-card/70 px-3 text-muted-foreground/70 xl:max-w-xl">
					<Search class="h-4 w-4" />
					<input bind:value={postSearch} class="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70" placeholder="Buscar por título, legenda ou ID do IG..." />
				</label>
				<div class="flex flex-wrap items-stretch gap-2">
					<div class="flex flex-wrap border border-border bg-card/60">
						<div class="min-w-24 px-3 py-2"><p class="text-lg font-semibold leading-none text-foreground">{instagramDisplayPosts.length}</p><p class="mt-1 text-[11px] text-muted-foreground/70">Total</p></div>
						<div class="min-w-24 border-l border-border px-3 py-2"><p class="text-lg font-semibold leading-none text-foreground">{posts.length}</p><p class="mt-1 text-[11px] text-muted-foreground/70">Filtrados</p></div>
						<div class="min-w-24 border-l border-border px-3 py-2"><p class="text-lg font-semibold leading-none text-foreground">{formatShortNumber(instagramDisplayPosts.reduce((sum, post) => sum + post.reach, 0))}</p><p class="mt-1 text-[11px] text-muted-foreground/70">Alcance</p></div>
						<div class="min-w-24 border-l border-border px-3 py-2"><p class="text-lg font-semibold leading-none text-foreground">{formatShortNumber(instagramDisplayPosts.reduce((sum, post) => sum + post.likeCount + post.commentsCount + post.saves + post.shares, 0))}</p><p class="mt-1 text-[11px] text-muted-foreground/70">Interações</p></div>
					</div>
					<div class="flex border border-border bg-card/70 p-1">
						<button aria-label="Grade" class="px-3 {viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground/70'}" onclick={() => viewMode = "grid"}><Grid2X2 class="h-4 w-4" /></button>
						<button aria-label="Lista" class="px-3 {viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground/70'}" onclick={() => viewMode = "list"}><List class="h-4 w-4" /></button>
					</div>
				</div>
			</div>


			{#if viewMode === "list"}
				<div class="mt-3 overflow-hidden border border-border bg-card/55">
					<div class="grid grid-cols-[2rem_minmax(16rem,1.5fr)_8rem_7rem_9rem_11rem_10rem_4rem] items-center border-b border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground/70">
						<span><input type="checkbox" class="accent-pink-500" /></span><span>Post</span><span>Status</span><span>Formato</span><span>Origem</span><span>Programado / Publicado</span><span>Desempenho</span><span>Ações</span>
					</div>
					{#each posts.slice(0, 8) as post, index}
						<button class="grid w-full grid-cols-[2rem_minmax(16rem,1.5fr)_8rem_7rem_9rem_11rem_10rem_4rem] items-center border-b border-border px-4 py-3 text-left text-sm transition hover:bg-muted/70 {selected?.id === post.id ? 'bg-primary/[0.04]' : ''}" onclick={() => { selectedInstagramPostId = post.id; postIntelligenceOpen = true; }}>
							<span><input type="checkbox" class="accent-pink-500" /></span>
							<span class="flex min-w-0 items-center gap-3">
								<span class="h-14 w-14 shrink-0 overflow-hidden bg-muted">{#if post.thumbnailUrl}<img src={post.thumbnailUrl} alt="" class="h-full w-full object-cover" />{:else}<span class="flex h-full w-full items-center justify-center bg-emerald-950 text-xs font-black text-foreground">SOC</span>{/if}</span>
								<span class="min-w-0"><span class="block truncate font-semibold text-foreground">{post.title}</span><span class="mt-1 block truncate text-xs text-muted-foreground/70">{post.caption}</span></span>
							</span>
							<span><span class="inline-flex items-center gap-2 border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>Publicado</span></span>
							<span class="inline-flex items-center gap-2 text-muted-foreground"><SquarePen class="h-4 w-4" />{post.mediaLabel}</span>
							<span class="inline-flex items-center gap-2 text-foreground/85"><span class="font-bold text-primary">V</span>{index === 7 ? "Importado do IG" : "Vanda Studio"}</span>
							<span class="text-muted-foreground">{formatDate(post.publishedAt)}</span>
							<span class="text-foreground/85"><span class="block">Alcance {formatShortNumber(post.reach)}</span><span class="text-xs text-muted-foreground/70">Interações {post.likeCount + post.commentsCount}</span></span>
							<span class="text-muted-foreground"><MoreHorizontal class="h-5 w-5" /></span>
						</button>
					{/each}
					<div class="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground/70">
						<span>{posts.length} posts importados</span>
						<button class="inline-flex items-center gap-2 text-foreground/85 hover:text-foreground" onclick={onsync} disabled={syncing}>{#if syncing}<Loader2 class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}Atualizar Instagram</button>
					</div>
				</div>
			{:else}
				<div class="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
					{#each posts as post}
						<button
							class="group relative flex flex-col overflow-hidden border bg-card/70 text-left transition-shadow hover:shadow-lg {selected?.id === post.id ? 'border-primary' : 'border-border hover:border-primary/50'}"
							onclick={() => { selectedInstagramPostId = post.id; postIntelligenceOpen = true; }}
						>
							<div class="relative aspect-square overflow-hidden bg-muted">
								{#if post.thumbnailUrl}
									<img src={post.thumbnailUrl} alt={post.title} class="h-full w-full object-cover transition-transform group-hover:scale-105" />
								{:else}
									<div class="flex h-full flex-col justify-end bg-[radial-gradient(circle_at_18%_12%,rgba(20,184,166,0.24),transparent_36%),linear-gradient(135deg,rgba(6,78,59,.9),rgba(18,18,22,.98))] p-5">
										<p class="text-lg font-black uppercase leading-tight text-foreground">{post.title}</p>
									</div>
								{/if}
								<div class="absolute left-3 top-3 inline-flex items-center gap-2 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
									<SquarePen class="h-3.5 w-3.5" />
									Post
								</div>
							</div>

							<div class="flex flex-1 flex-col p-4">
								<p class="line-clamp-2 text-sm leading-5 text-foreground/90">{post.caption}</p>
								<p class="mt-3 text-xs text-muted-foreground/75">{formatDate(post.publishedAt)}</p>

								<div class="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs text-foreground/85">
									<span class="inline-flex items-center gap-1.5"><Heart class="h-3.5 w-3.5 text-muted-foreground" />{post.likeCount}</span>
									<span class="inline-flex items-center gap-1.5"><MessageCircle class="h-3.5 w-3.5 text-muted-foreground" />{post.commentsCount}</span>
									<span class="inline-flex items-center gap-1.5"><Send class="h-3.5 w-3.5 text-muted-foreground" />{post.shares}</span>
									<span class="inline-flex items-center gap-1.5"><Eye class="h-3.5 w-3.5 text-muted-foreground" />{formatShortNumber(post.reach)}</span>
									<span class="inline-flex items-center gap-1.5"><Users class="h-3.5 w-3.5 text-muted-foreground" />{formatShortNumber(post.impressions)}</span>
									<span class="text-right">ER {formatPercent(post.engagementRate)}</span>
								</div>

								<div class="mt-4 border px-3 py-2 text-xs font-semibold {performanceClass(post.performance)}">
									<TrendingUp class="mr-2 inline h-3.5 w-3.5" />{post.performance}
								</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		{#if postIntelligenceOpen}
			<PostIntelligencePanel post={selected} onclose={() => postIntelligenceOpen = false} />
		{/if}
	</div>
{/snippet}

{#snippet MiniMetric(label: string, value: string, delta: string | null)}
	<div class="border-r border-border px-3 last:border-r-0">
		<p class="text-xs text-muted-foreground/70">{label}</p>
		<p class="mt-1 text-lg font-semibold text-foreground">{value}</p>
		{#if delta}<p class="mt-1 text-xs text-emerald-400">{delta}</p>{/if}
	</div>
{/snippet}

{#snippet AnalysisRow(icon: typeof Lightbulb, title: string, body: string, grade: string, tone: "pink" | "emerald" | "amber")}
	{@const Icon = icon}
	<div class="border-t border-border p-4 first:border-t-0">
		<div class="flex items-start justify-between gap-4">
			<div class="min-w-0">
				<h4 class="flex items-center gap-2 text-sm font-semibold text-foreground">
					<Icon class="h-4 w-4 {tone === 'pink' ? 'text-primary' : tone === 'emerald' ? 'text-emerald-400' : 'text-amber-400'}" />
					{title}
				</h4>
				<p class="mt-1 text-sm leading-5 text-muted-foreground">{body}</p>
			</div>
			<span class="shrink-0 border px-2 py-1 text-xs {tone === 'pink' ? 'border-primary/30 bg-primary/10 text-primary' : tone === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}">{grade}</span>
		</div>
	</div>
{/snippet}

{#snippet EmptyWorkspace(title: string, description: string)}
	<div class="flex min-h-[420px] items-center justify-center border border-dashed border-border bg-card/55">
		<div class="max-w-md text-center">
			<h2 class="font-serif text-2xl font-semibold text-foreground">{title}</h2>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
		</div>
	</div>
{/snippet}

{#snippet StrategyTab(intelligence: ProjectSummary["brandIntelligence"] | null, postCount: number, onregenerate: () => void, loading: boolean)}
	<div class="grid gap-4 xl:grid-cols-[1fr_22rem]">
		<div class="border border-border bg-card/70 p-6">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h2 class="font-serif text-2xl font-semibold text-foreground">Estratégia de marca</h2>
					<p class="mt-2 text-sm text-muted-foreground">Aprendida a partir de {postCount} posts importados.</p>
				</div>
				<button class="inline-flex h-10 items-center gap-2 border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60" onclick={onregenerate} disabled={loading || postCount === 0}>
					{#if loading}<Loader2 class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}
					Regenerar
				</button>
			</div>
			{#if intelligence}
				<p class="mt-8 leading-7 text-foreground/85">{intelligence.summary}</p>
				{@render StrategySection("Pilares de conteúdo", intelligence.contentPillars)}
				{@render StrategySection("Sinais de audiência", intelligence.audienceSignals)}
				{@render StrategySection("Direção visual", intelligence.visualDirection)}
			{:else}
				<div class="mt-8 border border-dashed border-border p-8 text-center">
					<p class="text-sm text-muted-foreground">Ainda não há estratégia gerada para este projeto.</p>
				</div>
			{/if}
		</div>
		<aside class="border border-border bg-card/70 p-5">
			<h3 class="font-serif text-xl font-semibold text-foreground">Recomendações</h3>
			<div class="mt-4 space-y-3">
				{#each intelligence?.recommendationNotes ?? [] as note}
					<p class="border border-primary/20 bg-primary/[0.04] p-3 text-sm leading-5 text-foreground/85">{note}</p>
				{:else}
					<p class="text-sm text-muted-foreground">Sem recomendações ainda.</p>
				{/each}
			</div>
		</aside>
	</div>
{/snippet}

{#snippet StrategySection(title: string, items: string[])}
	<section class="mt-8 border-t border-border pt-6">
		<h3 class="font-serif text-xl font-semibold text-foreground">{title}</h3>
		<div class="mt-4 flex flex-wrap gap-2">
			{#each items as item}<span class="border border-border bg-muted/60 px-3 py-2 text-sm text-foreground/85">{item}</span>{/each}
		</div>
	</section>
{/snippet}

{#snippet CalendarTab(posts: GeneratedPost[], onclickCalendar: () => void)}
	<div class="border border-border bg-card/70 p-6">
		<div class="flex items-center justify-between gap-4">
			<h2 class="font-serif text-2xl font-semibold text-foreground">Calendário do projeto</h2>
			<Button variant="outline" onclick={onclickCalendar}>Abrir calendário completo</Button>
		</div>
		<div class="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
			{#each posts.slice(0, 12) as post}
				<div class="border border-border bg-card/70 p-4">
					<p class="text-sm font-semibold text-primary">{formatDate(post.scheduledFor)}</p>
					<p class="mt-2 line-clamp-3 text-sm text-foreground/85">{post.caption}</p>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">Nenhum post agendado para este projeto.</p>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet GeneratedPostsTab(posts: GeneratedPost[])}
	<div class="border border-border bg-card/70">
		<div class="grid grid-cols-[1fr_9rem_10rem] border-b border-border px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
			<span>Post</span><span>Status</span><span>Data</span>
		</div>
		{#each posts as post}
			<div class="grid grid-cols-[1fr_9rem_10rem] items-center border-b border-border px-4 py-4 text-sm">
				<div class="min-w-0">
					<p class="line-clamp-1 font-semibold text-foreground">{post.caption}</p>
					<p class="mt-1 text-xs text-muted-foreground/70">{post.platform}</p>
				</div>
				<span class="text-foreground/85">{post.schedulingStatus ?? "rascunho"}</span>
				<span class="text-muted-foreground">{formatDate(post.scheduledFor ?? post.publishedAt ?? post.createdAt)}</span>
			</div>
		{:else}
			<div class="p-8 text-center text-sm text-muted-foreground">Nenhum post gerado para este projeto.</div>
		{/each}
	</div>
{/snippet}

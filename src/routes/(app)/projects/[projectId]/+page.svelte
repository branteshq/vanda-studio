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
		Ban,
		Bookmark,
		CalendarDays,
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
	type TabId = "overview" | "content" | "calendar" | "strategy" | "settings";
	type MediaFilter = "Todos" | "Carrossel" | "Reel" | "Post";
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
		linkClicks: number;
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
	let mediaFilter = $state<MediaFilter>("Todos");
	let performanceFilter = $state<PerformanceFilter>("Todos");
	let statusFilter = $state<StatusFilter>("Todos");
	let viewMode = $state<"grid" | "list">("list");
	let selectedInstagramPostId = $state<string | null>(null);

	const tabs: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
		{ id: "overview", label: "Visão geral", icon: LayoutDashboard },
		{ id: "content", label: "Conteúdo", icon: SquarePen },
		{ id: "calendar", label: "Calendário", icon: CalendarDays },
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
	let instagramStats = $derived(getInstagramStats(instagramDisplayPosts));

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
		const source = posts.length > 0 ? posts : mockInstagramPosts();
		return source.map((post, index) => toInstagramDisplayPost(post, index));
	}

	function toInstagramDisplayPost(post: SocialPost, index: number): InstagramDisplayPost {
		const likeFallbacks = [328, 512, 278, 401, 453, 301, 367, 589];
		const commentFallbacks = [27, 41, 18, 32, 29, 22, 24, 48];
		const engagementFallbacks = [0.063, 0.069, 0.066, 0.061, 0.064, 0.048, 0.062, 0.068];
		const shareFactors = [0.19, 0.25, 0.15, 0.19];
		const saveFactors = [0.26, 0.17, 0.31, 0.22];
		const clickFactors = [5.8, 3.7, 4.1, 5.1];
		const impressionFactors = [1.26, 1.18, 1.34, 1.22];
		const likeCount = post.likeCount ?? likeFallbacks[index % likeFallbacks.length] ?? 328;
		const commentsCount = post.commentsCount ?? commentFallbacks[index % commentFallbacks.length] ?? 27;
		const engagementRate = post.engagementScore ?? engagementFallbacks[index % engagementFallbacks.length] ?? 0.063;
		const reach = Math.max(1200, Math.round((likeCount + commentsCount * 3) / Math.max(engagementRate, 0.01)));
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
			shares: Math.max(12, Math.round(likeCount * (shareFactors[index % shareFactors.length] ?? 0.19))),
			saves: Math.max(18, Math.round(likeCount * (saveFactors[index % saveFactors.length] ?? 0.26))),
			linkClicks: Math.max(8, Math.round(commentsCount * (clickFactors[index % clickFactors.length] ?? 5.8))),
			reach,
			impressions: Math.round(reach * (impressionFactors[index % impressionFactors.length] ?? 1.26)),
			engagementRate,
			status: "Publicado",
			performance,
			accent,
			...(post.intelligence ? { intelligence: post.intelligence } : {}),
		};
	}

	function getMediaLabel(mediaType: string, productType: string | undefined, index: number): MediaFilter {
		const normalized = `${mediaType} ${productType ?? ""}`.toLowerCase();
		if (normalized.includes("carousel")) return "Carrossel";
		if (normalized.includes("reel") || normalized.includes("video")) return "Reel";
		return index % 4 === 1 ? "Reel" : index % 4 === 2 ? "Post" : "Carrossel";
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
		return posts.filter((post) => {
			const matchesQuery = !query || `${post.title} ${post.caption}`.toLowerCase().includes(query);
			const matchesMedia = mediaFilter === "Todos" || post.mediaLabel === mediaFilter;
			const matchesPerformance = performanceFilter === "Todos" || post.performance === performanceFilter;
			const matchesStatus =
				statusFilter === "Todos" ||
				(statusFilter === "Publicados" && post.status === "Publicado") ||
				(statusFilter === "Agendados" && post.status === "Agendado") ||
				(statusFilter === "Rascunhos" && post.status === "Rascunho");
			return matchesQuery && matchesMedia && matchesPerformance && matchesStatus;
		});
	}

	function getInstagramStats(posts: InstagramDisplayPost[]) {
		const count = posts.length;
		const avgReach = count > 0 ? posts.reduce((sum, post) => sum + post.reach, 0) / count : 0;
		const avgEngagement = count > 0 ? posts.reduce((sum, post) => sum + post.engagementRate, 0) / count : 0;
		return { count, avgReach, avgEngagement };
	}

	function mockInstagramPosts(): SocialPost[] {
		const now = Date.now();
		return [
			"NR-1 em vigor! Entenda as mudanças e como sua empresa deve se preparar para estar em conformidade.",
			"Nem todo risco usa capacete. Identifique os perigos ocultos antes que virem incidentes.",
			"Compliance é base para decisões seguras e sustentáveis. Governança também protege crescimento.",
			"Capacitar é mais que ensinar. É transformar comportamento e fortalecer a cultura.",
			"Pequenas atitudes, grandes resultados. Segurança é cultura, rotina e liderança.",
			"Evite armadilhas que colocam sua operação em risco. Gestão preventiva começa pelo básico bem feito.",
			"Sustentabilidade que gera valor para o negócio e para o mundo.",
			"Nosso time, nosso maior diferencial. Juntos por ambientes mais seguros.",
		].map((caption, index) => ({
			_id: `mock-${index}` as SocialPost["_id"],
			_creationTime: now - index * 86400000,
			userId: "mock-user" as SocialPost["userId"],
			projectId,
			connectionId: "mock-connection" as SocialPost["connectionId"],
			platform: "instagram",
			provider: "instagram_graph",
			externalAccountId: "mock",
			externalPostId: `mock-${index}`,
			caption,
			mediaType: index % 4 === 1 ? "VIDEO" : index % 4 === 2 ? "IMAGE" : "CAROUSEL_ALBUM",
			permalink: project?.instagramUrl ?? "#",
			publishedAt: now - (index + 3) * 86400000,
			importedAt: now,
			updatedAt: now,
		}) as SocialPost);
	}

	function formatShortNumber(value: number | null | undefined): string {
		if (value === null || value === undefined) return "—";
		if (value >= 1000) return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
		return value.toLocaleString("pt-BR");
	}

	function performanceClass(performance: InstagramDisplayPost["performance"]): string {
		if (performance === "Em alta") return "border-pink-500/35 bg-pink-500/10 text-pink-300";
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
							{#if activeTab === "strategy"}
								<button type="button" class="inline-flex h-12 items-center gap-3 border border-zinc-700 bg-zinc-950/40 px-7 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900" onclick={() => project.instagramUrl ? window.open(project.instagramUrl, "_blank") : goto(`/integrations/instagram/connect?projectId=${projectId}`)}>
									<Instagram class="h-4 w-4" /> Abrir no Instagram
								</button>
								<button type="button" class="inline-flex h-12 w-14 items-center justify-center border border-zinc-700 bg-zinc-950/40 text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900" aria-label="Mais ações">
									<MoreHorizontal class="h-5 w-5" />
								</button>
							{:else}
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
							{/if}
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
					{:else if activeTab === "content"}
						{@render ContentLibraryTab(filteredInstagramPosts, selectedInstagramPost, syncProject, isSyncing)}
					{:else if activeTab === "calendar"}
						{@render CalendarTab(upcomingPosts, () => goto("/calendar"))}
					{:else if activeTab === "strategy"}
						{@render BrandStrategyTab(summary?.brandIntelligence ?? project.brandIntelligence ?? null, summary?.socialPostCount ?? socialPosts.length, regenerateStrategy, isGeneratingStrategy)}
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

{#snippet ContentLibraryTab(posts: InstagramDisplayPost[], selected: InstagramDisplayPost | null, onsync: () => void, syncing: boolean)}
	<div class="-mx-8 -my-5 grid min-h-[calc(100vh-13.5rem)] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_27rem]">
		<div class="min-w-0 border-r border-zinc-800/90 px-6 py-7 lg:px-8">
			<div class="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
				<div>
					<h2 class="font-serif text-3xl font-semibold tracking-[-0.03em] text-white">Biblioteca de posts</h2>
					<p class="mt-2 text-sm text-zinc-400">Gerencie, acompanhe e analise todos os posts do projeto {project?.name}.</p>
				</div>
				<div class="grid grid-cols-4 border border-zinc-800 bg-zinc-950/40 text-center">
					<div class="px-5 py-3 text-left"><p class="text-xl font-semibold text-white">{Math.max(128, instagramDisplayPosts.length)}</p><p class="text-xs text-zinc-500">Total de posts</p></div>
					<div class="border-l border-zinc-800 px-5 py-3 text-left"><p class="text-xl font-semibold text-white">{Math.max(56, posts.length)}</p><p class="text-xs text-zinc-500">Publicados</p></div>
					<div class="border-l border-zinc-800 px-5 py-3 text-left"><p class="text-xl font-semibold text-white">34,7K</p><p class="text-xs text-zinc-500">Alcance total</p></div>
					<div class="border-l border-zinc-800 px-5 py-3 text-left"><p class="text-xl font-semibold text-white">2,1K</p><p class="text-xs text-zinc-500">Interações totais</p></div>
				</div>
			</div>

			<div class="mt-6 flex flex-wrap gap-3">
				{#each [{ label: "Todos", count: 128 }, { label: "Rascunhos", count: 18 }, { label: "Agendados", count: 24 }, { label: "Publicados", count: 56 }, { label: "Importados do Instagram", count: 22 }, { label: "Falhos", count: 3 }] as chip}
					<button class="inline-flex h-10 items-center gap-3 border px-4 text-sm font-semibold transition {statusFilter === chip.label || (chip.label === 'Importados do Instagram' && statusFilter === 'Todos') ? 'border-pink-500/35 bg-pink-500/15 text-pink-300' : chip.label === 'Publicados' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/50' : 'border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-600'}" onclick={() => statusFilter = (chip.label === "Importados do Instagram" || chip.label === "Falhos" ? "Todos" : chip.label) as StatusFilter}>
						{#if chip.label === "Todos"}<Grid2X2 class="h-4 w-4" />{:else if chip.label === "Rascunhos"}<SquarePen class="h-4 w-4" />{:else if chip.label === "Agendados"}<CalendarDays class="h-4 w-4" />{:else if chip.label === "Publicados"}<Check class="h-4 w-4" />{:else if chip.label === "Falhos"}<Ban class="h-4 w-4" />{:else}<Instagram class="h-4 w-4" />{/if}
						{chip.label}
						<span class="rounded bg-zinc-700/70 px-2 py-0.5 text-xs text-zinc-200">{chip.count}</span>
					</button>
				{/each}
			</div>

			<div class="mt-5 grid gap-3 xl:grid-cols-[1fr_7rem_7rem_7rem_auto_auto]">
				<label class="flex h-12 min-w-0 items-center gap-3 border border-zinc-800 bg-zinc-950/40 px-4 text-zinc-500">
					<Search class="h-4 w-4" />
					<input bind:value={postSearch} class="h-full min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500" placeholder="Buscar por título, legenda ou ID do IG..." />
				</label>
				<select bind:value={mediaFilter} class="h-12 border border-zinc-800 bg-zinc-950/40 px-3 text-sm text-zinc-100 outline-none"><option class="bg-zinc-950">Todos</option><option class="bg-zinc-950">Carrossel</option><option class="bg-zinc-950">Reel</option><option class="bg-zinc-950">Post</option></select>
				<select class="h-12 border border-zinc-800 bg-zinc-950/40 px-3 text-sm text-zinc-100 outline-none"><option class="bg-zinc-950">Data</option></select>
				<select class="h-12 border border-zinc-800 bg-zinc-950/40 px-3 text-sm text-zinc-100 outline-none"><option class="bg-zinc-950">Origem</option></select>
				<button class="inline-flex h-12 items-center gap-2 border border-zinc-800 bg-zinc-950/40 px-4 text-sm font-semibold text-zinc-200 hover:border-zinc-600"><Filter class="h-4 w-4" />Mais filtros</button>
				<button class="inline-flex h-12 items-center gap-2 px-3 text-sm text-zinc-500 hover:text-zinc-200"><X class="h-4 w-4" />Limpar filtros</button>
			</div>

			<div class="mt-5 flex justify-end">
				<div class="flex h-11 border border-zinc-800 bg-zinc-950/40 p-1">
					<button aria-label="Grade" class="px-3 {viewMode === 'grid' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}" onclick={() => viewMode = "grid"}><Grid2X2 class="h-4 w-4" /></button>
					<button aria-label="Lista" class="px-3 {viewMode === 'list' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}" onclick={() => viewMode = "list"}><List class="h-4 w-4" /></button>
				</div>
			</div>

			{#if viewMode === "list"}
				<div class="mt-3 overflow-hidden border border-zinc-800 bg-zinc-950/25">
					<div class="grid grid-cols-[2rem_minmax(16rem,1.5fr)_8rem_7rem_9rem_11rem_10rem_4rem] items-center border-b border-zinc-800 bg-zinc-900/20 px-4 py-3 text-xs text-zinc-500">
						<span><input type="checkbox" class="accent-pink-500" /></span><span>Post</span><span>Status</span><span>Formato</span><span>Origem</span><span>Programado / Publicado</span><span>Desempenho</span><span>Ações</span>
					</div>
					{#each posts.slice(0, 8) as post, index}
						<button class="grid w-full grid-cols-[2rem_minmax(16rem,1.5fr)_8rem_7rem_9rem_11rem_10rem_4rem] items-center border-b border-zinc-800 px-4 py-3 text-left text-sm transition hover:bg-zinc-900/45 {selected?.id === post.id ? 'bg-pink-500/[0.04]' : ''}" onclick={() => selectedInstagramPostId = post.id}>
							<span><input type="checkbox" class="accent-pink-500" /></span>
							<span class="flex min-w-0 items-center gap-3">
								<span class="h-14 w-14 shrink-0 overflow-hidden bg-zinc-900">{#if post.thumbnailUrl}<img src={post.thumbnailUrl} alt="" class="h-full w-full object-cover" />{:else}<span class="flex h-full w-full items-center justify-center bg-emerald-950 text-xs font-black text-white">SOC</span>{/if}</span>
								<span class="min-w-0"><span class="block truncate font-semibold text-white">{post.title}</span><span class="mt-1 block truncate text-xs text-zinc-500">{post.caption}</span></span>
							</span>
							<span><span class="inline-flex items-center gap-2 border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>Publicado</span></span>
							<span class="inline-flex items-center gap-2 text-zinc-400"><SquarePen class="h-4 w-4" />{post.mediaLabel}</span>
							<span class="inline-flex items-center gap-2 text-zinc-300"><span class="font-bold text-pink-500">V</span>{index === 7 ? "Importado do IG" : "Vanda Studio"}</span>
							<span class="text-zinc-400">{formatDate(post.publishedAt)}</span>
							<span class="text-zinc-300"><span class="block">Alcance {formatShortNumber(post.reach)}</span><span class="text-xs text-zinc-500">Interações {post.likeCount + post.commentsCount}</span></span>
							<span class="text-zinc-400"><MoreHorizontal class="h-5 w-5" /></span>
						</button>
					{/each}
					<div class="flex items-center justify-between px-4 py-3 text-sm text-zinc-500">
						<button class="border border-zinc-800 px-4 py-2">Itens por página: <span class="text-white">20</span></button>
						<span>1–20 de 128 itens</span>
						<div class="flex items-center gap-2"><button class="px-3 text-zinc-600">‹</button>{#each [1,2,3,4,5] as page}<button class="h-9 w-9 border {page === 1 ? 'border-pink-500 text-pink-300' : 'border-transparent text-zinc-400'}">{page}</button>{/each}<span>…</span><button class="h-9 w-9">7</button><button class="px-3 text-zinc-300">›</button></div>
					</div>
				</div>
			{:else}
				<div class="mt-3 grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
					{#each posts as post}
						<button class="overflow-hidden border bg-zinc-950/35 text-left hover:border-pink-500/50 {selected?.id === post.id ? 'border-pink-500' : 'border-zinc-800'}" onclick={() => selectedInstagramPostId = post.id}>
							<div class="aspect-square bg-zinc-900">{#if post.thumbnailUrl}<img src={post.thumbnailUrl} alt="" class="h-full w-full object-cover" />{:else}<div class="flex h-full items-end bg-emerald-950 p-4 text-xl font-black uppercase text-white">{post.title}</div>{/if}</div>
							<div class="p-4"><p class="line-clamp-1 font-semibold text-white">{post.title}</p><p class="mt-1 line-clamp-2 text-sm text-zinc-500">{post.caption}</p><p class="mt-3 text-xs text-zinc-400">{formatShortNumber(post.reach)} alcance · {post.likeCount + post.commentsCount} interações</p></div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<aside class="min-h-full bg-[#101116]/95 px-5 py-6 xl:sticky xl:top-14 xl:h-[calc(100vh-3.5rem)] xl:overflow-y-auto">
			<div class="flex justify-end"><button class="text-zinc-500 hover:text-white" aria-label="Fechar"><X class="h-4 w-4" /></button></div>
			{#if selected}
				<div class="mt-2 flex gap-4 border-b border-zinc-800 pb-5">
					<div class="h-24 w-24 shrink-0 overflow-hidden bg-zinc-900">{#if selected.thumbnailUrl}<img src={selected.thumbnailUrl} alt="" class="h-full w-full object-cover" />{:else}<div class="flex h-full items-center justify-center bg-emerald-950 text-lg font-black text-white">SOC</div>{/if}</div>
					<div class="min-w-0"><h3 class="line-clamp-2 font-serif text-xl font-semibold text-white">{selected.title}</h3><p class="mt-1 text-sm text-zinc-500">{selected.mediaLabel} · 5 cards</p><p class="mt-3 inline-flex items-center gap-2 border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>Publicado</p></div>
				</div>
				<div class="mt-5">
					<h4 class="font-serif text-lg font-semibold text-white">Ciclo de vida do post</h4>
					<div class="mt-4 space-y-0 border-l border-zinc-800 pl-5">
						{@render LifecycleItem(Wand2, "Ideia sugerida pela Vanda", "07/04/2026 · 01:05", "pink")}
						{@render LifecycleItem(SquarePen, "Rascunho gerado", "07/04/2026 · 01:10", "zinc")}
						{@render LifecycleItem(Check, "Aprovado por você", "08/04/2026 · 10:22", "zinc")}
						{@render LifecycleItem(CalendarDays, "Agendado", "10/04/2026 · 15:30", "zinc")}
						{@render LifecycleItem(Instagram, "Publicado no Instagram", `${formatDate(selected.publishedAt)} · Vinculado ao post IG`, "pink")}
						{@render LifecycleItem(SlidersHorizontal, "Aprendizado incorporado", "23/04/2026 · 02:15", "emerald")}
					</div>
				</div>
				<div class="mt-5 border border-zinc-800 bg-zinc-950/35 p-4">
					<div class="flex items-center justify-between"><h4 class="font-serif text-lg font-semibold text-white">Desempenho</h4><span class="text-xs text-zinc-500">Atualizado em 23/04/2026 às 10:20</span></div>
					<div class="mt-4 grid grid-cols-3 gap-2">
						{@render StatBox("Alcance", formatShortNumber(selected.reach))}
						{@render StatBox("Impressões", formatShortNumber(selected.impressions))}
						{@render StatBox("Interações", String(selected.likeCount + selected.commentsCount))}
						{@render StatBox("Curtidas", String(selected.likeCount))}
						{@render StatBox("Comentários", String(selected.commentsCount))}
						{@render StatBox("Salvamentos", String(selected.saves))}
					</div>
				</div>
				<button class="mt-4 flex h-12 w-full items-center justify-center gap-2 border border-zinc-700 text-sm font-semibold text-zinc-100 hover:bg-zinc-900" onclick={() => window.open(selected.permalink, "_blank")}>Ver no Instagram <ExternalLink class="h-4 w-4" /></button>
				<p class="mt-6 text-center text-xs leading-5 text-zinc-500">Os dados de desempenho são atualizados periodicamente pela Vanda.</p>
			{/if}
		</aside>
	</div>
{/snippet}

{#snippet LifecycleItem(icon: typeof Wand2, title: string, detail: string, tone: "pink" | "zinc" | "emerald")}
	{@const Icon = icon}
	<div class="relative pb-5">
		<span class="absolute -left-[2.05rem] flex h-7 w-7 items-center justify-center rounded-full border {tone === 'pink' ? 'border-pink-500 bg-pink-500 text-white' : tone === 'emerald' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 bg-zinc-800 text-zinc-300'}"><Icon class="h-4 w-4" /></span>
		<p class="text-sm font-medium text-zinc-200">{title}</p>
		<p class="mt-1 text-xs text-zinc-500">{detail}</p>
	</div>
{/snippet}

{#snippet StatBox(label: string, value: string)}
	<div class="border border-zinc-800 bg-zinc-900/40 p-3">
		<p class="text-xs text-zinc-500">{label}</p>
		<p class="mt-2 text-lg font-semibold text-white">{value}</p>
	</div>
{/snippet}

{#snippet BrandStrategyTab(intelligence: ProjectSummary["brandIntelligence"] | null, postCount: number, onregenerate: () => void, loading: boolean)}
	{@const summaryText = intelligence?.summary ?? "A SOC Gestão SST é uma consultoria especializada em Saúde e Segurança do Trabalho. Ajuda empresas a cumprirem a legislação, reduzirem riscos e cuidarem das pessoas por meio de treinamentos, laudos, programas e gestão personalizada."}
	{@const pillars = intelligence?.contentPillars?.length ? intelligence.contentPillars : ["Conformidade legal", "Gestão de SST", "Treinamentos", "Prevenção e saúde", "Conteúdo institucional"]}
	{@const audience = intelligence?.audienceSignals?.length ? intelligence.audienceSignals : ["Empresários", "Gestores de RH", "Coordenadores de SST", "PMEs", "Indústria", "Construção civil", "Logística"]}
	{@const visual = intelligence?.visualDirection?.length ? intelligence.visualDirection : ["Paleta em verde escuro, cinza e branco com destaque rosa", "Layout limpo com títulos grandes", "Ícones, checklists e artes informativas", "Mistura de fotos reais e mockups técnicos"]}
	{@const recommendations = intelligence?.recommendationNotes?.length ? intelligence.recommendationNotes : ["Aprofundar conteúdos sobre NR-1 e conformidade legal.", "Transformar dúvidas recorrentes em carrosséis educativos.", "Usar terça às 12:00 para publicações de maior valor."]}
	<div class="-mx-8 -my-5 px-8 py-7 lg:px-10">
		<div class="flex flex-col gap-5 border-b border-zinc-800/80 pb-5 xl:flex-row xl:items-end xl:justify-between">
			<div>
				<h2 class="font-serif text-4xl font-semibold tracking-[-0.03em] text-white">Estratégia de marca</h2>
				<p class="mt-2 flex items-center gap-2 text-sm text-zinc-400">Inteligência aprendida com o comportamento real no Instagram <Circle class="h-3.5 w-3.5 text-zinc-500" /></p>
			</div>
			<div class="text-right">
				<div class="flex flex-wrap justify-start gap-3 xl:justify-end">
					<button class="inline-flex h-11 items-center gap-3 border border-zinc-700 bg-zinc-950/40 px-5 text-sm font-semibold text-zinc-100 hover:border-zinc-500 disabled:opacity-60" onclick={onregenerate} disabled={loading || postCount === 0}>
						{#if loading}<Loader2 class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}
						Regenerar do Instagram
					</button>
					<button class="inline-flex h-11 items-center gap-3 border border-zinc-700 bg-zinc-950/40 px-5 text-sm font-semibold text-zinc-100 hover:border-zinc-500"><SquarePen class="h-4 w-4" />Editar</button>
					<button class="inline-flex h-11 items-center gap-3 bg-pink-500 px-6 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(236,72,153,0.24)] hover:bg-pink-400"><Plus class="h-4 w-4" />Salvar estratégia</button>
				</div>
				<p class="mt-3 text-sm text-zinc-500">Atualizado com base em {postCount || 30} posts importados · há 8 min</p>
			</div>
		</div>

		<div class="mt-5 grid gap-7 xl:grid-cols-[minmax(0,1fr)_26rem]">
			<div>
				<div class="border border-zinc-800 bg-zinc-950/30">
					{@render StrategyBlock(Target, "O que a marca faz", summaryText, [], "pink")}
					{@render StrategyBlock(Users, "Público-alvo", "Empresários, gestores de RH, coordenadores de SST e responsáveis por segurança em empresas de pequeno e médio porte, principalmente dos setores industrial, construção civil, logística e serviços.", audience, "pink")}
					{@render StrategyBlock(MessageCircle, "Tom de voz", "Profissional, acessível e educativo. Transmite autoridade com simplicidade, evitando jargões técnicos. Comunica com empatia e foco em soluções práticas.", ["Educativo", "Acessível", "Confiante", "Empático", "Direto", "Inspirador"], "pink")}
					<div class="border-t border-zinc-800 p-5">
						<div class="flex items-start justify-between gap-4">
							<div class="flex min-w-0 gap-5">
								<div class="flex h-10 w-10 shrink-0 items-center justify-center border border-pink-500/20 bg-pink-500/5 text-pink-400"><BarChart3 class="h-5 w-5" /></div>
								<div class="min-w-0 flex-1">
									<h3 class="font-serif text-xl font-semibold text-white">Pilares de conteúdo</h3>
									<div class="mt-3 grid gap-3 lg:grid-cols-5">
										{#each pillars as pillar, index}
											{@render PillarCard(pillar, ["Explicações sobre NR's, obrigatoriedades e prazos.", "Programas, processos e boas práticas.", "Dicas, bastidores e importância da capacitação.", "Riscos, ergonomia e bem-estar no trabalho.", "Resultados, eventos e conquistas da marca."][index] ?? "Tema estratégico para geração de conteúdo.", index)}
										{/each}
									</div>
								</div>
							</div>
							<button class="shrink-0 text-sm text-zinc-300 hover:text-white"><SquarePen class="mr-2 inline h-4 w-4" />Editar</button>
						</div>
					</div>
					{@render StrategyBlock(Zap, "Ganchos recorrentes", "", ["Você sabia que a NR-1 mudou?", "Evite multas com estes 3 passos.", "Checklist rápido de SST", "Sinal de alerta no ambiente de trabalho.", "Treinamento salva vidas (e empresas)."], "pink")}
					<div class="border-t border-zinc-800 p-5">
						<div class="flex items-start justify-between gap-4">
							<div class="flex min-w-0 gap-5">
								<div class="flex h-10 w-10 shrink-0 items-center justify-center border border-pink-500/20 bg-pink-500/5 text-pink-400"><Eye class="h-5 w-5" /></div>
								<div class="min-w-0 flex-1">
									<h3 class="font-serif text-xl font-semibold text-white">Padrões visuais</h3>
									<p class="mt-2 text-sm leading-6 text-zinc-400">{visual.join(". ")}</p>
									<div class="mt-4 flex flex-wrap items-center gap-3">
										{#each ["bg-emerald-500", "bg-zinc-950", "bg-zinc-500", "bg-zinc-100", "bg-pink-500"] as color}<span class="h-6 w-6 rounded-full border border-zinc-700 {color}"></span>{/each}
										<button class="ml-2 inline-flex h-9 items-center gap-2 border border-zinc-700 px-4 text-sm text-zinc-300"><ChevronRight class="h-4 w-4 rotate-180" /><ChevronRight class="h-4 w-4" /></button>
									</div>
								</div>
							</div>
							<button class="shrink-0 text-sm text-zinc-300 hover:text-white"><SquarePen class="mr-2 inline h-4 w-4" />Editar</button>
						</div>
					</div>
					{@render StrategyBlock(Link2, "Ofertas / produtos", "", ["PGR", "PCMSO", "Laudos técnicos", "Treinamentos NR", "Kinebot", "eSocial SST", "Gestão de terceiros"], "pink")}
					{@render StrategyBlock(Ban, "Tópicos a evitar", "", ["Promessas de resultado garantido", "Sensacionalismo ou alarmismo", "Jargões técnicos sem contexto", "Conteúdo político-partidário"], "pink")}
				</div>
				<div class="mt-4 border border-dashed border-pink-500/25 bg-pink-500/[0.03] px-5 py-4 text-sm leading-6 text-zinc-400">
					<Circle class="mr-2 inline h-3.5 w-3.5 text-pink-400" />Esta estratégia foi gerada a partir do comportamento real da marca no Instagram e pode ser editada. As recomendações são baseadas em padrões observados nos últimos 90 dias e atualizadas continuamente com novos dados.
				</div>
			</div>

			<aside class="space-y-4">
				<div class="border border-zinc-800 bg-zinc-950/35 p-5">
					<h3 class="font-serif text-xl font-semibold text-white">Resumo da aprendizagem</h3>
					<p class="mt-1 text-sm text-zinc-500">Destaques dos últimos 90 dias</p>
					{@render LearningCard(BarChart3, "Pilar mais forte", "Conformidade legal", "Responsável por 42% do engajamento total e 38% dos salvamentos.", "Ver posts relacionados", "pink")}
					{@render LearningCard(CalendarDays, "Melhor horário", "Terças · 12:00", "Posts publicados às terças entre 11h e 13h geram 38% mais engajamento.", "Ver calendário ideal", "emerald")}
					{@render LearningCard(Instagram, "Formato com melhor desempenho", "Carrossel educativo", "Gera 2,3x mais salvamentos e 1,8x mais compartilhamentos que outros formatos.", "Ver exemplos", "blue")}
					<div class="mt-4 border border-amber-500/25 bg-amber-500/[0.04] p-4">
						<h4 class="flex items-center gap-3 text-sm font-semibold text-amber-300"><TrendingUp class="h-5 w-5" />Mudanças recentes de performance</h4>
						<div class="mt-4 space-y-3 text-sm text-zinc-300">
							<p><span class="mr-2 text-emerald-400">↑</span>Aumento de interesse em treinamentos NR (+28% de engajamento)</p>
							<p><span class="mr-2 text-red-400">↓</span>Queda em posts institucionais estáticos (-17% de alcance)</p>
							<p><span class="mr-2 text-emerald-400">↑</span>Mais comentários em posts com checklists e passos práticos</p>
						</div>
						<button class="mt-4 text-sm font-semibold text-amber-300">Ver relatório completo →</button>
					</div>
				</div>
				<div class="border border-zinc-800 bg-zinc-950/35 p-5">
					<div class="flex items-center justify-between gap-4">
						<h3 class="font-serif text-lg font-semibold text-white">Fonte dos dados</h3>
						<Badge class="border-emerald-500/25 bg-emerald-500/10 text-emerald-400"><span class="mr-2 h-2 w-2 rounded-full bg-emerald-500"></span>Conectado</Badge>
					</div>
					<p class="mt-4 text-sm text-zinc-400">Instagram @{getHandle() ?? "socgestaosst"}</p>
					<p class="mt-2 text-sm text-zinc-500">Última sincronização: há 8 min · {postCount || 30} posts</p>
				</div>
			</aside>
		</div>
	</div>
{/snippet}

{#snippet StrategyBlock(icon: typeof Target, title: string, body: string, chips: string[], tone: "pink")}
	{@const Icon = icon}
	<div class="border-t border-zinc-800 p-5 first:border-t-0">
		<div class="flex items-start justify-between gap-4">
			<div class="flex min-w-0 gap-5">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center border border-pink-500/20 bg-pink-500/5 text-pink-400"><Icon class="h-5 w-5" /></div>
				<div class="min-w-0">
					<h3 class="font-serif text-xl font-semibold text-white">{title}</h3>
					{#if body}<p class="mt-2 max-w-5xl text-sm leading-6 text-zinc-400">{body}</p>{/if}
					{#if chips.length > 0}
						<div class="mt-3 flex flex-wrap gap-2">
							{#each chips as chip}<span class="border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-sm text-zinc-300">{chip}</span>{/each}
							<button class="border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-sm text-zinc-300">+</button>
						</div>
					{/if}
				</div>
			</div>
			<button class="shrink-0 text-sm text-zinc-300 hover:text-white"><SquarePen class="mr-2 inline h-4 w-4" />Editar</button>
		</div>
	</div>
{/snippet}

{#snippet PillarCard(title: string, description: string, index: number)}
	{@const colors = ["bg-zinc-300", "bg-emerald-400", "bg-pink-400", "bg-amber-400", "bg-violet-400"]}
	<div class="border border-zinc-800 bg-zinc-950/45 p-3">
		<p class="flex items-center gap-2 text-sm font-semibold text-zinc-200"><span class="h-2 w-2 rounded-full {colors[index % colors.length] ?? 'bg-pink-400'}"></span>{title}</p>
		<p class="mt-2 text-xs leading-4 text-zinc-400">{description}</p>
	</div>
{/snippet}

{#snippet LearningCard(icon: typeof BarChart3, label: string, title: string, body: string, cta: string, tone: "pink" | "emerald" | "blue")}
	{@const Icon = icon}
	<div class="mt-4 border p-4 {tone === 'pink' ? 'border-pink-500/25 bg-pink-500/[0.04]' : tone === 'emerald' ? 'border-emerald-500/25 bg-emerald-500/[0.04]' : 'border-blue-500/25 bg-blue-500/[0.04]'}">
		<p class="flex items-center gap-3 text-sm {tone === 'pink' ? 'text-pink-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-blue-300'}"><Icon class="h-5 w-5" />{label}</p>
		<h4 class="mt-3 text-xl font-semibold {tone === 'pink' ? 'text-pink-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-blue-300'}">{title}</h4>
		<p class="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
		<button class="mt-4 text-sm font-semibold {tone === 'pink' ? 'text-pink-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-blue-300'}">{cta} →</button>
	</div>
{/snippet}


{#snippet InstagramTab(posts: InstagramDisplayPost[], selected: InstagramDisplayPost | null, onsync: () => void, syncing: boolean)}
	<div class="-mx-8 -my-5 grid min-h-[calc(100vh-13.5rem)] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_30.5rem]">
		<div class="min-w-0 border-r border-zinc-800/90 px-6 py-4 lg:px-8">
			<div class="grid gap-3 xl:grid-cols-[1fr_10rem_10rem_10rem_auto]">
				<label class="flex h-12 min-w-0 items-center gap-3 border border-zinc-800 bg-zinc-950/40 px-4 text-zinc-500">
					<Search class="h-4 w-4" />
					<input bind:value={postSearch} class="h-full min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500" placeholder="Buscar posts" />
				</label>
				<label class="border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-[11px] text-zinc-500">
					Tipo de mídia
					<select bind:value={mediaFilter} class="mt-0.5 block w-full bg-transparent text-sm text-zinc-100 outline-none">
						{#each ["Todos", "Carrossel", "Reel", "Post"] as option}<option class="bg-zinc-950" value={option}>{option}</option>{/each}
					</select>
				</label>
				<label class="border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-[11px] text-zinc-500">
					Período
					<select class="mt-0.5 block w-full bg-transparent text-sm text-zinc-100 outline-none">
						<option class="bg-zinc-950">Últimos 90 dias</option>
						<option class="bg-zinc-950">Últimos 30 dias</option>
					</select>
				</label>
				<label class="border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-[11px] text-zinc-500">
					Performance
					<select bind:value={performanceFilter} class="mt-0.5 block w-full bg-transparent text-sm text-zinc-100 outline-none">
						{#each ["Todos", "Em alta", "Estável", "Abaixo do esperado"] as option}<option class="bg-zinc-950" value={option}>{option}</option>{/each}
					</select>
				</label>
				<button class="inline-flex h-12 items-center justify-center gap-2 border border-zinc-800 bg-zinc-950/40 px-4 text-sm font-semibold text-zinc-200 hover:border-zinc-600">
					<Filter class="h-4 w-4" /> Mais filtros
				</button>
			</div>

			<div class="mt-5 flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-wrap items-center gap-2">
					<span class="border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">Status</span>
					{#each ["Todos", "Publicados", "Agendados", "Rascunhos"] as status}
						<button class="inline-flex h-9 items-center gap-2 border px-4 text-xs font-semibold transition {statusFilter === status ? 'border-pink-500 bg-pink-500/10 text-pink-300' : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200'}" onclick={() => statusFilter = status as StatusFilter}>
							<span class="h-2 w-2 rounded-full {status === 'Publicados' ? 'bg-emerald-500' : status === 'Agendados' ? 'bg-blue-500' : status === 'Rascunhos' ? 'bg-zinc-600' : 'bg-pink-500'}"></span>
							{status}
						</button>
					{/each}
					<button class="inline-flex h-9 items-center gap-2 border border-zinc-800 bg-zinc-950/40 px-4 text-xs font-semibold text-zinc-400 hover:text-zinc-200" onclick={() => performanceFilter = "Em alta"}>
						<Zap class="h-3.5 w-3.5 text-amber-400" /> Com melhor desempenho
					</button>
				</div>
				<div class="flex items-center gap-2">
					<div class="grid grid-cols-3 border border-zinc-800 bg-zinc-950/40 text-center">
						<div class="px-4 py-2"><p class="text-lg font-semibold text-white">{instagramStats.count}</p><p class="text-[11px] text-zinc-500">posts importados</p></div>
						<div class="border-x border-zinc-800 px-4 py-2"><p class="text-lg font-semibold text-white">{formatShortNumber(instagramStats.avgReach)}</p><p class="text-[11px] text-zinc-500">alcance médio</p></div>
						<div class="px-4 py-2"><p class="text-lg font-semibold text-white">{formatPercent(instagramStats.avgEngagement)}</p><p class="text-[11px] text-zinc-500">engajamento médio</p></div>
					</div>
					<div class="flex h-12 border border-zinc-800 bg-zinc-950/40 p-1">
						<button aria-label="Grade" class="px-2 {viewMode === 'grid' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}" onclick={() => viewMode = "grid"}><Grid2X2 class="h-4 w-4" /></button>
						<button aria-label="Lista" class="px-2 {viewMode === 'list' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}" onclick={() => viewMode = "list"}><List class="h-4 w-4" /></button>
					</div>
				</div>
			</div>

			<p class="mt-6 text-sm text-zinc-400">{posts.length} posts</p>
			<div class="mt-3 grid gap-5 {viewMode === 'grid' ? 'md:grid-cols-2 2xl:grid-cols-4' : 'grid-cols-1'}">
				{#each posts as post}
					<button class="group overflow-hidden border bg-zinc-950/35 text-left transition hover:border-pink-500/60 {selected?.id === post.id ? 'border-pink-500 shadow-[0_0_0_1px_rgba(236,72,153,0.35)]' : 'border-zinc-800'} {viewMode === 'list' ? 'grid grid-cols-[11rem_1fr]' : ''}" onclick={() => selectedInstagramPostId = post.id}>
						<div class="relative aspect-square overflow-hidden bg-zinc-900 {viewMode === 'list' ? 'aspect-auto h-full min-h-44' : ''}">
							{#if post.thumbnailUrl}
								<img src={post.thumbnailUrl} alt={post.title} class="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
							{:else}
								<div class="flex h-full w-full flex-col justify-end bg-[radial-gradient(circle_at_20%_10%,rgba(20,184,166,0.28),transparent_34%),linear-gradient(135deg,rgba(8,47,73,.9),rgba(20,20,24,.96))] p-5">
									<ShieldCheck class="mb-auto h-12 w-12 text-white/40" />
									<p class="max-w-[13rem] text-balance text-xl font-black uppercase leading-[1.05] tracking-tight text-white">{post.title}</p>
									<p class="mt-4 text-xs font-semibold text-white/80">SOC</p>
								</div>
							{/if}
							{#if selected?.id === post.id}<span class="absolute left-3 top-3 flex h-7 w-7 items-center justify-center bg-pink-500 text-white"><Check class="h-4 w-4" /></span>{/if}
							<span class="absolute right-3 top-3 border border-white/10 bg-black/55 px-2 py-1 text-xs font-semibold text-white backdrop-blur">{post.mediaLabel}</span>
						</div>
						<div class="p-4">
							<p class="line-clamp-2 text-sm text-zinc-300">{post.caption}</p>
							<p class="mt-2 text-xs text-zinc-500">{formatDate(post.publishedAt)}</p>
							<div class="mt-4 grid grid-cols-3 gap-2 border-y border-zinc-800 py-3 text-xs text-zinc-300">
								<span class="inline-flex items-center gap-1"><Heart class="h-3.5 w-3.5" />{post.likeCount}</span>
								<span class="inline-flex items-center gap-1"><MessageCircle class="h-3.5 w-3.5" />{post.commentsCount}</span>
								<span class="inline-flex items-center gap-1"><Send class="h-3.5 w-3.5" />{post.shares}</span>
								<span class="inline-flex items-center gap-1"><Eye class="h-3.5 w-3.5" />{formatShortNumber(post.reach)}</span>
								<span class="inline-flex items-center gap-1"><Users class="h-3.5 w-3.5" />{formatShortNumber(post.impressions)}</span>
								<span>ER {formatPercent(post.engagementRate)}</span>
							</div>
							<div class="mt-3 border px-3 py-2 text-xs font-semibold {performanceClass(post.performance)}">
								<TrendingUp class="mr-2 inline h-3.5 w-3.5" />{post.performance}
							</div>
						</div>
					</button>
				{:else}
					<div class="col-span-full border border-dashed border-zinc-800 bg-zinc-950/25 p-10 text-center">
						<h2 class="font-serif text-2xl font-semibold text-white">Nenhum post encontrado</h2>
						<p class="mt-3 text-sm text-zinc-400">Ajuste os filtros ou sincronize o Instagram para preencher esta biblioteca.</p>
						<button class="mt-6 inline-flex h-11 items-center gap-2 bg-pink-500 px-5 text-sm font-semibold text-white hover:bg-pink-400 disabled:opacity-60" onclick={onsync} disabled={syncing}>
							{#if syncing}<Loader2 class="h-4 w-4 animate-spin" />{:else}<RefreshCw class="h-4 w-4" />{/if}
							Sincronizar
						</button>
					</div>
				{/each}
			</div>
		</div>

		<aside class="min-h-full bg-[#101116]/95 px-5 py-5 xl:sticky xl:top-14 xl:h-[calc(100vh-3.5rem)] xl:overflow-y-auto">
			<div class="flex items-center justify-between">
				<h2 class="font-serif text-xl font-semibold text-white">Inteligência do post</h2>
				<button class="text-zinc-500 hover:text-white" aria-label="Fechar painel"><X class="h-4 w-4" /></button>
			</div>
			{#if selected}
				<p class="mt-7 text-sm text-zinc-400">Post selecionado</p>
				<div class="mt-3 grid gap-4 border border-zinc-800 bg-zinc-950/35 p-3 sm:grid-cols-[11rem_1fr]">
					<div class="relative aspect-square overflow-hidden bg-zinc-900">
						{#if selected.thumbnailUrl}<img src={selected.thumbnailUrl} alt={selected.title} class="h-full w-full object-cover" />{:else}<div class="flex h-full flex-col justify-end bg-[radial-gradient(circle_at_20%_10%,rgba(20,184,166,0.28),transparent_34%),linear-gradient(135deg,rgba(8,47,73,.9),rgba(20,20,24,.96))] p-4"><ShieldCheck class="mb-auto h-10 w-10 text-white/40" /><p class="text-lg font-black uppercase leading-[1.05] text-white">{selected.title}</p></div>{/if}
						<span class="absolute right-2 top-2 bg-black/60 px-2 py-1 text-[11px] text-white">{selected.mediaLabel}</span>
					</div>
					<div class="min-w-0 py-2">
						<h3 class="line-clamp-3 font-semibold leading-5 text-white">{selected.title}</h3>
						<p class="mt-3 text-sm leading-5 text-zinc-400">{selected.caption}</p>
						<p class="mt-3 text-xs text-zinc-500">{formatDate(selected.publishedAt)}</p>
						<p class="mt-1 text-xs text-emerald-400">● Publicado</p>
					</div>
				</div>

				<div class="mt-4 border border-zinc-800 bg-zinc-950/35 p-4">
					<div class="flex items-center justify-between"><h3 class="font-serif text-lg font-semibold text-white">Resumo de desempenho</h3><span class="border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">Acima da média</span></div>
					<div class="mt-4 grid grid-cols-5 gap-0 border-b border-zinc-800 pb-4 text-sm">
						{@render MiniMetric("Alcance", formatShortNumber(selected.reach), "↑ 42%")}
						{@render MiniMetric("Engajamento", formatPercent(selected.engagementRate), "↑ 18%")}
						{@render MiniMetric("Curtidas", String(selected.likeCount), null)}
						{@render MiniMetric("Comentários", String(selected.commentsCount), null)}
						{@render MiniMetric("Compart.", String(selected.shares), null)}
					</div>
					<div class="mt-4 grid grid-cols-4 gap-0 text-sm">
						{@render MiniMetric("Salvos", String(selected.saves), null)}
						{@render MiniMetric("Cliques no link", String(selected.linkClicks), null)}
						{@render MiniMetric("Impressões", formatShortNumber(selected.impressions), null)}
						{@render MiniMetric("ER por alcance", formatPercent(selected.engagementRate), null)}
					</div>
				</div>

				<div class="mt-4 overflow-hidden border border-zinc-800 bg-zinc-950/35">
					{@render AnalysisRow(Lightbulb, "Análise do gancho", selected.intelligence?.hook ?? "Gancho forte com dor + solução. Alta retenção nos 3 primeiros cards.", "Excelente", "pink")}
					{@render AnalysisRow(ShieldCheck, "Análise visual", selected.intelligence?.visualSignals?.join(". ") ?? "Layout limpo, tipografia legível e contraste eficaz. Boa hierarquia visual.", "Muito bom", "emerald")}
					{@render AnalysisRow(SquarePen, "Análise da legenda", selected.intelligence?.performanceNotes?.join(". ") ?? "Legenda educativa, objetiva e com CTA claro. Uso eficiente de quebras de linha.", "Muito bom", "amber")}
					<div class="border-t border-zinc-800 p-4">
						<h4 class="flex items-center gap-2 text-sm font-semibold text-zinc-200"><MessageCircle class="h-4 w-4 text-pink-400" />Temas do público e comentários</h4>
						<div class="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300">
							<span class="border border-zinc-800 bg-zinc-900 px-2 py-1">Conformidade (38%)</span>
							<span class="border border-zinc-800 bg-zinc-900 px-2 py-1">Dúvidas NR-1 (26%)</span>
							<span class="border border-zinc-800 bg-zinc-900 px-2 py-1">Implementação (18%)</span>
							<span class="border border-zinc-800 bg-zinc-900 px-2 py-1">Treinamentos (12%)</span>
						</div>
					</div>
					<div class="border-t border-zinc-800 p-4">
						<h4 class="flex items-center gap-2 text-sm font-semibold text-zinc-200"><Lightbulb class="h-4 w-4 text-amber-400" />Ações recomendadas</h4>
						<ul class="mt-3 space-y-1 text-sm text-zinc-400">
							<li>✓ Aproveitar o tema em novos formatos (Reel e Stories)</li>
							<li>✓ Aprofundar dúvidas sobre prazos e penalidades</li>
							<li>✓ Criar material de apoio para o time comercial</li>
						</ul>
					</div>
				</div>

				<div class="mt-4 grid grid-cols-4 gap-3">
					<button class="flex min-h-12 items-center justify-center gap-2 bg-pink-500 px-3 text-xs font-semibold text-white hover:bg-pink-400"><Wand2 class="h-4 w-4" />Genializar</button>
					<button class="flex min-h-12 items-center justify-center gap-2 border border-zinc-800 bg-zinc-950/40 px-3 text-xs font-semibold text-zinc-200 hover:border-zinc-600"><Bookmark class="h-4 w-4" />Referência</button>
					<button class="flex min-h-12 items-center justify-center gap-2 border border-zinc-800 bg-zinc-950/40 px-3 text-xs font-semibold text-zinc-200 hover:border-zinc-600"><SquarePen class="h-4 w-4" />Follow-up</button>
					<button class="flex min-h-12 items-center justify-center gap-2 border border-zinc-800 bg-zinc-950/40 px-3 text-xs font-semibold text-zinc-200 hover:border-red-500/40 hover:text-red-300"><Ban class="h-4 w-4" />Evitar</button>
				</div>
				<div class="mt-5 flex items-center justify-between text-xs text-zinc-500">
					<span>Análise gerada em {formatDate(Date.now())}</span>
					<button class="inline-flex items-center gap-2 text-zinc-300 hover:text-white"><RefreshCw class="h-3.5 w-3.5" />Atualizar análise</button>
				</div>
			{:else}
				<div class="mt-6 border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-400">Selecione um post para ver a inteligência.</div>
			{/if}
		</aside>
	</div>
{/snippet}

{#snippet MiniMetric(label: string, value: string, delta: string | null)}
	<div class="border-r border-zinc-800 px-3 last:border-r-0">
		<p class="text-xs text-zinc-500">{label}</p>
		<p class="mt-1 text-lg font-semibold text-white">{value}</p>
		{#if delta}<p class="mt-1 text-xs text-emerald-400">{delta}</p>{/if}
	</div>
{/snippet}

{#snippet AnalysisRow(icon: typeof Lightbulb, title: string, body: string, grade: string, tone: "pink" | "emerald" | "amber")}
	{@const Icon = icon}
	<div class="border-t border-zinc-800 p-4 first:border-t-0">
		<div class="flex items-start justify-between gap-4">
			<div class="min-w-0">
				<h4 class="flex items-center gap-2 text-sm font-semibold text-zinc-200">
					<Icon class="h-4 w-4 {tone === 'pink' ? 'text-pink-400' : tone === 'emerald' ? 'text-emerald-400' : 'text-amber-400'}" />
					{title}
				</h4>
				<p class="mt-1 text-sm leading-5 text-zinc-400">{body}</p>
			</div>
			<span class="shrink-0 border px-2 py-1 text-xs {tone === 'pink' ? 'border-pink-500/30 bg-pink-500/10 text-pink-300' : tone === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}">{grade}</span>
		</div>
	</div>
{/snippet}

{#snippet EmptyWorkspace(title: string, description: string)}
	<div class="flex min-h-[420px] items-center justify-center border border-dashed border-zinc-800 bg-zinc-950/25">
		<div class="max-w-md text-center">
			<h2 class="font-serif text-2xl font-semibold text-white">{title}</h2>
			<p class="mt-3 text-sm leading-6 text-zinc-400">{description}</p>
		</div>
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

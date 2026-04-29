<script lang="ts">
	import { Button, Input, Badge, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Popover, PopoverTrigger, PopoverContent } from "$lib/components/ui";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import { useConvexClient, useQuery } from "convex-svelte";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import Navbar from "$lib/components/Navbar.svelte";
	import { Lightbox } from "$lib/components/lightbox";

	const client = useConvexClient();

	// View mode state - initialized from URL (using 'tab' to avoid conflict with lightbox 'view' param)
	type ViewMode = 'posts' | 'conversations';
	let viewMode = $state<ViewMode>(
		($page.url.searchParams.get('tab') as ViewMode) || 'posts'
	);

	// Update URL when viewMode changes
	function setViewMode(mode: ViewMode) {
		viewMode = mode;
		const url = new URL($page.url);
		if (mode === 'posts') {
			url.searchParams.delete('tab');
		} else {
			url.searchParams.set('tab', mode);
		}
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	// Search state
	let searchQuery = $state("");
	let searchInputEl: HTMLInputElement;

	// Project filter state
	let filterProjectId = $state<Id<"projects"> | null>(null);
	let projectFilterOpen = $state(false);

	// Infinite scroll state
	type Post = {
		_id: Id<"generated_posts">;
		galleryImageId?: Id<"generated_images">;
		_creationTime: number;
		caption: string;
		imageUrl: string | null;
		imageModel?: string;
		createdAt: number;
		projectId?: Id<"projects">;
		userId?: Id<"users">;
		status: string;
		deletedAt?: number;
		imageStorageId?: Id<"_storage">;
		imagePrompt?: string;
		model?: string;
		sourcePostIds?: Id<"social_posts">[];
		reasoning?: string;
		updatedAt: number;
		// Scheduling fields
		scheduledFor?: number;
		schedulingStatus?: string;
	};
	let allPosts = $state<Post[]>([]);
	let cursor = $state<string | null>(null);
	let hasMore = $state(true);
	let loadingMore = $state(false);
	let initialLoadDone = $state(false);
	let sentinelEl = $state<HTMLDivElement | null>(null);

	// Lightbox state from URL params
	let lightboxPostId = $derived($page.url.searchParams.get('view'));
	let lightboxImageId = $derived($page.url.searchParams.get('img'));
	let lightboxOpen = $derived(!!lightboxPostId);

	// Open lightbox
	function openLightbox(postId: string, imageId?: string | null) {
		const url = new URL($page.url);
		url.searchParams.set('view', postId);
		if (imageId) {
			url.searchParams.set('img', imageId);
		} else {
			url.searchParams.delete('img');
		}
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	// Close lightbox
	function closeLightbox() {
		const url = new URL($page.url);
		url.searchParams.delete('view');
		url.searchParams.delete('img');
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	// Navigate within lightbox
	function navigateLightbox(postId: string, imageId?: string | null) {
		const url = new URL($page.url);
		url.searchParams.set('view', postId);
		if (imageId) {
			url.searchParams.set('img', imageId);
		} else {
			url.searchParams.delete('img');
		}
		goto(url.toString(), { replaceState: true, noScroll: true });
	}


	// Queries
	const projectsQuery = useQuery(api.projects.list, () => ({}));
	// Initial query - only used for the first load when no filters are active
	const initialPostsQuery = useQuery(
		api.generatedPosts.listGalleryByUser,
		() => (filterProjectId || searchQuery.trim()) ? "skip" : { limit: 30 }
	);
	const projectPostsQuery = useQuery(
		api.generatedPosts.listGalleryByProject,
		() => filterProjectId ? { projectId: filterProjectId } : "skip"
	);
	const searchResultsQuery = useQuery(
		api.generatedPosts.searchGallery,
		() => searchQuery.trim() ? { query: searchQuery.trim(), limit: 20 } : "skip"
	);

	// Conversations query - only active when viewing conversations
	const conversationsQuery = useQuery(
		api.imageEditConversations.listByUser,
		() => viewMode === 'conversations' ? {} : "skip"
	);

	// Load more posts (infinite scroll)
	async function loadMore() {
		if (loadingMore || !hasMore || filterProjectId || searchQuery.trim()) return;

		loadingMore = true;
		try {
			const args: { limit: number; cursor?: string } = { limit: 30 };
			if (cursor) {
				args.cursor = cursor;
			}
			const result = await client.query(api.generatedPosts.listGalleryByUser, args);
			allPosts = [...allPosts, ...(result.posts as Post[])];
			cursor = result.nextCursor;
			hasMore = result.hasMore;
		} catch (err) {
			console.error("Failed to load more posts:", err);
		} finally {
			loadingMore = false;
		}
	}

	// Reset infinite scroll state when filters change
	$effect(() => {
		// When filter or search changes, reset accumulated posts
		if (filterProjectId || searchQuery.trim()) {
			allPosts = [];
			cursor = null;
			hasMore = true;
			initialLoadDone = false;
		}
	});

	// Initialize posts from initial query
	$effect(() => {
		if (initialPostsQuery.data && !filterProjectId && !searchQuery.trim() && !initialLoadDone) {
			allPosts = initialPostsQuery.data.posts as Post[];
			cursor = initialPostsQuery.data.nextCursor;
			hasMore = initialPostsQuery.data.hasMore;
			initialLoadDone = true;
		}
	});

	// Reset accumulated posts when project-filtered query becomes inactive
	$effect(() => {
		if (!filterProjectId && !searchQuery.trim()) return;
		initialLoadDone = true;
	});

	// Intersection Observer for infinite scroll
	$effect(() => {
		if (!sentinelEl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry?.isIntersecting && hasMore && !loadingMore && !filterProjectId && !searchQuery.trim()) {
					loadMore();
				}
			},
			{ rootMargin: "200px" }
		);

		observer.observe(sentinelEl);
		return () => observer.disconnect();
	});

	// Derived data
	let projects = $derived(projectsQuery.data ?? []);
	let selectedProject = $derived(projects.find(p => p._id === filterProjectId) ?? null);
	let posts = $derived(() => {
		if (searchQuery.trim()) {
			return (searchResultsQuery.data ?? []) as Post[];
		}
		if (filterProjectId) {
			return (projectPostsQuery.data ?? []) as Post[];
		}
		// Use accumulated posts for infinite scroll
		return allPosts;
	});
	let isLoading = $derived(
		(initialPostsQuery.isLoading && !initialLoadDone) ||
		(!!filterProjectId && projectPostsQuery.isLoading) ||
		(!!searchQuery.trim() && searchResultsQuery.isLoading)
	);

	// Get profile picture URL for a project
	function getProjectProfilePicture(project: typeof projects[0] | null): string | null {
		if (!project) return null;
		return project.logoStorageUrl ?? project.profilePictureStorageUrl ?? project.profilePictureUrl ?? null;
	}

	// Get handle from a project
	function getProjectHandle(project: typeof projects[0]): string | null {
		if (project.instagramHandle) return project.instagramHandle;
		if (!project.instagramUrl) return null;
		try {
			const url = new URL(project.instagramUrl);
			const parts = url.pathname.split('/').filter(Boolean);
			return parts[0] ?? null;
		} catch {
			return null;
		}
	}

	// Select project filter
	function selectProjectFilter(projectId: Id<"projects"> | null) {
		filterProjectId = projectId;
		projectFilterOpen = false;
	}

	// Model display names
	const modelDisplayNames: Record<string, string> = {
		"google/gemini-2.5-flash-image": "Nano Banana",
		"google/gemini-3.1-flash-image-preview": "Nano Banana 2",
		"google/gemini-3-pro-image-preview": "Nano Banana Pro",
		"bytedance-seed/seedream-4.5": "SeeDream v4.5",
		"black-forest-labs/flux.2-flex": "Flux 2 Flex",
		"openai/gpt-5-image": "GPT Image 1.5",
	};

	// Format date
	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleDateString('pt-BR', { 
			day: '2-digit', 
			month: 'short',
			year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
		});
	}

	// Format scheduled date/time
	function formatScheduledDate(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleString('pt-BR', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Get scheduling status badge style
	function getSchedulingBadgeClass(status: string | undefined): string {
		switch (status) {
			case 'posted': return 'bg-green-500/80 text-white';
			case 'missed': return 'bg-red-500/80 text-white';
			default: return 'bg-blue-500/80 text-white';
		}
	}

	// Get scheduling status label
	function getSchedulingLabel(status: string | undefined): string {
		switch (status) {
			case 'posted': return 'Postado';
			case 'missed': return 'Perdido';
			default: return 'Agendado';
		}
	}

	// Truncate caption
	function truncateCaption(caption: string, maxLength: number = 100): string {
		if (caption.length <= maxLength) return caption;
		return caption.substring(0, maxLength).trim() + '...';
	}

	// Handle delete
	async function handleDelete(postId: Id<"generated_posts">, event: Event) {
		event.stopPropagation();
		await client.mutation(api.generatedPosts.softDelete, { id: postId });
	}

	// Handle download
	async function handleDownload(imageUrl: string, event: Event) {
		event.stopPropagation();
		try {
			const response = await fetch(imageUrl);
			const blob = await response.blob();
			
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `vanda-${Date.now()}.png`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} catch (err) {
			console.error('Download failed:', err);
		}
	}

	// Handle search
	function handleSearch(event: Event) {
		const input = event.target as HTMLInputElement;
		searchQuery = input.value;
	}

	// Clear search
	function clearSearch() {
		searchQuery = "";
	}
</script>

<svelte:head>
	<title>Galeria - Vanda Studio</title>
</svelte:head>

<div class="flex h-screen flex-col bg-background">
	<Navbar />

	<!-- Sub-header with search and actions -->
	<div class="shrink-0 border-b border-border bg-muted/30 px-4 py-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<!-- Search -->
				<div class="relative">
					<input
						bind:this={searchInputEl}
						type="text"
						placeholder="Buscar..."
						class="flex h-9 w-72 rounded-md border border-input bg-transparent px-3 py-1 pl-9 pr-16 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
						value={searchQuery}
						oninput={handleSearch}
					/>
					<svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
					</svg>
					{#if searchQuery}
					<div class="absolute right-3 top-1/2 -translate-y-1/2">
						<button
							type="button"
							aria-label="Limpar busca"
							class="text-muted-foreground hover:text-foreground"
							onclick={clearSearch}
						>
							<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				{/if}
				</div>

				<!-- View Mode Toggle -->
				<div class="flex h-9 overflow-hidden rounded-md border border-border">
					<button
						type="button"
						class="px-3 text-sm transition-colors {viewMode === 'posts' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}"
						onclick={() => setViewMode('posts')}
					>
						Posts
					</button>
					<button
						type="button"
						class="px-3 text-sm transition-colors {viewMode === 'conversations' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}"
						onclick={() => setViewMode('conversations')}
					>
						Conversas
					</button>
				</div>

				<!-- Project Filter (only show when viewing posts) -->
				{#if projects.length > 0 && viewMode === 'posts'}
					<Popover bind:open={projectFilterOpen}>
						<PopoverTrigger>
							<button
								type="button"
								class="flex h-9 items-center gap-2 border border-border bg-background px-3 text-sm transition-colors hover:bg-muted {projectFilterOpen ? 'ring-1 ring-ring' : ''}"
							>
								{#if selectedProject}
									<div class="h-5 w-5 overflow-hidden rounded-full border border-border bg-muted">
										{#if getProjectProfilePicture(selectedProject)}
											<img
												src={getProjectProfilePicture(selectedProject)}
												alt={selectedProject.name}
												class="h-full w-full object-cover"
											/>
										{:else}
											<div class="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground">
												{selectedProject.name.charAt(0).toUpperCase()}
											</div>
										{/if}
									</div>
									<span>{selectedProject.name}</span>
								{:else}
									<svg class="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
									</svg>
									<span class="text-muted-foreground">Filtrar projeto</span>
								{/if}
								<svg class="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
								</svg>
							</button>
						</PopoverTrigger>
						<PopoverContent class="w-56 p-1" align="start">
							<!-- All projects option -->
							<button
								type="button"
								class="flex w-full items-center gap-2 px-2 py-2 text-sm transition-colors hover:bg-muted {filterProjectId === null ? 'bg-muted' : ''}"
								onclick={() => selectProjectFilter(null)}
							>
								<div class="h-5 w-5 overflow-hidden rounded-full border border-dashed border-border bg-background">
									<div class="flex h-full w-full items-center justify-center">
										<svg class="h-3 w-3 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
										</svg>
									</div>
								</div>
								<span>Todos os projetos</span>
								{#if filterProjectId === null}
									<svg class="ml-auto h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
									</svg>
								{/if}
							</button>

							<div class="my-1 border-t border-border"></div>

							<!-- Project options -->
							{#each projects as project (project._id)}
								<button
									type="button"
									class="flex w-full items-center gap-2 px-2 py-2 text-sm transition-colors hover:bg-muted {filterProjectId === project._id ? 'bg-muted' : ''}"
									onclick={() => selectProjectFilter(project._id)}
								>
									<div class="h-5 w-5 overflow-hidden rounded-full border border-border bg-muted">
										{#if getProjectProfilePicture(project)}
											<img
												src={getProjectProfilePicture(project)}
												alt={project.name}
												class="h-full w-full object-cover"
											/>
										{:else}
											<div class="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground">
												{project.name.charAt(0).toUpperCase()}
											</div>
										{/if}
									</div>
									<div class="flex flex-col items-start">
										<span class="font-medium">{project.name}</span>
										{#if getProjectHandle(project)}
											<span class="text-xs text-muted-foreground">@{getProjectHandle(project)}</span>
										{/if}
									</div>
									{#if filterProjectId === project._id}
										<svg class="ml-auto h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
										</svg>
									{/if}
								</button>
							{/each}
						</PopoverContent>
					</Popover>
				{/if}

				<span class="text-sm text-muted-foreground">
					{#if viewMode === 'conversations'}
						{conversationsQuery.data?.length ?? 0} conversa{(conversationsQuery.data?.length ?? 0) !== 1 ? 's' : ''}
					{:else if searchQuery.trim()}
						{posts().length} resultado{posts().length !== 1 ? 's' : ''} para "{searchQuery}"
					{:else if filterProjectId && selectedProject}
						{posts().length} post{posts().length !== 1 ? 's' : ''} em {selectedProject.name}
					{:else}
						{posts().length} geraç{posts().length !== 1 ? 'ões' : 'ão'}
					{/if}
				</span>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="ghost" size="sm" onclick={() => goto('/gallery/trash')}>
					<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
					</svg>
					Lixeira
				</Button>
			</div>
		</div>
	</div>

	<!-- Main content -->
	<main class="flex-1 overflow-y-auto p-6">
		<SignedOut>
			<div class="flex flex-1 flex-col items-center justify-center gap-6 py-20">
				<div class="text-center">
					<h2 class="text-2xl font-bold">Entre para ver sua galeria</h2>
					<p class="mt-2 text-muted-foreground">
						Faça login para acessar suas gerações
					</p>
				</div>
				<SignInButton mode="modal">
					<button class="h-9 rounded-none bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
						Entrar
					</button>
				</SignInButton>
			</div>
		</SignedOut>

		<SignedIn>
			{#if viewMode === 'conversations'}
				<!-- Conversations View -->
				{#if conversationsQuery.isLoading}
					<div class="flex items-center justify-center py-20">
						<div class="flex flex-col items-center gap-4">
							<svg class="h-8 w-8 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							<p class="text-sm text-muted-foreground">Carregando conversas...</p>
						</div>
					</div>
				{:else if !conversationsQuery.data || conversationsQuery.data.length === 0}
					<div class="flex flex-col items-center justify-center py-20">
						<div class="flex h-20 w-20 items-center justify-center rounded-none border-2 border-dashed border-border bg-muted/50">
							<svg class="h-10 w-10 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
							</svg>
						</div>
						<h3 class="mt-6 text-lg font-medium">Nenhuma conversa ainda</h3>
						<p class="mt-2 text-sm text-muted-foreground">
							Refine uma imagem para criar sua primeira conversa
						</p>
						<Button class="mt-6" variant="outline" onclick={() => viewMode = 'posts'}>
							Ver Posts
						</Button>
					</div>
				{:else}
					<!-- Conversations grid -->
					<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each conversationsQuery.data as conversation (conversation._id)}
							<div
								class="group relative flex flex-col overflow-hidden border border-border bg-card transition-shadow hover:shadow-lg cursor-pointer"
								onclick={() => goto(`/library/conversations/${conversation._id}`)}
								onkeydown={(e) => e.key === 'Enter' && goto(`/library/conversations/${conversation._id}`)}
								role="button"
								tabindex="0"
							>
								<!-- Image -->
								<div class="relative aspect-square overflow-hidden bg-muted">
									{#if conversation.latestOutputUrl || conversation.sourceImageUrl}
										<img
											src={conversation.latestOutputUrl ?? conversation.sourceImageUrl}
											alt={conversation.title}
											class="h-full w-full object-cover transition-transform group-hover:scale-105"
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center">
											<svg class="h-12 w-12 text-muted-foreground/50" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
											</svg>
										</div>
									{/if}

									<!-- Turn count badge -->
									<div class="absolute bottom-2 left-2">
										<Badge variant="secondary" class="bg-black/60 text-white text-[10px] backdrop-blur-sm">
											{conversation.turnCount} {conversation.turnCount === 1 ? 'turno' : 'turnos'}
										</Badge>
									</div>
								</div>

								<!-- Title and date -->
								<div class="flex flex-1 flex-col p-4">
									<p class="line-clamp-3 text-sm leading-relaxed">
										{truncateCaption(conversation.title, 120)}
									</p>
									<div class="mt-auto pt-3">
										<span class="text-xs text-muted-foreground">
											{formatDate(conversation.createdAt)}
										</span>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else if isLoading}
				<div class="flex items-center justify-center py-20">
					<div class="flex flex-col items-center gap-4">
						<svg class="h-8 w-8 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<p class="text-sm text-muted-foreground">Carregando galeria...</p>
					</div>
				</div>
			{:else if posts().length === 0}
				<div class="flex flex-col items-center justify-center py-20">
					<div class="flex h-20 w-20 items-center justify-center rounded-none border-2 border-dashed border-border bg-muted/50">
						<svg class="h-10 w-10 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
						</svg>
					</div>
					<h3 class="mt-6 text-lg font-medium">
						{#if searchQuery.trim()}
							Nenhum resultado encontrado
						{:else if filterProjectId}
							Nenhum post neste projeto
						{:else}
							Nenhuma geração ainda
						{/if}
					</h3>
					<p class="mt-2 text-sm text-muted-foreground">
						{#if searchQuery.trim()}
							Tente buscar por outros termos
						{:else if filterProjectId}
							Crie um post para este projeto ou limpe o filtro
						{:else}
							Crie seu primeiro post para começar
						{/if}
					</p>
					{#if !searchQuery.trim() && !filterProjectId}
						<Button class="mt-6" onclick={() => goto('/library')}>
							Criar Primeiro Post
						</Button>
					{:else if filterProjectId}
						<div class="mt-6 flex gap-2">
							<Button onclick={() => goto(`/library?projectId=${filterProjectId}`)}>
								Criar Post
							</Button>
							<Button variant="outline" onclick={() => filterProjectId = null}>
								Limpar filtro
							</Button>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Gallery grid -->
				<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each posts() as post (post.galleryImageId ?? post._id)}
						<div 
							class="group relative flex flex-col overflow-hidden border border-border bg-card transition-shadow hover:shadow-lg cursor-pointer"
							onclick={() => openLightbox(post._id, post.galleryImageId ?? null)}
							onkeydown={(e) => e.key === 'Enter' && openLightbox(post._id, post.galleryImageId ?? null)}
							role="button"
							tabindex="0"
						>
							<!-- Image -->
							<div class="relative aspect-square overflow-hidden bg-muted">
								{#if post.imageUrl}
									<img 
										src={post.imageUrl} 
										alt="Post gerado" 
										class="h-full w-full object-cover transition-transform group-hover:scale-105"
									/>
								{:else}
									<div class="flex h-full w-full items-center justify-center">
										<svg class="h-12 w-12 text-muted-foreground/50" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
										</svg>
									</div>
								{/if}

								<!-- Hover overlay with actions -->
								<div class="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
									{#if post.imageUrl}
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger>
													<button
														type="button"
														aria-label="Baixar"
														class="flex h-10 w-10 items-center justify-center bg-white/20 text-white backdrop-blur-sm hover:bg-white/30"
														onclick={(e) => handleDownload(post.imageUrl!, e)}
													>
														<svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
														</svg>
													</button>
												</TooltipTrigger>
												<TooltipContent>
													<p>Baixar</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									{/if}
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<button
													type="button"
													aria-label="Excluir"
													class="flex h-10 w-10 items-center justify-center bg-white/20 text-white backdrop-blur-sm hover:bg-red-500/50"
													onclick={(e) => handleDelete(post._id, e)}
												>
													<svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
														<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
													</svg>
												</button>
											</TooltipTrigger>
											<TooltipContent>
												<p>Mover para lixeira</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>

								<!-- Model badge -->
								{#if post.imageModel}
									<div class="absolute bottom-2 left-2">
										<Badge variant="secondary" class="bg-black/60 text-white text-[10px] backdrop-blur-sm">
											{modelDisplayNames[post.imageModel] ?? post.imageModel.split("/").pop()}
										</Badge>
									</div>
								{/if}

								<!-- Scheduled badge -->
								{#if (post as Post).scheduledFor}
									<div class="absolute top-2 right-2">
										<Badge variant="secondary" class="{getSchedulingBadgeClass((post as Post).schedulingStatus)} text-[10px] backdrop-blur-sm">
											{getSchedulingLabel((post as Post).schedulingStatus)}: {formatScheduledDate((post as Post).scheduledFor!)}
										</Badge>
									</div>
								{/if}
							</div>

							<!-- Caption preview -->
							<div class="flex flex-1 flex-col p-4">
								<p class="line-clamp-3 text-sm leading-relaxed">
									{truncateCaption(post.caption, 120)}
								</p>
								<div class="mt-auto pt-3">
									<span class="text-xs text-muted-foreground">
										{formatDate(post.createdAt)}
									</span>
								</div>
							</div>
						</div>
					{/each}
				</div>

				<!-- Infinite scroll sentinel and loading indicator -->
				{#if !filterProjectId && !searchQuery.trim()}
					<div bind:this={sentinelEl} class="h-1" aria-hidden="true"></div>
					{#if loadingMore}
						<div class="flex items-center justify-center py-8">
							<svg class="h-6 w-6 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							<span class="ml-2 text-sm text-muted-foreground">Carregando mais...</span>
						</div>
					{:else if !hasMore && allPosts.length > 0}
						<div class="flex items-center justify-center py-8">
							<span class="text-sm text-muted-foreground">Todas as gerações foram carregadas</span>
						</div>
					{/if}
				{/if}
			{/if}
		</SignedIn>
	</main>
</div>

<!-- Lightbox -->
{#if lightboxOpen && lightboxPostId && posts().length > 0}
	<Lightbox
		posts={posts()}
		currentPostId={lightboxPostId}
		currentImageId={lightboxImageId}
		onclose={closeLightbox}
		onnavigate={navigateLightbox}
	/>
{/if}

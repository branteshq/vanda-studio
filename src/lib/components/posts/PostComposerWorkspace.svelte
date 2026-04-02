<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { onMount } from "svelte";
	import { ScheduleModal } from "$lib/components/calendar";
	import { CarouselStrip, InstagramPreview } from "$lib/components/posts";
	import PostAiComposeSection from "./PostAiComposeSection.svelte";
	import {
		CaptionModelSelector,
		ProjectSelector,
		ImageGenerationPulseLoader,
	} from "$lib/components/studio";
	import {
		clearPostComposerState,
		isAiComposeStale,
		loadPostComposerState,
		mergePostComposerStateFromLive,
		mergePostComposerStateFromStorage,
		savePostComposerState,
		type PostComposerState,
	} from "$lib/studio/postComposerState";
	import {
		DEFAULT_STUDIO_IMAGE_MODEL,
		type Resolution,
	} from "$lib/studio/imageGenerationCapabilities";
	import {
		estimateCaptionUsage,
		sumUsageLineItemCredits,
	} from "$lib/billing/aiCredits";
	import { Badge, Button, Textarea } from "$lib/components/ui";
	import { formatUserFacingMessage } from "$lib/errors";
	import { api } from "../../../convex/_generated/api.js";
	import type { Id } from "../../../convex/_generated/dataModel.js";
	import { useConvexClient, useQuery } from "convex-svelte";
	import MediaLibrarySheet from "./MediaLibrarySheet.svelte";

	const MAX_CAROUSEL = 10;
	const DEFAULT_AI_IMAGE_MODEL = DEFAULT_STUDIO_IMAGE_MODEL;

	type MediaItem = {
		_id: Id<"media_items">;
		url: string | null;
		thumbnailUrl?: string | null;
		model?: string;
		prompt?: string;
		sourceType: string;
		width: number;
		height: number;
		mimeType: string;
		projectId?: Id<"projects">;
		createdAt: number;
	};

	type ComposerPost = {
		_id: Id<"generated_posts">;
		caption: string;
		title?: string;
		projectId?: Id<"projects">;
		scheduledFor?: number;
		schedulingStatus?: string;
		platform?: string;
	};

	type BillingOverview = {
		activePlanId: string | null;
		accessStatus: string;
		trialEligible: boolean;
		renewalAt: number | null;
		usage: {
			monthlyIncluded: number;
			monthlyUsed: number;
			monthlyRemaining: number;
			totalRemaining: number;
			nextResetAt?: number;
		};
	};

	interface Props {
		postId?: Id<"generated_posts"> | null;
		onclose?: () => void;
		ondelete?: () => void;
		closeLabel?: string;
		showToolbar?: boolean;
		showPlatformSelector?: boolean;
		showCloseAction?: boolean;
	}

	let {
		postId = null,
		onclose,
		ondelete,
		closeLabel = "Ver todos os posts",
		showToolbar = true,
		showPlatformSelector = true,
		showCloseAction = true,
	}: Props = $props();

	const sectionLabelClass =
		"flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground";

	function parseMediaIds(value: string | null): Id<"media_items">[] {
		if (!value) return [];
		return value
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean) as Id<"media_items">[];
	}

	function dedupeMediaIds(ids: Id<"media_items">[]): Id<"media_items">[] {
		return [...new Set(ids)];
	}

	function formatScheduledDate(timestamp: number): string {
		return new Date(timestamp).toLocaleString("pt-BR", {
			day: "2-digit",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function resetComposerState() {
		activePostId = null;
		selectedProjectId = null;
		selectedMediaIds = [];
		captionBrief = "";
		caption = "";
		title = "";
		captionModel = "moonshotai/kimi-k2-0905";
		platform = "instagram";
		includeProjectContext = true;
		error = null;
		previewIndex = 0;
		hydratedPostId = null;
		hydratedPostMediaId = null;
		consumedMediaIdsSignature = "";
		aiComposePending = false;
		aiComposeStartedAt = undefined;
		aiTemplateId = null;
		aiImageModel = DEFAULT_AI_IMAGE_MODEL;
		aiResolution = "standard";
	}

	function buildPersistedComposerState(): PostComposerState {
		return {
			selectedProjectId,
			selectedMediaIds: selectedMediaIds.map(String),
			captionBrief,
			caption,
			title,
			captionModel,
			platform,
			includeProjectContext,
			previewIndex,
			aiComposePending,
			aiTemplateId,
			aiImageModel,
			aiResolution,
			...(typeof aiComposeStartedAt === "number" ? { aiComposeStartedAt } : {}),
		} as PostComposerState;
	}

	function markComposerPersistenceReady() {
		composerPersistenceReadyKey = composerStateKey;
	}

	function handleClose() {
		if (onclose) {
			onclose();
			return;
		}

		void goto("/posts");
	}

	const client = useConvexClient();

	const postIdFromUrl = $derived(
		$page.url.searchParams.get("postId") as Id<"generated_posts"> | null
	);
	const projectIdFromUrl = $derived(
		$page.url.searchParams.get("projectId") as Id<"projects"> | null
	);
	const mediaIdsFromUrl = $derived(parseMediaIds($page.url.searchParams.get("mediaIds")));

	let activePostId = $state<Id<"generated_posts"> | null>(null);
	let selectedProjectId = $state<Id<"projects"> | null>(null);
	let selectedMediaIds = $state<Id<"media_items">[]>([]);
	let captionBrief = $state("");
	let caption = $state("");
	let title = $state("");
	let captionModel = $state("moonshotai/kimi-k2-0905");
	let platform = $state("instagram");
	let includeProjectContext = $state(true);
	let isGeneratingCaption = $state(false);
	let isSavingDraft = $state(false);
	let error = $state<string | null>(null);
	let scheduleModalOpen = $state(false);
	let hydratedPostId = $state<string | null>(null);
	let hydratedPostMediaId = $state<string | null>(null);
	let consumedMediaIdsSignature = $state("");
	let previewIndex = $state(0);
	let mediaLibraryOpen = $state(false);
	let restoredComposerStateKey = $state<string | null>(null);
	let restoredComposerStateFromStorage = $state(false);
	let composerPersistenceReadyKey = $state<string | null>(null);
	let billingOverview = $state<BillingOverview | null>(null);
	let billingOverviewLoaded = $state(false);
	let aiComposePending = $state(false);
	let aiComposeStartedAt = $state<number | undefined>(undefined);
	let aiTemplateId = $state<string | null>(null);
	let aiImageModel = $state(DEFAULT_AI_IMAGE_MODEL);
	let aiResolution = $state<Resolution>("standard");
	let captionCreditEstimate = $derived(
		sumUsageLineItemCredits(estimateCaptionUsage(captionModel))
	);
	let captionPlanUsageEstimatePercent = $derived(
		billingOverview?.usage?.monthlyIncluded
			? (captionCreditEstimate / Math.max(billingOverview.usage.monthlyIncluded, 1)) * 100
			: null
	);

	const composerPostId = $derived(postId ?? activePostId ?? postIdFromUrl);
	const composerStateKey = $derived(composerPostId ? `post:${composerPostId}` : "new");

	const postQuery = useQuery(
		api.generatedPosts.get,
		() => (composerPostId ? { id: composerPostId } : "skip")
	);
	const postMediaQuery = useQuery(
		api.postMediaItems.listByPost,
		() => (composerPostId ? { postId: composerPostId } : "skip")
	);
	const selectedMediaQuery = useQuery(
		api.mediaItems.listByIds,
		() => (selectedMediaIds.length > 0 ? { ids: selectedMediaIds } : "skip")
	);
	const selectedProjectQuery = useQuery(
		api.projects.get,
		() => (selectedProjectId ? { projectId: selectedProjectId } : "skip")
	);
	const contextImagesQuery = useQuery(
		api.contextImages.list,
		() => (selectedProjectId ? { projectId: selectedProjectId } : "skip")
	);

	let currentPost = $derived(postQuery.data as ComposerPost | null | undefined);
	let selectedProject = $derived(selectedProjectQuery.data);
	let contextImages = $derived(contextImagesQuery.data ?? []);
	let selectedMedia = $derived((selectedMediaQuery.data ?? []) as MediaItem[]);
	let linkedPostMedia = $derived(postMediaQuery.data ?? []);
	let hasResolvedLinkedPostMedia = $derived(postMediaQuery.data !== undefined);
	let isEditingExistingPost = $derived(!!composerPostId);
	let coverMedia = $derived(selectedMedia[0] ?? null);

	onMount(() => {
		void loadBillingOverview();
	});

	$effect(() => {
		if (previewIndex >= selectedMedia.length && selectedMedia.length > 0) {
			previewIndex = selectedMedia.length - 1;
		}
	});

	function formatPercent(value: number): string {
		const normalized = Math.max(0, Math.min(100, value));
		const formatter = new Intl.NumberFormat("pt-BR", {
			minimumFractionDigits: normalized > 0 && normalized < 1 ? 1 : 0,
			maximumFractionDigits: normalized >= 10 || Number.isInteger(normalized) ? 0 : 1,
		});
		return `${formatter.format(normalized)}%`;
	}

	async function loadBillingOverview() {
		try {
			const data = await client.action((api as any).billing.autumn.getBillingOverview, {});
			billingOverview = data ?? null;
		} catch (error) {
			console.error("Failed to load billing overview for post composer:", error);
			billingOverview = null;
		} finally {
			billingOverviewLoaded = true;
		}
	}

	$effect(() => {
		const savedState = loadPostComposerState(composerStateKey);
		if (savedState) {
			selectedProjectId = savedState.selectedProjectId as Id<"projects"> | null;
			selectedMediaIds = savedState.selectedMediaIds as Id<"media_items">[];
			captionBrief = savedState.captionBrief;
			caption = savedState.caption;
			title = savedState.title;
			captionModel = savedState.captionModel;
			platform = savedState.platform;
			includeProjectContext = savedState.includeProjectContext;
			previewIndex = savedState.previewIndex;
			aiTemplateId =
				savedState.aiTemplateId === undefined ? null : savedState.aiTemplateId;
			aiImageModel = savedState.aiImageModel ?? DEFAULT_AI_IMAGE_MODEL;
			aiResolution = (savedState.aiResolution as Resolution) ?? "standard";
			aiComposePending = savedState.aiComposePending === true;
			aiComposeStartedAt = savedState.aiComposeStartedAt;
			if (aiComposePending && isAiComposeStale(savedState)) {
				aiComposePending = false;
				aiComposeStartedAt = undefined;
				queueMicrotask(() => {
					mergePostComposerStateFromLive(
						composerStateKey,
						{ aiComposePending: false, aiComposeStartedAt: undefined },
						buildPersistedComposerState()
					);
				});
			}
			error = null;
			activePostId = composerPostId;
			hydratedPostId = composerPostId;
			hydratedPostMediaId = composerPostId;
			composerPersistenceReadyKey = composerStateKey;
		} else if (!composerPostId) {
			resetComposerState();
			composerPersistenceReadyKey = composerStateKey;
		} else {
			composerPersistenceReadyKey = null;
		}

		restoredComposerStateKey = composerStateKey;
		restoredComposerStateFromStorage = !!savedState;
	});

	$effect(() => {
		if (!composerPostId || restoredComposerStateFromStorage) return;
		if (hydratedPostId === composerPostId && hydratedPostMediaId === composerPostId) {
			composerPersistenceReadyKey = composerStateKey;
		}
	});

	$effect(() => {
		if (restoredComposerStateKey !== composerStateKey) return;
		if (composerPersistenceReadyKey !== composerStateKey) return;

		savePostComposerState(composerStateKey, buildPersistedComposerState());
	});

	$effect(() => {
		if (projectIdFromUrl && !selectedProjectId && !composerPostId) {
			selectedProjectId = projectIdFromUrl;
		}
	});

	$effect(() => {
		if (
			currentPost &&
			composerPostId &&
			hydratedPostId !== composerPostId &&
			!restoredComposerStateFromStorage
		) {
			activePostId = composerPostId;
			selectedProjectId = currentPost.projectId ?? null;
			caption = currentPost.caption;
			title = currentPost.title ?? "";
			if (currentPost.platform) platform = currentPost.platform;
			hydratedPostId = composerPostId;
		}
	});

	$effect(() => {
		if (
			composerPostId &&
			hydratedPostMediaId !== composerPostId &&
			hasResolvedLinkedPostMedia &&
			!restoredComposerStateFromStorage
		) {
			selectedMediaIds = linkedPostMedia
				.filter((row): row is NonNullable<typeof row> => !!row)
				.map((row) => row.mediaItemId);
			hydratedPostMediaId = composerPostId;
		}
	});

	$effect(() => {
		const signature = mediaIdsFromUrl.join(",");
		if (!signature || consumedMediaIdsSignature === signature) return;
		selectedMediaIds = dedupeMediaIds([...selectedMediaIds, ...mediaIdsFromUrl]).slice(0, MAX_CAROUSEL);
		consumedMediaIdsSignature = signature;
	});

	function buildProjectContext() {
		if (!includeProjectContext || !selectedProjectId || !selectedProject) return undefined;
		const contextImageUrls = contextImages
			.map((image) => image.url)
			.filter((url): url is string => !!url);
		return {
			...(selectedProject.brandContextMarkdown?.trim() && {
				brandContextMarkdown: selectedProject.brandContextMarkdown.trim(),
			}),
			...(selectedProject.accountDescription && { accountDescription: selectedProject.accountDescription }),
			...(selectedProject.brandTraits && { brandTraits: selectedProject.brandTraits }),
			...(selectedProject.additionalContext && { additionalContext: selectedProject.additionalContext }),
			...(contextImageUrls.length > 0 && { contextImageUrls }),
		};
	}

	const sourceLabels: Record<string, string> = {
		generated: "Gerada",
		uploaded: "Upload",
		edited: "Editada",
		imported: "Importada",
	};

	const modelDisplayNames: Record<string, string> = {
		"google/gemini-2.5-flash-image": "Nano Banana",
		"google/gemini-3.1-flash-image-preview": "Nano Banana 2",
		"google/gemini-3-pro-image-preview": "Nano Banana Pro",
		"bytedance-seed/seedream-4.5": "SeeDream v4.5",
		"black-forest-labs/flux.2-flex": "Flux 2 Flex",
		"openai/gpt-5-image": "GPT Image 1.5",
	};

	function buildReferenceText(): string | undefined {
		if (selectedMedia.length === 0) return undefined;
		const chunks = selectedMedia.map((item, index) => {
			const lines = [
				`Imagem ${index + 1}`,
				`Origem: ${sourceLabels[item.sourceType] ?? item.sourceType}`,
				item.model ? `Modelo: ${modelDisplayNames[item.model] ?? item.model}` : null,
				item.prompt ? `Prompt: ${item.prompt}` : null,
				`Tamanho: ${item.width}x${item.height}`,
			].filter(Boolean);
			return lines.join("\n");
		});
		return chunks.join("\n\n");
	}

	async function handleGenerateCaption() {
		if (!captionBrief.trim()) {
			error = "Descreva o briefing para gerar a legenda.";
			return;
		}
		isGeneratingCaption = true;
		error = null;
		try {
			const projectContext = buildProjectContext();
			const referenceText = buildReferenceText();
			const result = await client.action(api.ai.generateCaption.generate, {
				message: captionBrief.trim(),
				captionModel,
				...(projectContext && { projectContext }),
				...(referenceText && { referenceText }),
			});
			caption = result.caption;
			markComposerPersistenceReady();
		} catch (err) {
			error = formatUserFacingMessage(err);
		} finally {
			isGeneratingCaption = false;
		}
	}

	function updateComposerUrl(postId: Id<"generated_posts">) {
		const url = new URL($page.url);
		url.searchParams.set("postId", postId);
		url.searchParams.delete("mediaIds");
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	async function saveDraft() {
		if (selectedMediaIds.length === 0) {
			error = "Selecione pelo menos uma imagem para criar o post.";
			return null;
		}
		const previousComposerStateKey = composerStateKey;
		const isNewDraft = !composerPostId;
		isSavingDraft = true;
		error = null;
		try {
			const savedPostId = await client.mutation(api.generatedPosts.saveComposedDraft, {
				...(composerPostId && { id: composerPostId }),
				...(selectedProjectId && { projectId: selectedProjectId }),
				...(title ? { title } : {}),
				caption,
				mediaItemIds: selectedMediaIds,
				platform,
			});
			if (isNewDraft) {
				clearPostComposerState(previousComposerStateKey);
			}
			savePostComposerState(`post:${savedPostId}`, buildPersistedComposerState());
			activePostId = savedPostId;
			updateComposerUrl(savedPostId);
			return savedPostId;
		} catch (err) {
			error = formatUserFacingMessage(err);
			return null;
		} finally {
			isSavingDraft = false;
		}
	}

	async function handleSchedule() {
		const savedPostId = await saveDraft();
		if (savedPostId) {
			scheduleModalOpen = true;
		}
	}

	let isDeletingPost = $state(false);

	async function handleDelete() {
		if (!composerPostId) return;
		if (!confirm("Tem certeza que deseja excluir este post? Esta ação não pode ser desfeita.")) return;
		isDeletingPost = true;
		error = null;
		try {
			await client.mutation(api.generatedPosts.softDelete, { id: composerPostId });
			clearPostComposerState(composerStateKey);
			if (ondelete) {
				ondelete();
			} else {
				void goto("/posts");
			}
		} catch (err) {
			error = formatUserFacingMessage(err);
		} finally {
			isDeletingPost = false;
		}
	}

	function addMedia(id: Id<"media_items">) {
		if (selectedMediaIds.includes(id) || selectedMediaIds.length >= MAX_CAROUSEL) return;
		selectedMediaIds = [...selectedMediaIds, id];
		markComposerPersistenceReady();
	}

	function removeMedia(id: Id<"media_items">) {
		selectedMediaIds = selectedMediaIds.filter((x) => x !== id);
		markComposerPersistenceReady();
	}

	function reorderMedia(fromIndex: number, toIndex: number) {
		if (toIndex < 0 || toIndex >= selectedMediaIds.length) return;
		const arr = [...selectedMediaIds];
		const [item] = arr.splice(fromIndex, 1);
		if (!item) return;
		arr.splice(toIndex, 0, item);
		selectedMediaIds = arr;
		markComposerPersistenceReady();
	}

	function handleAiComposePersistStart() {
		const live = buildPersistedComposerState();
		mergePostComposerStateFromLive(
			composerStateKey,
			{
				aiComposePending: true,
				aiComposeStartedAt: Date.now(),
				aiTemplateId,
				aiImageModel,
				aiResolution,
			},
			live
		);
		aiComposePending = true;
		aiComposeStartedAt = Date.now();
	}

	function handleAiComposePersistSuccess(
		mediaItemIds: Id<"media_items">[],
		generatedCaption: string
	) {
		const ids = mediaItemIds.slice(0, MAX_CAROUSEL).map(String);
		const patch = {
			aiComposePending: false,
			aiComposeStartedAt: undefined,
			selectedMediaIds: ids,
			caption: generatedCaption,
		};
		if (!mergePostComposerStateFromStorage(composerStateKey, patch)) {
			mergePostComposerStateFromLive(composerStateKey, patch, buildPersistedComposerState());
		}
		selectedMediaIds = mediaItemIds.slice(0, MAX_CAROUSEL);
		caption = generatedCaption;
		aiComposePending = false;
		aiComposeStartedAt = undefined;
		markComposerPersistenceReady();
	}

	function handleAiComposePersistError() {
		mergePostComposerStateFromStorage(composerStateKey, {
			aiComposePending: false,
			aiComposeStartedAt: undefined,
		});
		aiComposePending = false;
		aiComposeStartedAt = undefined;
		markComposerPersistenceReady();
	}

	function handleAiComposeStaleClear() {
		mergePostComposerStateFromLive(
			composerStateKey,
			{ aiComposePending: false, aiComposeStartedAt: undefined },
			buildPersistedComposerState()
		);
		aiComposePending = false;
		aiComposeStartedAt = undefined;
		markComposerPersistenceReady();
	}

</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
	{#if showToolbar}
		<div class="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2">
					{#if showPlatformSelector}
						<Badge variant="outline" class="text-xs">Instagram</Badge>
					{/if}
					{#if currentPost?.schedulingStatus === "scheduled" && currentPost.scheduledFor}
						<Badge variant="outline" class="text-xs">
							Agendado para {formatScheduledDate(currentPost.scheduledFor)}
						</Badge>
					{/if}
				</div>
				{#if showCloseAction}
					<Button variant="ghost" size="sm" onclick={handleClose} class="text-xs">
						{closeLabel}
					</Button>
				{/if}
			</div>
		</div>
	{/if}

	<div class="flex min-h-0 flex-1 overflow-hidden">
		<!-- Preview: scroll from top; avoid items-center + min-h-full (clips top, breaks scroll) -->
		<div
			class="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain"
		>
			<div class="mx-auto flex w-full max-w-full justify-center px-4 pb-10 pt-4 sm:px-6 sm:pb-12 sm:pt-6">
				<InstagramPreview
					mediaItems={selectedMedia}
					{caption}
					accountName={selectedProject?.instagramHandle ?? selectedProject?.name ?? "sua_conta"}
					profilePictureUrl={selectedProject?.profilePictureStorageUrl ?? selectedProject?.profilePictureUrl}
					bind:currentIndex={previewIndex}
				/>
			</div>
		</div>

		<!-- Controls sidebar (right) -->
		<aside class="relative flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-border bg-muted/10">
			{#if aiComposePending}
				<div
					class="absolute inset-0 z-30 flex flex-col items-center justify-center bg-background/90 px-5 backdrop-blur-md"
					aria-busy="true"
					aria-live="polite"
				>
					<ImageGenerationPulseLoader
						message="Gerando mídia e legenda…"
						density="comfortable"
					/>
				</div>
			{/if}
			<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
				<div class="min-h-0 flex-1 overflow-y-auto">
					<div class="space-y-5 px-5 py-5">
					<!-- Post title -->
					<div class="space-y-2">
						<p class={sectionLabelClass}>
							<svg
								class="h-3.5 w-3.5"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
								/>
							</svg>
							Título
						</p>
						<input
							type="text"
							bind:value={title}
							oninput={markComposerPersistenceReady}
							placeholder="Título do post..."
							class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>

					<!-- Carousel + media button -->
					<div class="space-y-3">
						{#if selectedMedia.length > 0}
							<CarouselStrip
								items={selectedMedia}
								max={MAX_CAROUSEL}
								onreorder={reorderMedia}
								onremove={removeMedia}
							/>
						{/if}
						<Button
							variant="outline"
							class="w-full gap-2"
							onclick={() => (mediaLibraryOpen = true)}
						>
							<svg
								class="h-4 w-4"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
							</svg>
							{selectedMedia.length > 0 ? "Gerenciar imagens" : "Adicionar imagens"}
						</Button>
					</div>

					<!-- Project -->
					<div class="space-y-3">
						<p class={sectionLabelClass}>
							<svg
								class="h-3.5 w-3.5"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
								/>
							</svg>
							Projeto
						</p>
						<ProjectSelector
							value={selectedProjectId}
							onchange={(projectId) => {
								selectedProjectId = projectId;
								markComposerPersistenceReady();
							}}
							label={null}
							description={null}
							compact
						/>

						<div
							class="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-3 py-3"
						>
							<div>
								<p class="text-sm font-medium">Contexto do projeto</p>
								<p class="text-xs text-muted-foreground">
									Inclui descrição e brand traits na geração da legenda.
								</p>
							</div>
							<button
								type="button"
								aria-label="Alternar contexto do projeto"
								aria-checked={includeProjectContext}
								role="switch"
								class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {includeProjectContext
									? 'bg-primary'
									: 'bg-muted'}"
								onclick={() => {
									includeProjectContext = !includeProjectContext;
									markComposerPersistenceReady();
								}}
							>
								<span
									class="h-5 w-5 rounded-full bg-background shadow transition-transform {includeProjectContext
										? 'translate-x-5'
										: 'translate-x-1'}"
								></span>
							</button>
						</div>
					</div>

					<PostAiComposeSection
						bind:captionBrief
						bind:aiTemplateId
						bind:aiImageModel
						bind:aiResolution
						{captionModel}
						{selectedProjectId}
						{includeProjectContext}
						{aiComposePending}
						aiComposeStartedAt={aiComposeStartedAt ?? null}
						getProjectContext={buildProjectContext}
						billingMonthlyIncluded={billingOverview?.usage?.monthlyIncluded ?? null}
						onComposePersistStart={handleAiComposePersistStart}
						onComposePersistSuccess={handleAiComposePersistSuccess}
						onComposePersistError={handleAiComposePersistError}
						onComposeStaleClear={handleAiComposeStaleClear}
						onPersistenceMark={markComposerPersistenceReady}
					/>

					<!-- Caption briefing -->
					<div class="space-y-2">
						<p class={sectionLabelClass}>
							<svg
								class="h-3.5 w-3.5"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
								/>
							</svg>
							Briefing da legenda
						</p>
						<Textarea
							bind:value={captionBrief}
							oninput={markComposerPersistenceReady}
							placeholder="Descreva o objetivo do post, CTA, tom e mensagens principais."
							class="min-h-[100px] resize-none bg-background text-sm"
						/>
					</div>

					<!-- Caption model -->
					<div class="space-y-2">
						<p class={sectionLabelClass}>
							<svg
								class="h-3.5 w-3.5"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
								/>
							</svg>
							Modelo de legenda
						</p>
						<CaptionModelSelector
							value={captionModel}
							onchange={(v) => {
								captionModel = v;
								markComposerPersistenceReady();
							}}
							monthlyIncludedCredits={billingOverview?.usage?.monthlyIncluded ?? null}
							usageIndicatorMode="percent"
						/>
					</div>

					<!-- Generate button -->
					<div class="space-y-2">
						<div class="flex items-center justify-between text-xs text-muted-foreground">
							<span>Estimativa desta legenda</span>
							<span>
								{#if !billingOverviewLoaded}
									Carregando...
								{:else if captionPlanUsageEstimatePercent !== null}
									{formatPercent(captionPlanUsageEstimatePercent)} do plano
								{:else}
									Plano indisponível
								{/if}
							</span>
						</div>
						<Button
							class="w-full"
							onclick={handleGenerateCaption}
							disabled={isGeneratingCaption || !captionBrief.trim()}
						>
							{isGeneratingCaption ? "Gerando legenda..." : "Gerar legenda"}
						</Button>
					</div>

					<!-- Final caption -->
					<div class="space-y-2">
						<div class="flex items-center justify-between gap-3">
							<p class={sectionLabelClass}>
								<svg
									class="h-3.5 w-3.5"
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
									/>
								</svg>
								Legenda final
							</p>
							{#if caption.length > 0}
								<span class="text-xs text-muted-foreground">{caption.length} car.</span>
							{/if}
						</div>
						<Textarea
							bind:value={caption}
							oninput={markComposerPersistenceReady}
							placeholder="Edite a legenda manualmente ou gere uma nova versão."
							class="min-h-[180px] resize-none bg-background text-sm"
						/>
					</div>

					{#if error}
						<div
							class="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
						>
							{error}
						</div>
					{/if}
					</div>
				</div>

				<!-- Sticky save / schedule footer -->
				<div
					class="shrink-0 space-y-2 border-t border-border bg-background/80 px-5 py-4 backdrop-blur-sm"
				>
				<Button
					class="w-full"
					onclick={saveDraft}
					disabled={isSavingDraft || selectedMediaIds.length === 0}
				>
					{isSavingDraft
						? "Salvando..."
						: isEditingExistingPost
							? "Atualizar rascunho"
							: "Salvar rascunho"}
				</Button>
				<Button
					variant="outline"
					class="w-full"
					onclick={handleSchedule}
					disabled={isSavingDraft || selectedMediaIds.length === 0}
				>
					Salvar e agendar
				</Button>
				{#if isEditingExistingPost}
					<Button
						variant="ghost"
						class="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
						onclick={handleDelete}
						disabled={isDeletingPost}
					>
						{isDeletingPost ? "Excluindo..." : "Excluir post"}
					</Button>
				{/if}
				</div>
			</div>
		</aside>
	</div>
</div>

<MediaLibrarySheet
	open={mediaLibraryOpen}
	selectedIds={selectedMediaIds}
	projectId={selectedProjectId}
	max={MAX_CAROUSEL}
	onselect={addMedia}
	ondeselect={removeMedia}
	onclose={() => (mediaLibraryOpen = false)}
/>

{#if activePostId && coverMedia}
	<ScheduleModal
		open={scheduleModalOpen}
		onclose={() => (scheduleModalOpen = false)}
		postId={activePostId}
		caption={caption}
		imageUrl={coverMedia.url}
		projectName={selectedProject?.name}
	/>
{/if}

<script lang="ts">
	import { Button, Textarea, Badge } from "$lib/components/ui";
	import {
		ImageModelSelector,
		AspectRatioSelector,
		ResolutionSelector,
		ImageTemplateSection,
		ImageGenerationPulseLoader,
	} from "$lib/components/studio";
	import { DEFAULT_PRESET, getStylePresetPromptForApi } from "$lib/data/imagePresets";
	import { MediaLightbox } from "$lib/components/lightbox";
	import { SignedIn, SignedOut, SignInButton, UserButton } from "svelte-clerk";
	import { useConvexClient, useQuery } from "convex-svelte";
	import { api } from "../../../../convex/_generated/api.js";
	import type { Id } from "../../../../convex/_generated/dataModel.js";
	import { page } from "$app/stores";
	import { goto } from "$app/navigation";
	import Logo from "$lib/components/Logo.svelte";
	import {
		coerceImageGenerationSettings,
		DEFAULT_STUDIO_IMAGE_MODEL,
		getSupportedAspectRatios,
		getSupportedResolutions,
		type AspectRatio,
		type Resolution,
	} from "$lib/studio/imageGenerationCapabilities";
	import {
		estimateImageEditUsage,
		formatCredits,
		sumUsageLineItemCredits,
	} from "$lib/billing/aiCredits";
	type CanvasMode = "canvas" | "history";

	interface TurnOutput {
		_id: Id<"image_edit_outputs">;
		url: string | null;
		thumbnailUrl?: string | null;
		model: string;
		width: number;
		height: number;
		createdAt: number;
	}

	interface Turn {
		_id: Id<"image_edit_turns">;
		turnIndex: number;
		userMessage: string;
		selectedModels: string[];
		selectedOutputIds?: Id<"image_edit_outputs">[];
		aspectRatio: string;
		resolution: string;
		status: string;
		pendingModels?: string[];
		outputs: TurnOutput[];
		createdAt: number;
	}

	interface LightboxMediaItem {
		_id: Id<"media_items">;
		url: string | null;
		thumbnailUrl?: string | null;
		model?: string;
		sourceType: string;
		prompt?: string;
		userPrompt?: string;
		generationDurationMs?: number;
		width: number;
		height: number;
		aspectRatio?: string;
		resolution?: string;
		createdAt: number;
		sourceConversationId?: Id<"image_edit_conversations">;
		sourceTurnId?: Id<"image_edit_turns">;
		sourceOutputId?: Id<"image_edit_outputs">;
		storageId: Id<"_storage">;
		mimeType: string;
	}

	const client = useConvexClient();
	const ACTIVE_GENERATION_WINDOW_MS = 5 * 60 * 1000;

	const modelDisplayNames: Record<string, string> = {
		"google/gemini-2.5-flash-image": "Nano Banana",
		"google/gemini-3.1-flash-image-preview": "Nano Banana 2",
		"google/gemini-3-pro-image-preview": "Nano Banana Pro",
		"bytedance-seed/seedream-4.5": "SeeDream v4.5",
		"black-forest-labs/flux.2-flex": "Flux 2 Flex",
		"openai/gpt-5-image": "GPT Image 1.5",
	};

	let conversationId = $derived($page.params.conversationId as Id<"image_edit_conversations">);
	let pendingTurnId = $derived($page.url.searchParams.get("turnId") as Id<"image_edit_turns"> | null);
	let generationTriggered = $state(false);
	let canvasMode = $state<CanvasMode>("canvas");
	let staleCleanupStarted = $state(false);

	$effect(() => {
		if (pendingTurnId && !generationTriggered) {
			generationTriggered = true;
			const url = new URL($page.url);
			url.searchParams.delete("turnId");
			goto(url.pathname, { replaceState: true, noScroll: true });

			client.action(api.ai.imageEdit.generateForTurn, {
				conversationId,
				turnId: pendingTurnId,
			}).catch((err) => {
				console.error("Failed to generate images:", err);
			});
		}
	});

	$effect(() => {
		if (staleCleanupStarted) return;
		staleCleanupStarted = true;

		void client
			.mutation(api.imageEditConversations.cleanupStalePendingByUser, {
				staleAfterMs: ACTIVE_GENERATION_WINDOW_MS,
			})
			.catch(() => undefined);
	});

	const conversationQuery = useQuery(
		api.imageEditConversations.get,
		() => conversationId ? { id: conversationId } : "skip"
	);
	const turnsQuery = useQuery(
		api.imageEditTurns.listByConversation,
		() => conversationId ? { conversationId } : "skip"
	);
	const lightboxItemsQuery = useQuery(
		api.mediaItems.listBySourceOutputIds,
		() => {
			const outputIds = ((turnsQuery.data ?? []) as Turn[]).flatMap((turn) =>
				turn.outputs.map((output) => output._id)
			);
			return outputIds.length > 0 ? { outputIds } : "skip";
		}
	);

	let conversation = $derived(conversationQuery.data);
	let turns = $derived((turnsQuery.data ?? []) as Turn[]);
	let conversationMediaItems = $derived((lightboxItemsQuery.data ?? []) as LightboxMediaItem[]);
	let isLoading = $derived(!conversation && conversationQuery.isLoading);
	let turnCount = $derived(turns.length);
	let isAnyGenerating = $derived(
		turns.some((turn) => turn.status === "generating" || (turn.pendingModels?.length ?? 0) > 0)
	);

	let selectedModels = $state<string[]>([DEFAULT_STUDIO_IMAGE_MODEL]);
	let selectedPreset = $state<string>(DEFAULT_PRESET);
	let aspectRatio = $state<AspectRatio>("1:1");
	let resolution = $state<Resolution>("standard");
	let supportedAspectRatios = $derived(getSupportedAspectRatios(selectedModels));
	let supportedResolutions = $derived(getSupportedResolutions(selectedModels));
	let creditEstimate = $derived(
		sumUsageLineItemCredits(estimateImageEditUsage(selectedModels))
	);
	let editPrompt = $state("");
	let isSending = $state(false);
	let settingsInitialized = $state(false);

	let latestSeedTurn = $derived(() => {
		for (let index = turns.length - 1; index >= 0; index -= 1) {
			const turn = turns[index];
			if (turn && turn.outputs.length > 0) {
				return turn;
			}
		}
		return null;
	});

	let selectedSeedOutputIds = $state<Id<"image_edit_outputs">[]>([]);
	let selectedSeedTurnId = $state<Id<"image_edit_turns"> | null>(null);

	$effect(() => {
		if (!conversation || settingsInitialized) return;
		selectedModels = [DEFAULT_STUDIO_IMAGE_MODEL];
		aspectRatio = (conversation.aspectRatio as AspectRatio | undefined) ?? "1:1";
		resolution = (conversation.resolution as Resolution | undefined) ?? "standard";
		settingsInitialized = true;
	});

	$effect(() => {
		const normalized = coerceImageGenerationSettings(selectedModels, aspectRatio, resolution);
		if (normalized.aspectRatio !== aspectRatio) {
			aspectRatio = normalized.aspectRatio;
		}
		if (normalized.resolution !== resolution) {
			resolution = normalized.resolution;
		}
	});

	$effect(() => {
		const seedTurn = latestSeedTurn();
		if (!seedTurn) {
			selectedSeedOutputIds = [];
			selectedSeedTurnId = null;
			return;
		}

		const outputIds = seedTurn.outputs.map((output) => output._id);
		if (selectedSeedTurnId !== seedTurn._id) {
			selectedSeedOutputIds = outputIds;
			selectedSeedTurnId = seedTurn._id;
			return;
		}

		const validIds = new Set(outputIds);
		const retainedIds = selectedSeedOutputIds.filter((id) => validIds.has(id));
		if (retainedIds.length === 0) {
			selectedSeedOutputIds = outputIds;
			return;
		}
		if (retainedIds.length !== selectedSeedOutputIds.length) {
			selectedSeedOutputIds = retainedIds;
		}
	});

	let lightboxMediaId = $state<string | null>(null);
	let lightboxOpen = $derived(!!lightboxMediaId);

	async function openLightbox(outputId: Id<"image_edit_outputs">) {
		const existing = conversationMediaItems.find((item) => item.sourceOutputId === outputId);
		if (existing) {
			lightboxMediaId = existing._id;
			return;
		}

		try {
			const results = await client.query(api.mediaItems.listBySourceOutputIds, {
				outputIds: [outputId],
			});
			const item = results[0] as LightboxMediaItem | undefined;
			if (item) {
				lightboxMediaId = item._id;
			}
		} catch (err) {
			console.error("Failed to open media lightbox:", err);
		}
	}

	function closeLightbox() {
		lightboxMediaId = null;
	}

	function navigateLightbox(mediaId: string) {
		lightboxMediaId = mediaId;
	}

	function getModelDisplayName(model?: string): string {
		if (!model) return "Imagem";
		return modelDisplayNames[model] ?? model.split("/").pop() ?? model;
	}

	function getAspectRatioValue(aspectRatio?: string, width?: number, height?: number): string {
		if (width && height) return `${width} / ${height}`;
		if (!aspectRatio) return "1 / 1";
		const [aspectWidth, aspectHeight] = aspectRatio.split(":");
		if (!aspectWidth || !aspectHeight) return "1 / 1";
		return `${aspectWidth} / ${aspectHeight}`;
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString("pt-BR", {
			day: "2-digit",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function getTurnOutputCount(turn: Turn): number {
		return turn.outputs.length + (turn.pendingModels?.length ?? 0);
	}

	function isSelectableTurn(turnId: Id<"image_edit_turns">): boolean {
		return latestSeedTurn()?._id === turnId;
	}

	function isSeedSelected(outputId: Id<"image_edit_outputs">): boolean {
		return selectedSeedOutputIds.includes(outputId);
	}

	function toggleSeedOutput(outputId: Id<"image_edit_outputs">) {
		if (selectedSeedOutputIds.includes(outputId)) {
			if (selectedSeedOutputIds.length > 1) {
				selectedSeedOutputIds = selectedSeedOutputIds.filter((id) => id !== outputId);
			}
			return;
		}

		selectedSeedOutputIds = [...selectedSeedOutputIds, outputId];
	}

	async function handleSendEdit() {
		if (!editPrompt.trim() || selectedModels.length === 0 || isSending || isAnyGenerating) return;
		isSending = true;
		try {
			const normalized = coerceImageGenerationSettings(selectedModels, aspectRatio, resolution);
			aspectRatio = normalized.aspectRatio;
			resolution = normalized.resolution;

			const stylePreset = getStylePresetPromptForApi(selectedPreset);
			await client.action(api.ai.imageEdit.sendEdit, {
				conversationId,
				userMessage: editPrompt.trim(),
				selectedModels,
				aspectRatio: normalized.aspectRatio,
				resolution: normalized.resolution,
				...(selectedSeedOutputIds.length > 0 ? { selectedOutputIds: selectedSeedOutputIds } : {}),
				...(stylePreset && { stylePreset }),
			});
			editPrompt = "";
		} catch (err) {
			console.error("Failed to send edit:", err);
		} finally {
			isSending = false;
		}
	}

	function handleComposerKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			handleSendEdit();
		}
	}

	function getReferenceSelectionLabel(): string {
		if (selectedSeedOutputIds.length === 1) {
			return "1 imagem selecionada como base";
		}

		return `${selectedSeedOutputIds.length} imagens selecionadas como base`;
	}
</script>

<svelte:window onkeydown={handleComposerKeydown} />

<svelte:head>
	<title>{conversation?.title ?? "Editar imagem"} - Vanda Studio</title>
</svelte:head>

<div class="flex h-screen flex-col bg-background">
	<header class="shrink-0 border-b border-border">
		<div class="flex h-14 items-center justify-between px-4">
			<div class="flex items-center gap-4">
				<a href="/"><Logo /></a>
				<div class="h-6 w-px bg-border"></div>
				<button
					type="button"
					class="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
					onclick={() => goto("/images")}
				>
					<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
					</svg>
					Gallery
				</button>

				<div>
					<p class="text-sm font-medium">{conversation?.title ?? "Carregando..."}</p>
					<p class="text-xs text-muted-foreground">{turnCount} turn{turnCount === 1 ? "" : "s"}</p>
				</div>
			</div>

			<div class="flex items-center gap-3">
				<div class="flex overflow-hidden rounded-xl border border-border bg-card">
					<button
						type="button"
						class="flex h-10 w-10 items-center justify-center text-sm transition-colors {canvasMode === 'canvas' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}"
						aria-label="Visualização em canvas"
						onclick={() => (canvasMode = "canvas")}
					>
						<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4.75 4.75h5.5v5.5h-5.5zm9 0h5.5v5.5h-5.5zm-9 9h5.5v5.5h-5.5zm9 0h5.5v5.5h-5.5z" />
						</svg>
					</button>
					<button
						type="button"
						class="flex h-10 w-10 items-center justify-center text-sm transition-colors {canvasMode === 'history' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}"
						aria-label="Visualização em histórico"
						onclick={() => (canvasMode = "history")}
					>
						<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h16M4 17h16" />
						</svg>
					</button>
				</div>

				<SignedOut>
					<SignInButton mode="modal">
						<button class="h-8 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
							Entrar
						</button>
					</SignInButton>
				</SignedOut>
				<SignedIn>
					<div class="flex items-center gap-3">
						<Button variant="ghost" size="sm" onclick={() => goto("/account#planos")}>
							Planos
						</Button>
						<UserButton />
					</div>
				</SignedIn>
			</div>
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
		<aside class="flex w-80 shrink-0 flex-col border-r border-border bg-muted/20">
			<div class="space-y-5 overflow-y-auto p-4">
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<h2 class="text-sm font-semibold text-foreground">Configurações</h2>
						<Badge variant="secondary">{selectedModels.length} ativo{selectedModels.length > 1 ? "s" : ""}</Badge>
					</div>

					{#if conversation?.sourceImageUrl}
						<div class="overflow-hidden rounded-xl border border-border bg-card">
							<div class="overflow-hidden bg-muted" style={`aspect-ratio: ${getAspectRatioValue(conversation.sourceMedia?.aspectRatio ?? conversation.aspectRatio, conversation.sourceMedia?.width, conversation.sourceMedia?.height)};`}>
								<img src={conversation.sourceImageUrl} alt="Imagem de origem" class="h-full w-full object-cover" />
							</div>
							<div class="px-3 py-3">
								<p class="text-sm font-medium text-foreground">Imagem de origem</p>
								<p class="mt-1 text-xs text-muted-foreground">
									{conversation.sourceMedia?.width ?? 0} × {conversation.sourceMedia?.height ?? 0}
								</p>
							</div>
						</div>
					{/if}
				</div>

				<ImageTemplateSection bind:selectedPreset />

				<div class="space-y-2">
					<p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Modelos</p>
					<ImageModelSelector selected={selectedModels} onchange={(models) => (selectedModels = models)} compact />
				</div>

				<div class="space-y-2">
					<p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Proporção</p>
					<AspectRatioSelector
						value={aspectRatio}
						onchange={(value) => (aspectRatio = value)}
						supportedValues={supportedAspectRatios}
						compact
					/>
				</div>

				<div class="space-y-2">
					<p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Resolução</p>
					<ResolutionSelector
						value={resolution}
						onchange={(value) => (resolution = value)}
						supportedValues={supportedResolutions}
						compact
					/>
				</div>
			</div>
		</aside>

		<main class="flex min-h-0 flex-1 flex-col">
			{#if isLoading}
				<div class="flex flex-1 items-center justify-center">
					<div class="flex flex-col items-center gap-4">
						<svg class="h-8 w-8 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<p class="text-sm text-muted-foreground">Carregando conversa...</p>
					</div>
				</div>
			{:else if !conversation}
				<div class="flex flex-1 items-center justify-center">
					<div class="text-center">
						<p class="text-sm text-muted-foreground">Conversa não encontrada.</p>
						<Button class="mt-4" variant="outline" onclick={() => goto("/images")}>Voltar</Button>
					</div>
				</div>
			{:else}
				<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
					<div class="flex-1 overflow-y-auto p-6">
						<div class="mx-auto flex w-full max-w-5xl flex-col gap-6">
							{#if canvasMode === "canvas"}
								<div class="space-y-6">
									{#each turns as turn (turn._id)}
										<section class="rounded-2xl border border-border bg-card/60 p-5 shadow-sm">
											<div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
												<div class="h-2 w-2 rounded-full bg-primary"></div>
												<span>{formatDate(turn.createdAt)}</span>
												<span>{getTurnOutputCount(turn)} output{getTurnOutputCount(turn) === 1 ? "" : "s"}</span>
											</div>

											<h3 class="mt-3 text-lg font-medium text-foreground">{turn.userMessage}</h3>

											<div class="mt-4 flex flex-wrap gap-4">
												{#each turn.outputs as output (output._id)}
													<div
														class="group relative overflow-hidden rounded-2xl border bg-card transition {isSelectableTurn(turn._id) && isSeedSelected(output._id) ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:border-primary/40'}"
														style="width: 200px;"
													>
														<button
															type="button"
															class="w-full text-left"
															onclick={() => openLightbox(output._id)}
														>
															<div class="overflow-hidden bg-muted" style={`aspect-ratio: ${getAspectRatioValue(undefined, output.width, output.height)};`}>
																{#if output.url}
																	<img
																		src={output.thumbnailUrl ?? output.url}
																		alt="Resultado"
																		loading="lazy"
																		decoding="async"
																		class="h-full w-full object-cover"
																	/>
																{/if}
															</div>
															<div class="px-3 py-3">
																<p class="text-sm font-medium text-foreground">{getModelDisplayName(output.model)}</p>
																{#if isSelectableTurn(turn._id)}
																	<p class="mt-1 text-xs text-muted-foreground">
																		{isSeedSelected(output._id) ? "Selecionada como base" : "Clique no check para usar como base"}
																	</p>
																{/if}
															</div>
														</button>
														{#if isSelectableTurn(turn._id)}
															<button
																type="button"
																class="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-sm transition {isSeedSelected(output._id) ? 'border-primary bg-primary text-primary-foreground shadow-lg' : 'border-white/15 bg-black/55 text-white/75 hover:text-white'}"
																aria-pressed={isSeedSelected(output._id)}
																aria-label={isSeedSelected(output._id) ? "Remover imagem base" : "Usar imagem como base"}
																onclick={() => toggleSeedOutput(output._id)}
															>
																{#if isSeedSelected(output._id)}
																	<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor">
																		<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
																	</svg>
																{:else}
																	<div class="h-3.5 w-3.5 rounded-full border border-current"></div>
																{/if}
															</button>
														{/if}
													</div>
												{/each}

												{#each turn.pendingModels ?? [] as model (model)}
													<div class="w-[200px] overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-card/60 shadow-sm">
														<div class="relative bg-muted/30" style={`aspect-ratio: ${getAspectRatioValue(turn.aspectRatio)};`}>
															<div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),rgba(255,255,255,0.06))]"></div>
															<div class="relative z-[1] flex h-full w-full flex-col items-center justify-center p-2">
																<ImageGenerationPulseLoader
																	message="Gerando…"
																	density="compact"
																/>
															</div>
														</div>
														<div class="px-3 py-3">
															<p class="text-sm font-medium text-foreground">{getModelDisplayName(model)}</p>
															<p class="mt-1 text-xs text-muted-foreground">Novo resultado em andamento</p>
														</div>
													</div>
												{/each}
											</div>
										</section>
									{/each}
								</div>
							{:else}
								<div class="space-y-6">
									{#each turns as turn (turn._id)}
										<section class="rounded-2xl border border-border bg-card/60 p-5 shadow-sm">
											<div class="flex flex-wrap items-center justify-between gap-3">
												<div>
													<p class="text-sm font-semibold text-foreground">Turn {turn.turnIndex + 1}</p>
													<p class="mt-1 text-xs text-muted-foreground">{formatDate(turn.createdAt)}</p>
												</div>
												<div class="flex items-center gap-2">
													<Badge variant="secondary">{turn.aspectRatio}</Badge>
													<Badge variant="secondary">{turn.resolution}</Badge>
													{#if turn.pendingModels?.length}
														<Badge variant="secondary">Gerando...</Badge>
													{/if}
												</div>
											</div>

											<p class="mt-4 text-sm leading-7 text-foreground">{turn.userMessage}</p>

											<div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
												{#each turn.outputs as output (output._id)}
													<div class="group relative overflow-hidden rounded-2xl border bg-card transition {isSelectableTurn(turn._id) && isSeedSelected(output._id) ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:border-primary/40'}">
														<button
															type="button"
															class="w-full text-left"
															onclick={() => openLightbox(output._id)}
														>
															<div class="overflow-hidden bg-muted" style={`aspect-ratio: ${getAspectRatioValue(undefined, output.width, output.height)};`}>
																{#if output.url}
																	<img
																		src={output.thumbnailUrl ?? output.url}
																		alt="Resultado"
																		loading="lazy"
																		decoding="async"
																		class="h-full w-full object-cover"
																	/>
																{/if}
															</div>
															<div class="px-4 py-3">
																<p class="text-sm font-medium text-foreground">{getModelDisplayName(output.model)}</p>
																{#if isSelectableTurn(turn._id)}
																	<p class="mt-1 text-xs text-muted-foreground">
																		{isSeedSelected(output._id) ? "Selecionada como base" : "Clique no check para usar como base"}
																	</p>
																{/if}
															</div>
														</button>
														{#if isSelectableTurn(turn._id)}
															<button
																type="button"
																class="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-sm transition {isSeedSelected(output._id) ? 'border-primary bg-primary text-primary-foreground shadow-lg' : 'border-white/15 bg-black/55 text-white/75 hover:text-white'}"
																aria-pressed={isSeedSelected(output._id)}
																aria-label={isSeedSelected(output._id) ? "Remover imagem base" : "Usar imagem como base"}
																onclick={() => toggleSeedOutput(output._id)}
															>
																{#if isSeedSelected(output._id)}
																	<svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor">
																		<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
																	</svg>
																{:else}
																	<div class="h-3.5 w-3.5 rounded-full border border-current"></div>
																{/if}
															</button>
														{/if}
													</div>
												{/each}

												{#each turn.pendingModels ?? [] as model (model)}
													<div class="overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-card/60 shadow-sm">
														<div class="relative bg-muted/30" style={`aspect-ratio: ${getAspectRatioValue(turn.aspectRatio)};`}>
															<div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),rgba(255,255,255,0.06))]"></div>
															<div class="relative z-[1] flex h-full w-full flex-col items-center justify-center p-2">
																<ImageGenerationPulseLoader
																	message="Gerando…"
																	density="compact"
																/>
															</div>
														</div>
														<div class="px-4 py-3">
															<p class="text-sm font-medium text-foreground">{getModelDisplayName(model)}</p>
															<p class="mt-1 text-xs text-muted-foreground">Novo resultado em andamento</p>
														</div>
													</div>
												{/each}
											</div>
										</section>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					<div class="shrink-0 border-t border-border bg-background/95 p-4 backdrop-blur-md">
						<div class="mx-auto w-full max-w-5xl">
							{#if latestSeedTurn()}
								<div class="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5">
									<div>
										<p class="text-sm font-medium text-foreground">{getReferenceSelectionLabel()}</p>
										<p class="text-xs text-muted-foreground">
											Marque os checks diretamente nos cards acima para definir o que alimenta a próxima geração.
										</p>
									</div>
									<Badge variant="secondary">{selectedSeedOutputIds.length}</Badge>
								</div>
							{/if}

							<div class="flex items-end gap-3">
								<Textarea
									bind:value={editPrompt}
									placeholder="Select an image and describe your edit..."
									class="min-h-[96px] resize-none bg-background"
								/>
								<Button
									class="h-11 shrink-0 px-5"
									disabled={!editPrompt.trim() || selectedModels.length === 0 || isSending || isAnyGenerating}
									onclick={handleSendEdit}
								>
									{#if isSending}
										<svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
									{:else}
										Gerar
									{/if}
								</Button>
							</div>
							<p class="mt-2 text-xs text-muted-foreground">
								Estimativa desta edição: {formatCredits(creditEstimate, 2)} crédito(s)
							</p>
							<p class="mt-2 text-xs text-muted-foreground">
								<kbd class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Cmd</kbd>+<kbd class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> para enviar
							</p>
						</div>
					</div>
				</div>
			{/if}
		</main>
	</div>
</div>

{#if lightboxOpen && lightboxMediaId && conversationMediaItems.length > 0}
	<MediaLightbox
		items={conversationMediaItems}
		currentMediaId={lightboxMediaId}
		onclose={closeLightbox}
		onnavigate={navigateLightbox}
	/>
{/if}

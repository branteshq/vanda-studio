<script lang="ts">
    import { Button, Textarea, Label, Badge, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "$lib/components/ui";
    import { ImageModelSelector, ImageTemplateSection } from "$lib/components/studio";
    import { DEFAULT_PRESET, getStylePresetPromptForApi } from "$lib/data/imagePresets";
    import { useConvexClient } from "convex-svelte";
    import { api } from "../../../convex/_generated/api.js";
    import type { Id } from "../../../convex/_generated/dataModel.js";
    import { goto } from "$app/navigation";
    import {
        estimateImageEditUsage,
        formatCredits,
        sumUsageLineItemCredits,
    } from "$lib/billing/aiCredits";
    import { formatUserFacingMessage } from "$lib/errors";

    interface GeneratedImage {
        _id: Id<"generated_images">;
        storageId: Id<"_storage">;
        model: string;
        url: string | null;
        prompt: string;
        width: number;
        height: number;
        aspectRatio?: string;
        resolution?: string;
    }

    interface MediaItem {
        _id: Id<"media_items">;
        storageId: Id<"_storage">;
        model?: string;
        url: string | null;
        prompt?: string;
        width: number;
        height: number;
        aspectRatio?: string;
        resolution?: string;
    }

    interface Props {
        image?: GeneratedImage;
        mediaItem?: MediaItem;
        open: boolean;
        onclose: () => void;
    }

    let { image, mediaItem, open, onclose }: Props = $props();

    // Unified source: prefer mediaItem if provided
    let source = $derived(mediaItem ? {
        id: mediaItem._id,
        storageId: mediaItem.storageId,
        model: mediaItem.model ?? "",
        url: mediaItem.url,
        prompt: mediaItem.prompt ?? "",
        width: mediaItem.width,
        height: mediaItem.height,
        isMediaItem: true as const,
    } : image ? {
        id: image._id,
        storageId: image.storageId,
        model: image.model,
        url: image.url,
        prompt: image.prompt,
        width: image.width,
        height: image.height,
        isMediaItem: false as const,
    } : null);

    const client = useConvexClient();

    // Form state
    let selectedModels = $state<string[]>([]);
    let selectedPreset = $state<string>(DEFAULT_PRESET);
    let editPrompt = $state("");
    let referenceImages = $state<Array<{ id: string; url: string; name: string; file: File }>>([]);
    let isStarting = $state(false);
    let error = $state<string | null>(null);
    let fileInputEl = $state<HTMLInputElement | null>(null);
    let creditEstimate = $derived(
        sumUsageLineItemCredits(estimateImageEditUsage(selectedModels))
    );

    // Initialize selected models when source changes
    $effect(() => {
        if (source?.model) {
            selectedModels = [source.model];
        }
    });

    // Actual image dimensions (loaded from image file)
    let actualDimensions = $state<{ width: number; height: number } | null>(null);

    // Load actual dimensions when source URL changes
    $effect(() => {
        const url = source?.url;
        if (url) {
            actualDimensions = null; // Reset while loading
            const img = new Image();
            img.onload = () => {
                actualDimensions = { width: img.naturalWidth, height: img.naturalHeight };
            };
            img.src = url;
        }
    });

    // Model display names
    const modelDisplayNames: Record<string, string> = {
        "google/gemini-2.5-flash-image": "Nano Banana",
		"google/gemini-3.1-flash-image-preview": "Nano Banana 2",
        "google/gemini-3-pro-image-preview": "Nano Banana Pro",
        "bytedance-seed/seedream-4.5": "SeeDream v4.5",
        "black-forest-labs/flux.2-flex": "Flux 2 Flex",
        "openai/gpt-5-image": "GPT Image 1.5",
    };

    // Add image files to references
    function addImageFiles(files: File[]) {
        files.forEach((file) => {
            if (!file.type.startsWith('image/')) return;
            const url = URL.createObjectURL(file);
            referenceImages = [...referenceImages, {
                id: crypto.randomUUID(),
                url,
                name: file.name || `pasted-image-${Date.now()}.png`,
                file
            }];
        });
    }

    // Handle file selection for additional references
    function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        if (!input.files) return;
        
        addImageFiles(Array.from(input.files));
        
        input.value = "";
    }

    // Handle paste from clipboard
    function handlePaste(event: ClipboardEvent) {
        const items = event.clipboardData?.items;
        if (!items) return;

        const imageFiles: File[] = [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    imageFiles.push(file);
                }
            }
        }

        if (imageFiles.length > 0) {
            event.preventDefault();
            addImageFiles(imageFiles);
        }
    }

    function removeReference(id: string) {
        const img = referenceImages.find(r => r.id === id);
        if (img) {
            URL.revokeObjectURL(img.url);
        }
        referenceImages = referenceImages.filter(r => r.id !== id);
    }

    // Upload a file to Convex storage
    async function uploadFileToStorage(file: File): Promise<Id<"_storage">> {
        const uploadUrl = await client.mutation(api.referenceImages.generateUploadUrl, {});
        
        const response = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
        });
        
        if (!response.ok) {
            throw new Error("Falha ao fazer upload da imagem");
        }
        
        const { storageId } = await response.json();
        return storageId as Id<"_storage">;
    }

    // Start the conversation
    async function handleStart() {
        if (!editPrompt.trim() || selectedModels.length === 0 || !source) return;

        isStarting = true;
        error = null;

        try {
            // Upload manual reference images if any
            let manualReferenceIds: Id<"_storage">[] = [];
            if (referenceImages.length > 0) {
                const uploadPromises = referenceImages.map(img => uploadFileToStorage(img.file));
                manualReferenceIds = await Promise.all(uploadPromises);
            }

            // Create conversation and first turn synchronously (fast mutation)
            const stylePreset = getStylePresetPromptForApi(selectedPreset);
            const startArgs: Record<string, unknown> = {
                userMessage: editPrompt,
                selectedModels,
                ...(manualReferenceIds.length > 0 && { manualReferenceIds }),
                ...(stylePreset && { stylePreset }),
            };

            if (source.isMediaItem) {
                startArgs.sourceMediaId = source.id;
            } else {
                startArgs.sourceImageId = source.id;
            }

            const result = await client.action(api.ai.imageEdit.startConversation, startArgs as any);

            // Navigate to the conversation page under images
            goto(`/images/conversations/${result.conversationId}?turnId=${result.turnId}`);
        } catch (err) {
            console.error("Failed to start conversation:", err);
            error = formatUserFacingMessage(err);
            isStarting = false;
        }
    }

    // Handle keyboard shortcuts
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            onclose();
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            handleStart();
        }
    }

    // Close modal and reset state
    function handleClose() {
        // Clean up reference image URLs
        referenceImages.forEach(img => URL.revokeObjectURL(img.url));
        referenceImages = [];
        editPrompt = "";
        error = null;
        onclose();
    }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
    <!-- Backdrop -->
    <div 
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onclick={handleClose}
        onkeydown={(e) => e.key === "Enter" && handleClose()}
        role="button"
        tabindex="0"
    ></div>

    <!-- Modal -->
    <div class="fixed inset-4 z-50 mx-auto my-auto flex max-h-[90vh] max-w-4xl flex-col overflow-hidden border border-border bg-background shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[900px]">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-border px-6 py-4">
            <div class="flex items-center gap-3">
                <button
                    type="button"
                    aria-label="Voltar"
                    class="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                    onclick={handleClose}
                >
                    <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                    </svg>
                </button>
                <div>
                    <h2 class="text-lg font-semibold">Nova Conversa</h2>
                    <p class="text-sm text-muted-foreground">Comece a editar esta imagem</p>
                </div>
            </div>
            <button
                type="button"
                aria-label="Fechar"
                class="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                onclick={handleClose}
            >
                <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>

        <!-- Content -->
        <div class="flex flex-1 overflow-hidden">
            <!-- Left: Source Image -->
            <div class="flex w-[320px] shrink-0 flex-col border-r border-border bg-muted/30 p-6">
                <Label class="mb-3 text-sm font-medium">Imagem de origem</Label>
                <div class="relative overflow-hidden border border-border bg-background" style="aspect-ratio: {source?.width ?? 1} / {source?.height ?? 1};">
                    {#if source?.url}
                        <img
                            src={source.url}
                            alt="Imagem de origem"
                            class="h-full w-full object-cover"
                        />
                    {:else}
                        <div class="flex h-full w-full items-center justify-center bg-muted">
                            <p class="text-sm text-muted-foreground">Imagem indisponível</p>
                        </div>
                    {/if}
                </div>
                <div class="mt-3 space-y-1">
                    <p class="text-sm font-medium">{modelDisplayNames[source?.model ?? ""] ?? source?.model ?? "Desconhecido"}</p>
                    <p class="text-xs text-muted-foreground">
                        {#if actualDimensions}
                            {actualDimensions.width} x {actualDimensions.height}
                        {:else}
                            {source?.width ?? 0} x {source?.height ?? 0}
                        {/if}
                    </p>
                </div>
            </div>

            <!-- Right: Edit Form -->
            <div class="flex flex-1 flex-col overflow-y-auto p-6">
                <!-- Error message -->
                {#if error}
                    <div class="mb-4 border border-destructive/50 bg-destructive/10 p-3">
                        <p class="text-sm text-destructive">{error}</p>
                    </div>
                {/if}

                <!-- Edit prompt -->
                <div class="space-y-3">
                    <Label class="text-sm font-medium">O que você quer mudar?</Label>
                    <div class="relative">
                        <Textarea
                            bind:value={editPrompt}
                            placeholder="Descreva a edição que você quer fazer. Ex: 'Troque o fundo por uma praia ao por do sol' ou 'Adicione um chapéu na pessoa'... (Cole imagens com Ctrl+V)"
                            class="min-h-[120px] resize-none bg-background pb-12"
                            onpaste={handlePaste}
                        />
                        <!-- Action bar -->
                        <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                            <input
                                bind:this={fileInputEl}
                                type="file"
                                accept="image/*"
                                multiple
                                class="hidden"
                                onchange={handleFileSelect}
                            />
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <button
                                            type="button"
                                            aria-label="Adicionar imagens de referencia"
                                            class="flex h-8 w-8 items-center justify-center rounded-none border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                            onclick={() => fileInputEl?.click()}
                                        >
                                            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                                            </svg>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Adicionar imagens de referencia</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <span class="text-xs text-muted-foreground">
                                {editPrompt.length} caracteres
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Additional reference images -->
                {#if referenceImages.length > 0}
                    <div class="mt-4 space-y-2">
                        <Label class="text-xs text-muted-foreground">Referencias adicionais</Label>
                        <div class="flex flex-wrap gap-2">
                            {#each referenceImages as ref (ref.id)}
                                <div class="group relative">
                                    <div class="h-14 w-14 overflow-hidden border border-border bg-muted">
                                        <img 
                                            src={ref.url} 
                                            alt={ref.name}
                                            class="h-full w-full object-cover"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="Remover imagem"
                                        class="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                        onclick={() => removeReference(ref.id)}
                                    >
                                        <svg class="h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                            <button
                                type="button"
                                aria-label="Adicionar mais imagens"
                                class="flex h-14 w-14 items-center justify-center border border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                                onclick={() => fileInputEl?.click()}
                            >
                                <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                </svg>
                            </button>
                        </div>
                    </div>
                {/if}

                <!-- Model selector -->
                <div class="mt-6 space-y-3">
                    <Label class="text-sm font-medium">Modelos de imagem</Label>
                    <p class="text-xs text-muted-foreground">Selecione um ou mais modelos para gerar variantes</p>
                    <ImageModelSelector 
                        selected={selectedModels}
                        onchange={(models) => selectedModels = models}
                    />
                </div>

                <div class="mt-6">
                    <ImageTemplateSection bind:selectedPreset />
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between border-t border-border px-6 py-4">
            <p class="text-xs text-muted-foreground">
                <kbd class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Cmd</kbd>
                +
                <kbd class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
                para enviar
            </p>
            <div class="flex items-center gap-3">
                <p class="text-xs text-muted-foreground">
                    Estimativa: {formatCredits(creditEstimate, 2)} crédito(s)
                </p>
                <Button variant="outline" onclick={handleClose} disabled={isStarting}>
                    Cancelar
                </Button>
                <Button 
                    onclick={handleStart} 
                    disabled={!editPrompt.trim() || selectedModels.length === 0 || isStarting}
                >
                    {#if isStarting}
                        <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Iniciando...
                    {:else}
                        Começar Edição
                    {/if}
                </Button>
            </div>
        </div>
    </div>
{/if}

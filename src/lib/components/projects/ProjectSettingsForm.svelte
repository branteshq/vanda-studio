<script lang="ts">
    import { Button, Input, Label, Separator } from "$lib/components/ui";
    import { BrandKitEditor, ContextImageUploader, PlatformSelector } from "$lib/components/projects";
    import { BrandSummaryCard } from "$lib/components/wizard";
    import {
        emptyBrandKit,
        mergeBrandSuggestion,
        type BrandKitState,
    } from "$lib/types/brandKit";
    import { useConvexClient } from "convex-svelte";
    import { api } from "../../../convex/_generated/api.js";
    import type { Id } from "../../../convex/_generated/dataModel.js";

    interface Project {
        _id: Id<"projects">;
        name: string;
        instagramUrl?: string;
        instagramHandle?: string;
        profilePictureUrl?: string;
        profilePictureStorageUrl?: string | null;
        logoStorageUrl?: string | null;
        platform?: string;
        accountDescription?: string;
        brandTraits?: string[];
        additionalContext?: string;
        brandKit?: BrandKitState;
        isFetching?: boolean;
        bio?: string;
        instagramContentDigest?: {
            recentThemes: string[];
            recentHooks: string[];
            avoidNext: string[];
            summaryForModel: string;
            postsAnalyzed: number;
            updatedAt: number;
        };
        lastInstagramSyncAt?: number;
        lastInstagramSyncMode?: "intel_only" | "full";
    }

    interface Props {
        projectId: Id<"projects">;
        project: Project;
    }

    let { projectId, project }: Props = $props();

    const client = useConvexClient();

    let name = $state("");
    let instagramUrl = $state("");
    let platform = $state("instagram");
    let brandKit = $state<BrandKitState>(emptyBrandKit());

    let formInitialized = $state(false);

    let profilePictureInputEl = $state<HTMLInputElement | null>(null);
    let isUploadingProfilePicture = $state(false);

    let isSaving = $state(false);
    let saveError = $state<string | null>(null);
    let saveSuccess = $state(false);

    let isAnalyzing = $state(false);
    let analyzeError = $state<string | null>(null);

    let websiteIngestUrl = $state("");
    let isIngestingSite = $state(false);
    let ingestSiteError = $state<string | null>(null);

    /** null | which sync is in flight */
    let igSyncBusy = $state<null | "intel_only" | "full">(null);
    let syncIgError = $state<string | null>(null);
    let syncIgSuccess = $state<string | null>(null);

    const igCaptureDone = $derived(typeof project?.lastInstagramSyncAt === "number");

    function seedBrandKitFromProject(p: Project): BrandKitState {
        const k: BrandKitState = { ...emptyBrandKit(), ...(p.brandKit ?? {}) };
        if (!k.elevatorPitch?.trim() && p.accountDescription?.trim()) {
            k.elevatorPitch = p.accountDescription.trim();
        }
        if (!k.toneAdjectives?.length && p.brandTraits?.length) {
            k.toneAdjectives = [...p.brandTraits];
        }
        if (!k.writingRules?.trim() && p.additionalContext?.trim()) {
            k.writingRules = p.additionalContext.trim();
        }
        return k;
    }

    $effect(() => {
        if (project && !formInitialized) {
            name = project.name ?? "";
            instagramUrl = project.instagramUrl ?? "";
            platform = project.platform ?? "instagram";
            brandKit = seedBrandKitFromProject(project);
            formInitialized = true;
        }
    });

    $effect(() => {
        if (projectId) {
            formInitialized = false;
        }
    });

    async function handleProfilePictureSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file || !file.type.startsWith("image/")) return;

        isUploadingProfilePicture = true;
        try {
            const uploadUrl = await client.mutation(api.contextImages.generateUploadUrl, {});

            const response = await fetch(uploadUrl, {
                method: "POST",
                headers: { "Content-Type": file.type },
                body: file,
            });

            if (!response.ok) {
                throw new Error("Falha ao fazer upload da imagem");
            }

            const { storageId } = await response.json();

            await client.mutation(api.projects.updateProfilePictureStorage, {
                projectId,
                storageId: storageId as Id<"_storage">,
            });
        } catch (err) {
            console.error("Profile picture upload failed:", err);
            saveError = err instanceof Error ? err.message : "Erro ao fazer upload da imagem";
        } finally {
            isUploadingProfilePicture = false;
            input.value = "";
        }
    }

    function cleanBrandKit(kit: BrandKitState): BrandKitState {
        return Object.fromEntries(
            Object.entries(kit).filter(([, v]) => {
                if (v === undefined || v === null) return false;
                if (typeof v === "string" && !v.trim()) return false;
                if (Array.isArray(v) && v.length === 0) return false;
                return true;
            })
        ) as BrandKitState;
    }

    let hasChanges = $derived(
        project &&
            (name !== project.name ||
                instagramUrl !== (project.instagramUrl ?? "") ||
                platform !== (project.platform ?? "instagram") ||
                JSON.stringify(brandKit) !== JSON.stringify(seedBrandKitFromProject(project)))
    );

    async function handleSave() {
        if (!hasChanges || isSaving) return;

        isSaving = true;
        saveError = null;
        saveSuccess = false;

        try {
            const kit = cleanBrandKit(brandKit);
            const legacyDesc = kit.elevatorPitch?.trim() ?? "";
            const legacyTraits = kit.toneAdjectives?.length ? kit.toneAdjectives : [];
            const legacyExtra =
                [kit.writingRules, kit.competitorsNotes, kit.imageryGuidelines]
                    .filter((x) => x && String(x).trim())
                    .join("\n\n") ?? "";

            await client.mutation(api.projects.update, {
                projectId,
                name: name.trim(),
                instagramUrl: instagramUrl.trim(),
                platform,
                accountDescription: legacyDesc,
                brandTraits: legacyTraits,
                additionalContext: legacyExtra,
                brandKit: Object.keys(kit).length > 0 ? kit : emptyBrandKit(),
                brandKitStrategy: "replace",
            });
            saveSuccess = true;
            setTimeout(() => (saveSuccess = false), 3000);
        } catch (err) {
            console.error("Failed to save:", err);
            saveError = err instanceof Error ? err.message : "Erro ao salvar alteracoes";
        } finally {
            isSaving = false;
        }
    }

    function getProfilePicture(): string | null {
        if (!project) return null;
        return project.profilePictureStorageUrl ?? project.profilePictureUrl ?? null;
    }

    async function handleAutoFill() {
        if (isAnalyzing) return;

        isAnalyzing = true;
        analyzeError = null;

        try {
            const result = await client.action(api.ai.profileAnalysis.analyzeProfileForConfig, {
                projectId,
            });
            brandKit = mergeBrandSuggestion(brandKit, {
                elevatorPitch: result.accountDescription,
                toneAdjectives: result.brandTraits,
                writingRules: result.additionalContext,
            });
        } catch (err) {
            console.error("Profile analysis failed:", err);
            analyzeError = err instanceof Error ? err.message : "Erro ao analisar perfil";
        } finally {
            isAnalyzing = false;
        }
    }

    async function handleWebsiteIngest() {
        if (!websiteIngestUrl.trim()) {
            ingestSiteError = "Cole a URL do site.";
            return;
        }
        ingestSiteError = null;
        isIngestingSite = true;
        try {
            const res = await client.action(api.ai.brandOnboarding.ingestWebsiteForBrand, {
                projectId,
                url: websiteIngestUrl.trim(),
            });
            brandKit = mergeBrandSuggestion(brandKit, res.suggestion as Record<string, unknown>);
        } catch (e) {
            ingestSiteError = e instanceof Error ? e.message : "Falha ao analisar o site";
        } finally {
            isIngestingSite = false;
        }
    }

    function formatIgCapture(ts: number): string {
        return new Date(ts).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    async function handleInstagramIntelCapture() {
        const url = instagramUrl.trim();
        if (!url) {
            syncIgError = "Informe a URL do Instagram acima.";
            return;
        }
        syncIgError = null;
        syncIgSuccess = null;
        igSyncBusy = "intel_only";
        try {
            await client.action(api.instagram.fetchProfile, {
                projectId,
                instagramUrl: url,
                syncMode: "intel_only",
                resultsLimit: 30,
            });
            syncIgSuccess =
                "Captura leve concluída. A memória do feed aparece na página do projeto; a Vanda usa isso nas ideias de posts.";
        } catch (e) {
            syncIgError = e instanceof Error ? e.message : "Falha ao capturar o Instagram";
        } finally {
            igSyncBusy = null;
        }
    }

    async function handleInstagramFullSync() {
        const url = instagramUrl.trim();
        if (!url) {
            syncIgError = "Informe a URL do Instagram acima.";
            return;
        }
        syncIgError = null;
        syncIgSuccess = null;
        igSyncBusy = "full";
        try {
            await client.action(api.instagram.fetchProfile, {
                projectId,
                instagramUrl: url,
                syncMode: "full",
                resultsLimit: 200,
            });
            syncIgSuccess =
                "Sincronização completa: mídias salvas na Vanda para galeria e compositor. Memória do feed também foi atualizada.";
        } catch (e) {
            syncIgError = e instanceof Error ? e.message : "Falha ao sincronizar Instagram";
        } finally {
            igSyncBusy = null;
        }
    }
</script>

<div class="space-y-8">
    <div class="flex items-center gap-4">
        <input
            bind:this={profilePictureInputEl}
            type="file"
            accept="image/*"
            class="hidden"
            onchange={handleProfilePictureSelect}
        />
        <button
            type="button"
            class="group relative h-16 w-16 overflow-hidden rounded-full border-2 border-border bg-muted transition-all hover:border-primary"
            onclick={() => profilePictureInputEl?.click()}
            disabled={isUploadingProfilePicture}
        >
            {#if isUploadingProfilePicture}
                <div class="flex h-full w-full items-center justify-center bg-muted">
                    <svg class="h-6 w-6 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
            {:else if getProfilePicture()}
                <img
                    src={getProfilePicture()}
                    alt={project.name}
                    class="h-full w-full object-cover"
                />
                <div class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <svg class="h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                    </svg>
                </div>
            {:else}
                <div class="flex h-full w-full items-center justify-center text-2xl font-semibold text-muted-foreground group-hover:text-primary">
                    {project.name.charAt(0).toUpperCase()}
                </div>
                <div class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <svg class="h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                    </svg>
                </div>
            {/if}
        </button>
        <div>
            <h1 class="text-2xl font-bold">Configurações do Projeto</h1>
            <p class="text-muted-foreground">Marca, Instagram e contexto para a IA</p>
        </div>
    </div>

    {#if brandKit.elevatorPitch || brandKit.primaryColors?.length || brandKit.toneAdjectives?.length}
        <BrandSummaryCard {brandKit} compact={true} logoUrl={project.logoStorageUrl ?? project.profilePictureStorageUrl ?? project.profilePictureUrl ?? null} />
    {/if}

    <section class="border border-border bg-card p-6">
        <h2 class="mb-4 text-lg font-semibold">Informações básicas</h2>
        <div class="space-y-4">
            <div class="space-y-2">
                <Label for="name" class="text-sm font-medium">Nome do Projeto</Label>
                <Input
                    id="name"
                    bind:value={name}
                    placeholder="Ex: Minha Loja, Blog Pessoal..."
                    class="bg-background"
                />
            </div>

            <PlatformSelector value={platform} onchange={(p) => (platform = p)} />

            <div class="space-y-3 rounded-none border border-border/80 bg-muted/10 p-4">
                <div class="space-y-2">
                    <Label for="instagram-url" class="text-sm font-medium">URL do Instagram (opcional)</Label>
                    <Input
                        id="instagram-url"
                        bind:value={instagramUrl}
                        placeholder="https://instagram.com/seu_perfil"
                        class="bg-background"
                    />
                </div>

                <p class="text-xs leading-relaxed text-muted-foreground">
                    Cada captura usa o Apify (custo por execução, frequentemente na faixa de <span class="text-foreground/80">~US$0,50</span> conforme seu plano). Por enquanto só é possível
                    <strong class="font-medium text-foreground/90">uma captura por projeto</strong> — nova atualização do feed entra em uma versão futura.
                </p>

                {#if igCaptureDone && project?.lastInstagramSyncAt}
                    <div class="border border-border/60 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                        <span class="font-medium text-foreground/85">Captura já realizada</span>
                        em {formatIgCapture(project.lastInstagramSyncAt)}
                        {#if project.lastInstagramSyncMode === "intel_only"}
                            <span class="text-muted-foreground"> · modo leve</span>
                        {:else if project.lastInstagramSyncMode === "full"}
                            <span class="text-muted-foreground"> · modo completo</span>
                        {/if}
                    </div>
                {/if}

                {#if syncIgError}
                    <p class="text-xs text-destructive">{syncIgError}</p>
                {/if}
                {#if syncIgSuccess}
                    <p class="text-xs text-green-700 dark:text-green-400">{syncIgSuccess}</p>
                {/if}

                <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={igCaptureDone || igSyncBusy !== null || !instagramUrl.trim() || project?.isFetching}
                        onclick={handleInstagramIntelCapture}
                    >
                        {#if igSyncBusy === "intel_only"}
                            Capturando contexto…
                        {:else}
                            Capturar contexto do feed (recomendado)
                        {/if}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={igCaptureDone || igSyncBusy !== null || !instagramUrl.trim() || project?.isFetching}
                        onclick={handleInstagramFullSync}
                    >
                        {#if igSyncBusy === "full"}
                            Sincronizando mídias…
                        {:else}
                            Sincronização completa (galeria)
                        {/if}
                    </Button>
                </div>
                <p class="text-[11px] leading-relaxed text-muted-foreground/85">
                    <strong class="text-foreground/80">Leve:</strong> últimas 30 postagens, só legendas e links — sem baixar imagens na Vanda. Ideal para memória do feed e ideias com a IA.
                    <span class="mt-1 block">
                        <strong class="text-foreground/80">Completa:</strong> até 200 posts com mídias na Vanda para galeria e compositor (mais tempo e armazenamento).
                    </span>
                </p>
            </div>
        </div>
    </section>

    <section class="border border-border bg-card p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-semibold">Site da marca</h2>
        </div>
        <p class="mb-4 text-sm text-muted-foreground">
            A Vanda lê a página (texto e meta) e sugere cores, tom e posicionamento. Revise antes de salvar.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
            <Input
                class="flex-1 bg-background"
                bind:value={websiteIngestUrl}
                placeholder="https://seusite.com"
            />
            <Button
                type="button"
                variant="outline"
                disabled={isIngestingSite}
                onclick={handleWebsiteIngest}
            >
                {isIngestingSite ? "Analisando…" : "Analisar site"}
            </Button>
        </div>
        {#if ingestSiteError}
            <p class="mt-2 text-sm text-destructive">{ingestSiteError}</p>
        {/if}
    </section>

    <section class="border border-border bg-card p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-semibold">Kit de marca</h2>
            <Button
                variant="outline"
                size="sm"
                onclick={handleAutoFill}
                disabled={isAnalyzing || project?.isFetching}
            >
                {#if isAnalyzing}
                    Analisando…
                {:else}
                    Preencher a partir do Instagram
                {/if}
            </Button>
        </div>
        {#if analyzeError}
            <div class="mb-4 border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {analyzeError}
            </div>
        {/if}
        <BrandKitEditor
            bind:brandKit
            projectName={name.trim() || project.name}
            {projectId}
            draftExtra=""
        />

        <Separator class="my-8" />

        <h3 class="mb-3 text-sm font-medium">Imagens de referência</h3>
        <ContextImageUploader {projectId} />
    </section>

    <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
            {#if saveError}
                <p class="text-sm text-destructive">{saveError}</p>
            {/if}
            {#if saveSuccess}
                <p class="flex items-center gap-1 text-sm text-green-600">
                    <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Alteracoes salvas
                </p>
            {/if}
        </div>
        <Button onclick={handleSave} disabled={!hasChanges || isSaving}>
            {#if isSaving}
                <svg class="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Salvando...
            {:else}
                Salvar Alterações
            {/if}
        </Button>
    </div>
</div>

<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import { untrack } from "svelte";
    import { cn } from "$lib/utils";
    import { Button, Input, Label, Textarea } from "$lib/components/ui";
    import {
        WizardShell,
        ChipSelect,
        VibeCard,
        VandaSuggestButton,
        BrandSummaryCard,
    } from "$lib/components/wizard";
    import {
        emptyBrandKit,
        mergeBrandSuggestion,
        brandKitToDraftSummary,
        type BrandKitState,
    } from "$lib/types/brandKit";
    import { BRAND_VIBES, getVibeByKey, type VibeKey } from "$lib/data/brandVibes";
    import { AUDIENCE_OPTIONS, TONE_OPTIONS } from "$lib/data/wizardOptions";
    import { useConvexClient } from "convex-svelte";
    import { api } from "../../../../convex/_generated/api.js";
    import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
    import { normalizeInstagramInput } from "$lib/utils/instagram";
    import { formatUserFacingMessage } from "$lib/errors";
    import { Instagram, Sparkles, X, ArrowLeft } from "lucide-svelte";

    const client = useConvexClient();

    // ── URL-bound step & path ──────────────────────────────────────────
    type Path = "existing" | "new" | null;

    let step = $derived(parseInt($page.url.searchParams.get("step") ?? "0", 10));
    let path = $derived<Path>(($page.url.searchParams.get("path") as Path) ?? null);

    let totalSteps = $derived(path === "existing" ? 3 : 6);
    let isSummaryStep = $derived(step === totalSteps - 1 && path !== null);

    function wizardUrl(s: number, p: Path = path): string {
        const params = new URLSearchParams();
        if (p) params.set("path", p);
        if (s > 0) params.set("step", String(s));
        const qs = params.toString();
        return `/projects/new${qs ? `?${qs}` : ""}`;
    }

    function pushStep(s: number, p?: Path) {
        goto(wizardUrl(s, p ?? path), { keepFocus: true, noScroll: true });
    }

    function replaceStep(s: number, p?: Path) {
        goto(wizardUrl(s, p ?? path), { keepFocus: true, noScroll: true, replaceState: true });
    }

    // ── Form state (persists in memory across URL navigation) ──────────
    let projectName = $state("");
    let pitchText = $state("");
    let instagramHandleInput = $state("");
    let selectedAudience = $state<string[]>([]);
    let customAudience = $state("");
    let selectedVibe = $state<VibeKey | null>(null);
    let selectedTone = $state<string[]>([]);
    let customTones = $state<string[]>([]);
    let brandKit = $state<BrandKitState>(emptyBrandKit());
    let ingestedLogoUrl = $state<string | null>(null);
    let ingestedLogoStorageId = $state<string | null>(null);

    // ── Loading states ─────────────────────────────────────────────────
    let isIngesting = $state(false);
    let isCreating = $state(false);
    let createStatus = $state("");
    let isAutoFilling = $state(false);
    let autoFillDone = $state(false);
    let error = $state<string | null>(null);
    let ingestWarnings = $state<string[]>([]);
    let ingestStatus = $state("");

    // ── Derived ────────────────────────────────────────────────────────
    let audienceLabel = $derived.by(() => {
        const labels = selectedAudience.map((id) => {
            const opt = AUDIENCE_OPTIONS.find((o) => o.id === id);
            return opt?.label ?? id;
        });
        if (customAudience.trim()) labels.push(customAudience.trim());
        return labels.join(", ");
    });

    let vibeLabel = $derived(selectedVibe ? (getVibeByKey(selectedVibe)?.label ?? null) : null);

    let draftSummary = $derived(brandKitToDraftSummary(projectName || "Projeto", brandKit));

    let allToneLabels = $derived.by(() => {
        const preset = selectedTone.map((id) => {
            const opt = TONE_OPTIONS.find((o) => o.id === id);
            return opt?.label ?? id;
        });
        return [...preset, ...customTones];
    });

    let brandGlowColor = $derived(brandKit.primaryColors?.[0] ?? null);

    // ── Sync wizard inputs → brandKit (using untrack to avoid loops) ──
    $effect(() => {
        const audience = audienceLabel;
        if (audience) {
            brandKit = { ...untrack(() => brandKit), whoWeServe: audience };
        }
    });

    $effect(() => {
        const labels = allToneLabels;
        if (labels.length > 0) {
            brandKit = { ...untrack(() => brandKit), toneAdjectives: labels };
        }
    });

    $effect(() => {
        if (pitchText.trim()) {
            brandKit = { ...untrack(() => brandKit), elevatorPitch: pitchText.trim() };
        }
    });

    // ── Auto-fill on summary arrival ───────────────────────────────────
    $effect(() => {
        if (isSummaryStep && !autoFillDone && !isAutoFilling) {
            runAutoFill();
        }
    });

    // ── Navigation ─────────────────────────────────────────────────────
    function next() {
        error = null;
        if (step === 0) {
            if (!path) { error = "Escolha uma opção."; return; }
            if (path === "existing") {
                void startInstagramProject();
                return;
            }
            pushStep(1);
            return;
        }
        if (path === "existing" && step === 1) {
            if (!projectName.trim()) { error = "Dê um nome ao projeto."; return; }
            if (!normalizeInstagramInput(instagramHandleInput)) {
                error = "Informe o @ do Instagram da marca.";
                return;
            }
            handleExistingBrandIngest();
            return;
        }
        if (path === "new" && step === 1) {
            if (!projectName.trim()) { error = "Dê um nome ao projeto."; return; }
        }
        if (step < totalSteps - 1) {
            pushStep(step + 1);
        }
    }

    async function startInstagramProject() {
        if (isCreating) return;
        error = null;
        isCreating = true;
        createStatus = "Preparando conexão com Instagram…";
        try {
            const id = await client.mutation(api.projects.create, {
                name: "Projeto do Instagram",
                onboardingStatus: "draft",
                onboardingPath: "existing",
                accountDescription: "Projeto criado para conectar e analisar uma marca no Instagram.",
            });
            goto(`/integrations/instagram/connect?projectId=${id}`);
        } catch (e) {
            error = formatUserFacingMessage(e);
            isCreating = false;
            createStatus = "";
        }
    }

    function back() {
        error = null;
        if (step > 0) {
            history.back();
        }
    }

    function goToStep(s: number) {
        error = null;
        pushStep(s);
    }

    // ── Existing brand: scrape links ───────────────────────────────────
    async function handleExistingBrandIngest() {
        error = null;
        ingestWarnings = [];
        isIngesting = true;

        try {
            const igUrl = normalizeInstagramInput(instagramHandleInput);
            ingestStatus = "Analisando perfil do Instagram…";
            const res = await client.action(api.ai.brandOnboarding.ingestInstagramForBrand, {
                instagramUrl: igUrl,
            });
            brandKit = mergeBrandSuggestion(untrack(() => brandKit), res.suggestion as Record<string, unknown>);
            ingestWarnings = [...ingestWarnings, ...res.warnings];

            ingestStatus = "Montando identidade…";
            await new Promise((r) => setTimeout(r, 400));

            pushStep(totalSteps - 1);
        } catch (e) {
            error = formatUserFacingMessage(e);
        } finally {
            isIngesting = false;
            ingestStatus = "";
        }
    }

    // ── Auto-fill remaining gaps on summary arrival ────────────────────
    async function runAutoFill() {
        const kit = untrack(() => brandKit);
        const desc = kit.elevatorPitch || pitchText.trim();
        if (!desc) {
            autoFillDone = true;
            return;
        }

        isAutoFilling = true;
        try {
            let description = untrack(() => draftSummary);

            const vibe = untrack(() => selectedVibe);
            if (vibe) {
                const vibeData = getVibeByKey(vibe);
                if (vibeData) {
                    description += `\nEstilo visual: ${vibeData.prompt}`;
                }
            }

            const aiArgs: {
                description: string;
                audienceHint?: string;
            } = { description };
            const al = untrack(() => audienceLabel);
            if (al) aiArgs.audienceHint = al;

            const res = await client.action(
                api.ai.brandOnboarding.suggestBrandKitFromDescription,
                aiArgs
            );
            brandKit = mergeBrandSuggestion(untrack(() => brandKit), res as Record<string, unknown>);
        } catch (e) {
            console.error("Auto-fill failed:", e);
        } finally {
            isAutoFilling = false;
            autoFillDone = true;
        }
    }

    // ── Create project ─────────────────────────────────────────────────
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

    async function handleCreate() {
        if (!projectName.trim()) { error = "Nome do projeto é obrigatório."; return; }
        error = null;
        isCreating = true;
        createStatus = "Criando projeto…";
        try {
            const kit = cleanBrandKit(brandKit);
            const legacyDesc = kit.elevatorPitch?.trim() || pitchText.trim().slice(0, 2000) || undefined;
            const legacyTraits = kit.toneAdjectives?.length ? kit.toneAdjectives : undefined;
            const legacyExtra = [kit.writingRules, kit.competitorsNotes, kit.imageryGuidelines]
                .filter((x) => x && String(x).trim())
                .join("\n\n");

            const createArgs: {
                name: string;
                onboardingStatus: "complete";
                brandKit?: BrandKitState;
                onboardingPath?: "existing" | "new";
                accountDescription?: string;
                brandTraits?: string[];
                additionalContext?: string;
                instagramUrl?: string;
            } = {
                name: projectName.trim(),
                onboardingStatus: "complete",
            };
            if (ingestedLogoStorageId) {
                (kit as Record<string, unknown>).logoStorageId = ingestedLogoStorageId;
            }
            if (Object.keys(kit).length > 0) createArgs.brandKit = kit;
            createArgs.onboardingPath = path === "existing" ? "existing" : "new";
            if (legacyDesc) createArgs.accountDescription = legacyDesc;
            if (legacyTraits) createArgs.brandTraits = legacyTraits;
            const le = legacyExtra.trim();
            if (le) createArgs.additionalContext = le;
            const ig = normalizeInstagramInput(instagramHandleInput);
            if (ig) createArgs.instagramUrl = ig;

            const id = await client.mutation(api.projects.create, createArgs);

            goto(`/projects/${id}`);
        } catch (e) {
            error = formatUserFacingMessage(e);
        } finally {
            isCreating = false;
            createStatus = "";
        }
    }

    // ── Inline brand kit update from summary card ──────────────────────
    function handleBrandKitUpdate(updated: BrandKitState) {
        brandKit = updated;
    }

    // ── Step metadata ──────────────────────────────────────────────────
    function getStepTitle(): string {
        if (step === 0) return "Como quer conectar?";
        if (isSummaryStep) {
            if (!isAutoFilling) return "Pronto. Sua marca.";
            return path === "existing" ? "Analisando sua marca…" : "Montando sua marca…";
        }
        if (path === "existing") return "Instagram da marca";
        const newTitles = ["", "O que você faz?", "Para quem?", "Qual é a vibe?", "Como sua marca fala?"];
        return newTitles[step] ?? "";
    }

    function getStepSubtitle(): string {
        if (step === 0) return "Escolha o caminho que faz mais sentido para você.";
        if (isSummaryStep) {
            if (!isAutoFilling) return "Revise sua marca. Você pode editar tudo depois.";
            return path === "existing"
                ? "A Vanda está analisando sua presença digital e organizando o perfil da marca."
                : "A Vanda está criando sua identidade visual e estratégia de marca.";
        }
        if (path === "existing") return "Informe o nome e o @ do Instagram. A Vanda analisa até 30 posts e monta o kit.";
        const newSubs = [
            "",
            "Dê um nome e descreva sua marca em uma ou duas frases.",
            "Quem é o público da sua marca? Selecione quantos fizerem sentido.",
            "Escolha o estilo visual que mais combina com sua marca.",
            "Selecione os traços que definem o tom de voz da sua marca.",
        ];
        return newSubs[step] ?? "";
    }

    function shouldShowNext(): boolean {
        if (isSummaryStep) return false;
        if (path === "existing" && step === 1 && isIngesting) return false;
        return true;
    }

    function getNextLabel(): string {
        if (step === 0 && path === "existing") {
            return isCreating ? (createStatus || "Conectando…") : "Conectar Instagram";
        }
        if (path === "existing" && step === 1) return "Vanda analisa";
        return "Continuar";
    }

    function isNextDisabled(): boolean {
        if (step === 0 && !path) return true;
        if (step === 0 && isCreating) return true;
        if (path === "existing" && step === 1 && (!projectName.trim() || !normalizeInstagramInput(instagramHandleInput)))
            return true;
        if (path === "new" && step === 1 && !projectName.trim()) return true;
        return false;
    }
</script>

<svelte:head>
    <title>Novo projeto - Vanda Studio</title>
</svelte:head>

<!-- Immersive full-screen layout — no Navbar -->
<div
    class="wizard-stage flex min-h-screen flex-col"
    style={brandGlowColor && isSummaryStep ? `--brand-glow: ${brandGlowColor}` : ""}
    class:has-brand-glow={brandGlowColor && isSummaryStep && autoFillDone}
>
    <!-- Floating escape button -->
    <div class="fixed left-5 top-5 z-50">
        <button
            type="button"
            class="group flex items-center gap-2 text-muted-foreground/60 transition-colors hover:text-foreground"
            onclick={() => goto("/projects")}
        >
            {#if step === 0}
                <ArrowLeft class="h-4 w-4" />
                <span class="text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">Projetos</span>
            {:else}
                <X class="h-4 w-4" />
                <span class="text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">Sair</span>
            {/if}
        </button>
    </div>

    <main class={cn(
        "relative z-10 mx-auto w-full flex-1 px-6",
        isSummaryStep ? "max-w-6xl py-6" : "max-w-2xl py-16",
        "transition-all duration-500"
    )}>
        <SignedOut>
            <div class="flex flex-col items-center gap-4 py-16 text-center">
                <h1 class="text-xl font-semibold">Entre para criar um projeto</h1>
                <SignInButton mode="modal">
                    <button class="h-9 bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                        Entrar
                    </button>
                </SignInButton>
            </div>
        </SignedOut>

        <SignedIn>
            {#if error}
                <div class="mb-6 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            {/if}

            {#if isSummaryStep}
                {#if isCreating}
                    <!-- Same pattern as the existing-brand analysis step. -->
                    <div class="flex flex-col items-center gap-6 py-16">
                        <div class="pulse-glow flex h-12 w-12 items-center justify-center text-primary">
                            <Sparkles class="h-8 w-8" />
                        </div>
                        <p class="max-w-md text-center text-sm text-muted-foreground animate-pulse">
                            {createStatus || "Criando…"}
                        </p>
                        <div class="h-1 w-48 overflow-hidden bg-border">
                            <div class="h-full w-1/2 animate-[indeterminate_1.5s_ease-in-out_infinite] bg-primary"></div>
                        </div>
                    </div>
                {:else}
                <!-- ═══ Summary — breaks out of WizardShell for wide layout ═══ -->
                <div class="summary-container" class:revealed={autoFillDone && !isAutoFilling}>
                    <!-- Summary header -->
                    <div class="mb-8 flex items-end justify-between gap-4 summary-header">
                        <div>
                            <p class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-2">
                                {step + 1} / {totalSteps}
                            </p>
                            <h1 class="text-3xl font-semibold tracking-tight">
                                {isAutoFilling
                                    ? (path === "existing" ? "Analisando sua marca…" : "Montando sua marca…")
                                    : "Pronto. Sua marca."}
                            </h1>
                            <p class="mt-2 text-sm text-muted-foreground">
                                {isAutoFilling
                                    ? (path === "existing"
                                        ? "A Vanda está analisando sua presença digital e organizando o perfil da marca."
                                        : "A Vanda está criando sua identidade visual e estratégia de marca.")
                                    : "Clique no ícone de edição em qualquer seção para ajustar."}
                            </p>
                        </div>
                    </div>

                    <!-- Brand board -->
                    <div class="brand-reveal" class:visible={true}>
                        <BrandSummaryCard
                            {brandKit}
                            brandName={projectName}
                            logoUrl={ingestedLogoUrl}
                            {audienceLabel}
                            {vibeLabel}
                            onupdate={handleBrandKitUpdate}
                            loading={isAutoFilling}
                            existingBrand={path === "existing"}
                        />
                    </div>

                    <!-- Actions -->
                    {#if !isAutoFilling && autoFillDone}
                        <div class="mt-8 flex items-center justify-between gap-3 reveal-actions">
                            <VandaSuggestButton
                                loading={isAutoFilling}
                                onclick={async () => { autoFillDone = false; await runAutoFill(); }}
                                label="Refinar com a Vanda"
                            />
                            <div class="flex gap-3">
                                <Button variant="outline" onclick={back}>Voltar</Button>
                                <Button onclick={handleCreate} disabled={isCreating}>
                                    {isCreating
                                        ? path === "existing"
                                            ? "Criando projeto e sincronizando Instagram…"
                                            : "Criando…"
                                        : "Criar projeto"}
                                </Button>
                            </div>
                        </div>
                    {/if}
                </div>
                {/if}
            {:else}
                <!-- ═══ Wizard steps — centered, focused ═══ -->
                <WizardShell
                    {step}
                    {totalSteps}
                    title={getStepTitle()}
                    subtitle={getStepSubtitle()}
                    onback={step > 0 ? back : undefined}
                    onnext={shouldShowNext() ? next : undefined}
                    nextLabel={getNextLabel()}
                    nextDisabled={isNextDisabled()}
                    showBack={step > 0 && !isIngesting}
                >
                    {#snippet children()}

                        <!-- ═══ Step 0: Fork ═══ -->
                        {#if step === 0}
                            <div class="grid gap-4 sm:grid-cols-2">
                                <button
                                    type="button"
                                    class="card-glow flex flex-col gap-3 border p-6 text-left transition-all {path === 'existing'
                                        ? 'gradient-border border-transparent ring-1 ring-primary'
                                        : 'border-border bg-card hover:border-muted-foreground/40'}"
                                    onclick={() => replaceStep(0, "existing")}
                                >
                                    <div class="flex items-center gap-2 text-primary">
                                        <Instagram class="h-5 w-5" />
                                    </div>
                                    <h3 class="text-base font-semibold">Já tenho uma marca</h3>
                                    <p class="text-sm text-muted-foreground">
                                        Conecte o Instagram e a Vanda importa posts, métricas e gera a primeira estratégia.
                                    </p>
                                </button>

                                <button
                                    type="button"
                                    class="card-glow flex flex-col gap-3 border p-6 text-left transition-all {path === 'new'
                                        ? 'gradient-border border-transparent ring-1 ring-primary'
                                        : 'border-border bg-card hover:border-muted-foreground/40'}"
                                    onclick={() => replaceStep(0, "new")}
                                >
                                    <div class="flex items-center gap-2 text-primary">
                                        <Sparkles class="h-5 w-5" />
                                    </div>
                                    <h3 class="text-base font-semibold">Quero criar do zero</h3>
                                    <p class="text-sm text-muted-foreground">
                                        Responda algumas perguntas rápidas e a Vanda monta sua identidade.
                                    </p>
                                </button>
                            </div>

                        <!-- ═══ Existing path — Step 1: Links ═══ -->
                        {:else if path === "existing" && step === 1}
                            {#if isIngesting}
                                <div class="flex flex-col items-center gap-6 py-12">
                                    <div class="pulse-glow flex h-12 w-12 items-center justify-center text-primary">
                                        <Sparkles class="h-8 w-8" />
                                    </div>
                                    <p class="text-sm text-muted-foreground animate-pulse">{ingestStatus || "Analisando…"}</p>
                                    <div class="h-1 w-48 overflow-hidden bg-border">
                                        <div class="h-full w-1/2 animate-[indeterminate_1.5s_ease-in-out_infinite] bg-primary"></div>
                                    </div>
                                    {#if ingestWarnings.length > 0}
                                        <ul class="list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
                                            {#each ingestWarnings as w}
                                                <li>{w}</li>
                                            {/each}
                                        </ul>
                                    {/if}
                                </div>
                            {:else}
                                <div class="space-y-6">
                                    <div class="space-y-2">
                                        <Label for="pname">Nome do projeto</Label>
                                        <Input
                                            id="pname"
                                            class="bg-background"
                                            bind:value={projectName}
                                            placeholder="Ex: Studio Aurora"
                                        />
                                    </div>
                                    <div class="space-y-2">
                                        <Label for="ig">Instagram</Label>
                                        <Input
                                            id="ig"
                                            class="bg-background"
                                            bind:value={instagramHandleInput}
                                            placeholder="@sua_conta"
                                            autocomplete="off"
                                        />
                                        <p class="text-xs text-muted-foreground">Só o @ — até 30 posts são usados na análise.</p>
                                    </div>
                                </div>
                            {/if}

                        <!-- ═══ New path — Step 1: Identity ═══ -->
                        {:else if path === "new" && step === 1}
                            <div class="space-y-6">
                                <div class="space-y-2">
                                    <Label for="pname">Nome do projeto</Label>
                                    <Input
                                        id="pname"
                                        class="bg-background"
                                        bind:value={projectName}
                                        placeholder="Ex: Studio Aurora"
                                    />
                                </div>
                                <div class="space-y-2">
                                    <Label for="pitch">Descreva sua marca em poucas palavras</Label>
                                    <Textarea
                                        id="pitch"
                                        class="min-h-[100px] resize-none bg-background"
                                        bind:value={pitchText}
                                        placeholder="Ex: Vendemos cosméticos naturais para mulheres 25-40 que buscam beleza consciente"
                                    />
                                </div>
                            </div>

                        <!-- ═══ New path — Step 2: Audience ═══ -->
                        {:else if path === "new" && step === 2}
                            <div class="space-y-4">
                                <ChipSelect
                                    options={AUDIENCE_OPTIONS}
                                    selected={selectedAudience}
                                    multiple={true}
                                    onchange={(s) => (selectedAudience = s)}
                                />
                                <div class="space-y-2">
                                    <Label for="custom-aud">Outro público (opcional)</Label>
                                    <Input
                                        id="custom-aud"
                                        class="bg-background"
                                        bind:value={customAudience}
                                        placeholder="Ex: Donas de pet shop"
                                    />
                                </div>
                            </div>

                        <!-- ═══ New path — Step 3: Vibe ═══ -->
                        {:else if path === "new" && step === 3}
                            <div class="space-y-3">
                                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {#each BRAND_VIBES as vibe (vibe.key)}
                                        <VibeCard
                                            label={vibe.label}
                                            sublabel={vibe.sublabel}
                                            swatchColors={vibe.swatchColors}
                                            active={selectedVibe === vibe.key}
                                            onclick={() => (selectedVibe = vibe.key)}
                                        />
                                    {/each}
                                </div>
                                <p class="text-xs text-muted-foreground">
                                    As cores exibidas são exemplos. A Vanda vai gerar uma paleta personalizada para sua marca.
                                </p>
                            </div>

                        <!-- ═══ New path — Step 4: Tone ═══ -->
                        {:else if path === "new" && step === 4}
                            <ChipSelect
                                options={TONE_OPTIONS}
                                selected={selectedTone}
                                multiple={true}
                                onchange={(s) => (selectedTone = s)}
                                allowCustom={true}
                                customValues={customTones}
                                oncustomchange={(v) => (customTones = v)}
                            />
                        {/if}

                    {/snippet}
                </WizardShell>
            {/if}
        </SignedIn>
    </main>
</div>

<style>
    @keyframes indeterminate {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(200%); }
    }

    .wizard-stage {
        position: relative;
        background: var(--background);
    }

    /* Brand-colored ambient glow on the summary step */
    .wizard-stage.has-brand-glow::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 0;
        opacity: 0;
        animation: glowFadeIn 1.5s ease 0.3s forwards;
        background:
            radial-gradient(
                ellipse 70% 50% at 50% -10%,
                color-mix(in oklch, var(--brand-glow) 18%, transparent) 0%,
                transparent 70%
            ),
            radial-gradient(
                ellipse 40% 60% at 90% 50%,
                color-mix(in oklch, var(--brand-glow) 8%, transparent) 0%,
                transparent 60%
            ),
            radial-gradient(
                ellipse 40% 40% at 10% 80%,
                color-mix(in oklch, var(--brand-glow) 6%, transparent) 0%,
                transparent 50%
            );
    }

    @keyframes glowFadeIn {
        to { opacity: 1; }
    }

    .brand-reveal {
        opacity: 0;
        transform: translateY(12px);
        transition: opacity 0.6s ease, transform 0.6s ease;
    }
    .brand-reveal.visible {
        opacity: 1;
        transform: translateY(0);
    }

    .summary-header {
        animation: fadeDown 0.5s ease both;
    }

    .reveal-actions {
        animation: fadeUp 0.4s ease 0.3s both;
    }

    @keyframes fadeDown {
        from { opacity: 0; transform: translateY(-8px); }
        to { opacity: 1; transform: translateY(0); }
    }
    @keyframes fadeUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
    }
</style>

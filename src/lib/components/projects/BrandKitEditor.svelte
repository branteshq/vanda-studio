<script lang="ts">
    import { Button, Input, Label, Textarea } from "$lib/components/ui";
    import { useConvexClient } from "convex-svelte";
    import { api } from "../../../convex/_generated/api.js";
    import type { Id } from "../../../convex/_generated/dataModel.js";
    import {
        emptyBrandKit,
        type BrandKitState,
        mergeBrandSuggestion,
        brandKitToDraftSummary,
    } from "$lib/types/brandKit";
    import { formatUserFacingMessage } from "$lib/errors";

    interface Props {
        projectName: string;
        brandKit: BrandKitState;
        /** Set when editing an existing project (section AI uses DB context). */
        projectId?: Id<"projects">;
        /** Extra lines for draft-mode section AI (wizard). */
        draftExtra?: string;
        onchange?: (kit: BrandKitState) => void;
    }

    let {
        projectName,
        brandKit = $bindable(emptyBrandKit()),
        projectId,
        draftExtra = "",
        onchange,
    }: Props = $props();

    const client = useConvexClient();

    let sectionLoading = $state<"positioning" | "voice" | "visual" | null>(null);
    let sectionError = $state<string | null>(null);

    function emit() {
        onchange?.(brandKit);
    }

    function patch(p: Partial<BrandKitState>) {
        brandKit = { ...brandKit, ...p };
        emit();
    }

    let draftSummary = $derived(brandKitToDraftSummary(projectName, brandKit, draftExtra));

    async function runSectionAI(section: "positioning" | "voice" | "visual") {
        sectionError = null;
        sectionLoading = section;
        try {
            const result = await client.action(api.ai.brandOnboarding.suggestBrandSection, {
                ...(projectId ? { projectId } : { draftContext: draftSummary }),
                section,
            });
            brandKit = mergeBrandSuggestion(brandKit, result as Record<string, unknown>);
            emit();
        } catch (e) {
            sectionError = formatUserFacingMessage(e);
        } finally {
            sectionLoading = null;
        }
    }
</script>

<div class="space-y-8">
    {#if sectionError}
        <div class="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {sectionError}
        </div>
    {/if}

    <section class="space-y-4 border border-border bg-card p-6">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-base font-semibold">Posicionamento</h3>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sectionLoading !== null}
                onclick={() => runSectionAI("positioning")}
            >
                {#if sectionLoading === "positioning"}
                    …
                {:else}
                    Vanda preenche
                {/if}
            </Button>
        </div>
        <div class="space-y-2">
            <Label for="elevator">Pitch</Label>
            <Textarea
                id="elevator"
                class="min-h-[72px] resize-none bg-background"
                value={brandKit.elevatorPitch ?? ""}
                oninput={(e) => patch({ elevatorPitch: e.currentTarget.value })}
                placeholder="Em uma frase, o que a marca é"
            />
        </div>
        <div class="space-y-2">
            <Label for="whatWeSell">O que vende / oferece</Label>
            <Textarea
                id="whatWeSell"
                class="min-h-[72px] resize-none bg-background"
                value={brandKit.whatWeSell ?? ""}
                oninput={(e) => patch({ whatWeSell: e.currentTarget.value })}
            />
        </div>
        <div class="space-y-2">
            <Label for="whoWeServe">Público-alvo</Label>
            <Textarea
                id="whoWeServe"
                class="min-h-[72px] resize-none bg-background"
                value={brandKit.whoWeServe ?? ""}
                oninput={(e) => patch({ whoWeServe: e.currentTarget.value })}
            />
        </div>
        <div class="space-y-2">
            <Label for="diff">Diferenciais</Label>
            <Textarea
                id="diff"
                class="min-h-[64px] resize-none bg-background"
                value={brandKit.differentiators ?? ""}
                oninput={(e) => patch({ differentiators: e.currentTarget.value })}
            />
        </div>
        <div class="space-y-2">
            <Label for="comp">Concorrência / notas</Label>
            <Textarea
                id="comp"
                class="min-h-[64px] resize-none bg-background"
                value={brandKit.competitorsNotes ?? ""}
                oninput={(e) => patch({ competitorsNotes: e.currentTarget.value })}
            />
        </div>
    </section>

    <section class="space-y-4 border border-border bg-card p-6">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-base font-semibold">Voz e estilo</h3>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sectionLoading !== null}
                onclick={() => runSectionAI("voice")}
            >
                {#if sectionLoading === "voice"}
                    …
                {:else}
                    Vanda preenche
                {/if}
            </Button>
        </div>
        <div class="space-y-2">
            <Label for="tone">Tom (separado por vírgula)</Label>
            <Input
                id="tone"
                class="bg-background"
                value={(brandKit.toneAdjectives ?? []).join(", ")}
                oninput={(e) =>
                    patch({
                        toneAdjectives: e.currentTarget.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                    })}
            />
        </div>
        <div class="space-y-2">
            <Label for="rules">Regras de escrita</Label>
            <Textarea
                id="rules"
                class="min-h-[80px] resize-none bg-background"
                value={brandKit.writingRules ?? ""}
                oninput={(e) => patch({ writingRules: e.currentTarget.value })}
            />
        </div>
        <div class="space-y-2">
            <Label for="langs">Idiomas (separado por vírgula)</Label>
            <Input
                id="langs"
                class="bg-background"
                value={(brandKit.languages ?? []).join(", ")}
                oninput={(e) =>
                    patch({
                        languages: e.currentTarget.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                    })}
            />
        </div>
        <div class="space-y-2">
            <Label for="emoji">Política de emoji</Label>
            <Input
                id="emoji"
                class="bg-background"
                value={brandKit.emojiPolicy ?? ""}
                oninput={(e) => patch({ emojiPolicy: e.currentTarget.value })}
            />
        </div>
        <div class="space-y-2">
            <Label for="cta">Estilo de CTA</Label>
            <Input
                id="cta"
                class="bg-background"
                value={brandKit.ctaStyle ?? ""}
                oninput={(e) => patch({ ctaStyle: e.currentTarget.value })}
            />
        </div>
    </section>

    <section class="space-y-4 border border-border bg-card p-6">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-base font-semibold">Visual</h3>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sectionLoading !== null}
                onclick={() => runSectionAI("visual")}
            >
                {#if sectionLoading === "visual"}
                    …
                {:else}
                    Vanda preenche
                {/if}
            </Button>
        </div>
        <div class="space-y-2">
            <Label for="c1">Cores primárias (hex, separadas por vírgula)</Label>
            <Input
                id="c1"
                class="bg-background"
                value={(brandKit.primaryColors ?? []).join(", ")}
                oninput={(e) =>
                    patch({
                        primaryColors: e.currentTarget.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                    })}
            />
        </div>
        <div class="space-y-2">
            <Label for="c2">Cores secundárias (hex, separadas por vírgula)</Label>
            <Input
                id="c2"
                class="bg-background"
                value={(brandKit.secondaryColors ?? []).join(", ")}
                oninput={(e) =>
                    patch({
                        secondaryColors: e.currentTarget.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                    })}
            />
        </div>
        <div class="space-y-2">
            <Label for="tp">Tipografia principal</Label>
            <Input
                id="tp"
                class="bg-background"
                value={brandKit.typographyPrimary ?? ""}
                oninput={(e) => patch({ typographyPrimary: e.currentTarget.value })}
            />
        </div>
        <div class="space-y-2">
            <Label for="ts">Tipografia secundária</Label>
            <Input
                id="ts"
                class="bg-background"
                value={brandKit.typographySecondary ?? ""}
                oninput={(e) => patch({ typographySecondary: e.currentTarget.value })}
            />
        </div>
        <div class="space-y-2">
            <Label for="img">Diretrizes de imagem</Label>
            <Textarea
                id="img"
                class="min-h-[80px] resize-none bg-background"
                value={brandKit.imageryGuidelines ?? ""}
                oninput={(e) => patch({ imageryGuidelines: e.currentTarget.value })}
            />
        </div>
    </section>
</div>

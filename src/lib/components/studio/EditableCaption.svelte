<script lang="ts">
    import { useConvexClient } from "convex-svelte";
    import { api } from "../../../convex/_generated/api.js";
    import type { Id } from "../../../convex/_generated/dataModel.js";
    import { toast } from "svelte-sonner";
    import { showUserError } from "$lib/errors";
    import { Textarea, Button, Badge } from "$lib/components/ui";

    interface Props {
        postId: Id<"generated_posts">;
        caption: string;
        showHashtags?: boolean;
        showCharCount?: boolean;
        onupdate?: (newCaption: string) => void;
    }

    let { postId, caption, showHashtags = true, showCharCount = true, onupdate }: Props = $props();

    const client = useConvexClient();

    let isEditing = $state(false);
    let editedCaption = $state("");
    let isSaving = $state(false);

    // Display caption (current or being edited)
    let displayCaption = $derived(isEditing ? editedCaption : caption);

    // Extract hashtags from the display caption
    let hashtags = $derived(displayCaption.match(/#[\p{L}\p{N}_]+/gu) ?? []);


    function startEditing() {
        editedCaption = caption;
        isEditing = true;
    }

    function cancelEditing() {
        isEditing = false;
        editedCaption = "";
    }

    async function saveCaption() {
        if (isSaving) return;
        if (editedCaption === caption) {
            cancelEditing();
            return;
        }

        isSaving = true;
        try {
            await client.mutation(api.generatedPosts.updateCaption, {
                id: postId,
                caption: editedCaption,
            });
            toast.success("Legenda atualizada");
            onupdate?.(editedCaption);
            isEditing = false;
        } catch (err) {
            console.error("Failed to update caption:", err);
            showUserError(err);
        } finally {
            isSaving = false;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            cancelEditing();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            saveCaption();
        }
    }
</script>

{#if isEditing}
    <div class="space-y-3">
        <Textarea
            bind:value={editedCaption}
            onkeydown={handleKeydown}
            class="min-h-[160px] resize-none bg-background text-sm"
            placeholder="Digite a legenda..."
            autofocus
        />
        <div class="flex items-center justify-between">
            {#if showCharCount}
                <span class="text-xs text-muted-foreground">
                    {editedCaption.length} caracteres
                </span>
            {:else}
                <span></span>
            {/if}
            <div class="flex gap-2">
                <Button variant="ghost" size="sm" onclick={cancelEditing} disabled={isSaving}>
                    Cancelar
                </Button>
                <Button size="sm" onclick={saveCaption} disabled={isSaving}>
                    {#if isSaving}
                        <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    {/if}
                    Salvar
                </Button>
            </div>
        </div>
        {#if showHashtags && hashtags.length > 0}
            <div class="flex flex-wrap gap-1.5">
                {#each hashtags as tag}
                    <Badge variant="outline" class="text-xs">{tag}</Badge>
                {/each}
            </div>
        {/if}
    </div>
{:else}
    <div class="group relative">
        <p class="whitespace-pre-wrap text-sm leading-relaxed pr-8">{displayCaption}</p>
        <button
            type="button"
            aria-label="Editar legenda"
            class="absolute right-0 top-0 flex h-7 w-7 items-center justify-center rounded-none border border-transparent text-muted-foreground opacity-0 transition-all hover:border-border hover:bg-muted hover:text-foreground group-hover:opacity-100"
            onclick={startEditing}
        >
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
        </button>
    </div>
{/if}

<script lang="ts">
    import { Label, Popover, PopoverTrigger, PopoverContent } from "$lib/components/ui";
    import { useQuery } from "convex-svelte";
    import { api } from "../../../convex/_generated/api.js";
    import type { Id } from "../../../convex/_generated/dataModel.js";

    interface Props {
        value: Id<"projects"> | null;
        onchange: (projectId: Id<"projects"> | null) => void;
        label?: string | null;
        description?: string | null;
        compact?: boolean;
    }

    let {
        value,
        onchange,
        label = "Projeto",
        description = "Associe este post a um projeto para organizar suas criações",
        compact = false,
    }: Props = $props();

    // Query projects
    const projectsQuery = useQuery(api.projects.list, () => ({}));
    let projects = $derived(projectsQuery.data ?? []);

    // Selected project
    let selectedProject = $derived(projects.find(p => p._id === value) ?? null);

    // Popover state
    let popoverOpen = $state(false);

    function selectProject(projectId: Id<"projects"> | null) {
        onchange(projectId);
        popoverOpen = false;
    }

    function getProfilePicture(project: typeof projects[0] | null): string | null {
        if (!project) return null;
        return project.logoStorageUrl ?? project.profilePictureStorageUrl ?? project.profilePictureUrl ?? null;
    }

    // Extract handle from Instagram URL
    function getHandle(project: typeof projects[0]): string | null {
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
</script>

<div class="space-y-2">
    {#if label}
        <Label class="text-sm font-medium">{label}</Label>
    {/if}
    <Popover bind:open={popoverOpen}>
        <PopoverTrigger>
            {#snippet child({ props })}
                <button
                    {...props}
                    type="button"
                    class={`flex w-full items-center justify-between border border-border bg-background px-3 text-sm transition-colors hover:bg-muted ${
                        compact ? "h-10 rounded-md" : "h-10"
                    } ${popoverOpen ? "ring-1 ring-ring" : ""}`}
                >
                    <div class="flex items-center gap-2">
                        {#if selectedProject}
                            <!-- Profile picture -->
                            <div class="h-6 w-6 overflow-hidden rounded-full border border-border bg-muted">
                                {#if getProfilePicture(selectedProject)}
                                    <img
                                        src={getProfilePicture(selectedProject)}
                                        alt={selectedProject.name}
                                        class="h-full w-full object-cover"
                                    />
                                {:else}
                                    <div class="flex h-full w-full items-center justify-center text-xs font-medium text-muted-foreground">
                                        {selectedProject.name.charAt(0).toUpperCase()}
                                    </div>
                                {/if}
                            </div>
                            <span>{selectedProject.name}</span>
                        {:else}
                            <span class="text-muted-foreground">Sem projeto</span>
                        {/if}
                    </div>
                    <svg class="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
                    </svg>
                </button>
            {/snippet}
        </PopoverTrigger>
        <PopoverContent class="w-[var(--popover-trigger-width)] p-1" align="start">
            <!-- No project option -->
            <button
                type="button"
                class="flex w-full items-center gap-2 px-2 py-2 text-sm transition-colors hover:bg-muted {value === null ? 'bg-muted' : ''}"
                onclick={() => selectProject(null)}
            >
                <div class="h-6 w-6 overflow-hidden rounded-full border border-dashed border-border bg-background">
                    <div class="flex h-full w-full items-center justify-center">
                        <svg class="h-3 w-3 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                    </div>
                </div>
                <span class="text-muted-foreground">Sem projeto</span>
                {#if value === null}
                    <svg class="ml-auto h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                {/if}
            </button>

            {#if projects.length > 0}
                <div class="my-1 border-t border-border"></div>
            {/if}

            <!-- Project options -->
            {#each projects as project (project._id)}
                <button
                    type="button"
                    class="flex w-full items-center gap-2 px-2 py-2 text-sm transition-colors hover:bg-muted {value === project._id ? 'bg-muted' : ''}"
                    onclick={() => selectProject(project._id)}
                >
                    <!-- Profile picture -->
                    <div class="h-6 w-6 overflow-hidden rounded-full border border-border bg-muted">
                        {#if getProfilePicture(project)}
                            <img
                                src={getProfilePicture(project)}
                                alt={project.name}
                                class="h-full w-full object-cover"
                            />
                        {:else}
                            <div class="flex h-full w-full items-center justify-center text-xs font-medium text-muted-foreground">
                                {project.name.charAt(0).toUpperCase()}
                            </div>
                        {/if}
                    </div>
                    <div class="flex flex-col items-start">
                        <span class="font-medium">{project.name}</span>
                        {#if getHandle(project)}
                            <span class="text-xs text-muted-foreground">@{getHandle(project)}</span>
                        {/if}
                    </div>
                    {#if value === project._id}
                        <svg class="ml-auto h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                    {/if}
                </button>
            {/each}

            {#if projects.length === 0}
                <div class="px-2 py-3 text-center text-sm text-muted-foreground">
                    Nenhum projeto criado
                </div>
            {/if}
        </PopoverContent>
    </Popover>
    {#if description}
        <p class="text-xs text-muted-foreground">
            {description}
        </p>
    {/if}
</div>

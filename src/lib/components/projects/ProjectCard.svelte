<script lang="ts">
    import { Badge, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "$lib/components/ui";
    import { goto } from "$app/navigation";
    import type { Id } from "../../../convex/_generated/dataModel.js";

    interface Project {
        _id: Id<"projects">;
        name: string;
        instagramUrl?: string;
        instagramHandle?: string;
        profilePictureUrl?: string;
        profilePictureStorageUrl?: string | null;
        logoStorageUrl?: string | null;
        isFetching?: boolean;
        instagramConnection?: {
            status: string;
            handle?: string;
        } | null;
    }

    interface Props {
        project: Project;
        postCount?: number;
        ondelete?: (projectId: Id<"projects">) => void;
    }

    let { project, postCount = 0, ondelete }: Props = $props();

    let profilePicture = $derived(
        project.logoStorageUrl ?? project.profilePictureStorageUrl ?? project.profilePictureUrl ?? null
    );

    // Extract handle from Instagram URL or use stored handle
    let handle = $derived(() => {
        if (project.instagramHandle) return project.instagramHandle;
        if (!project.instagramUrl) return null;
        try {
            const url = new URL(project.instagramUrl);
            const parts = url.pathname.split('/').filter(Boolean);
            return parts[0] ?? null;
        } catch {
            return null;
        }
    });

    function handleClick() {
        goto(`/projects/${project._id}`);
    }

    function handleDelete(event: Event) {
        event.stopPropagation();
        ondelete?.(project._id);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
        }
    }
</script>

<div
    class="group relative flex flex-col items-center gap-3 border border-border bg-card p-6 transition-shadow hover:shadow-lg cursor-pointer"
    onclick={handleClick}
    onkeydown={handleKeydown}
    role="button"
    tabindex="0"
>
    <!-- Delete button -->
    {#if ondelete}
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger>
                    <button
                        type="button"
                        aria-label="Excluir projeto"
                        class="absolute right-2 top-2 flex h-8 w-8 items-center justify-center text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
                        onclick={handleDelete}
                    >
                        <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                    </button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Excluir projeto</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    {/if}

    <!-- Avatar -->
    <div class="relative h-20 w-20 overflow-hidden rounded-full border-2 border-border bg-muted">
        {#if profilePicture}
            <img
                src={profilePicture}
                alt={project.name}
                class="h-full w-full object-cover"
            />
        {:else}
            <div class="flex h-full w-full items-center justify-center text-2xl font-semibold text-muted-foreground">
                {project.name.charAt(0).toUpperCase()}
            </div>
        {/if}

        <!-- Fetching indicator -->
        {#if project.isFetching}
            <div class="absolute inset-0 flex items-center justify-center bg-black/50">
                <svg class="h-6 w-6 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
        {/if}
    </div>

    <!-- Info -->
    <div class="text-center">
        <h3 class="font-medium">{project.name}</h3>
        {#if handle()}
            <p class="text-sm text-muted-foreground">@{handle()}</p>
        {:else}
            <p class="text-sm text-muted-foreground">Sem Instagram</p>
        {/if}
    </div>

    <!-- Post count -->
    <div class="flex flex-wrap justify-center gap-2">
        <Badge variant="secondary">
            {postCount} {postCount === 1 ? "post" : "posts"}
        </Badge>
        {#if project.instagramConnection?.status === "connected"}
            <Badge variant="outline">Conectado</Badge>
        {/if}
    </div>
</div>

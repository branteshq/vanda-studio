<script lang="ts">
    import { goto } from "$app/navigation";
    import { Button } from "$lib/components/ui";
    import { ProjectCard } from "$lib/components/projects";
    import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
    import { useConvexClient, useQuery } from "convex-svelte";
    import { api } from "../../convex/_generated/api.js";
    import type { Id } from "../../convex/_generated/dataModel.js";
    import Navbar from "$lib/components/Navbar.svelte";
    import { showUserError } from "$lib/errors";

    const client = useConvexClient();

    // Queries
    const projectsQuery = useQuery(api.projects.listSummaries, () => ({}));

    // Derived data
    let projects = $derived(projectsQuery.data ?? []);
    let isLoading = $derived(projectsQuery.isLoading);

    // Delete confirmation state
    let deleteConfirmId = $state<Id<"projects"> | null>(null);
    let isDeleting = $state(false);

    async function handleDeleteProject(projectId: Id<"projects">) {
        deleteConfirmId = projectId;
    }

    async function confirmDelete() {
        if (!deleteConfirmId) return;

        isDeleting = true;
        try {
            await client.mutation(api.projects.remove, { projectId: deleteConfirmId });
            deleteConfirmId = null;
        } catch (err) {
            console.error("Failed to delete project:", err);
            showUserError(err);
        } finally {
            isDeleting = false;
        }
    }

    function cancelDelete() {
        deleteConfirmId = null;
    }

</script>

<svelte:head>
    <title>Projetos - Vanda Studio</title>
</svelte:head>

<div class="flex h-screen flex-col bg-background">
    <Navbar />

    <!-- Header -->
    <div class="shrink-0 border-b border-border bg-muted/30 px-6 py-4">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-xl font-semibold">Projetos</h1>
                <p class="text-sm text-muted-foreground">Organize posts e contexto de marca por projeto</p>
            </div>
            <SignedIn>
                <Button onclick={() => goto("/projects/new")}>
                    <svg class="h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Novo Projeto
                </Button>
            </SignedIn>
        </div>
    </div>

    <!-- Main content -->
    <main class="flex-1 overflow-y-auto p-6">
        <SignedOut>
            <div class="flex flex-1 flex-col items-center justify-center gap-6 py-20">
                <div class="text-center">
                    <h2 class="text-2xl font-bold">Entre para ver seus projetos</h2>
                    <p class="mt-2 text-muted-foreground">
                        Faça login para gerenciar seus projetos
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
            {#if isLoading}
                <div class="flex items-center justify-center py-20">
                    <div class="flex flex-col items-center gap-4">
                        <svg class="h-8 w-8 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p class="text-sm text-muted-foreground">Carregando projetos...</p>
                    </div>
                </div>
            {:else if projects.length === 0}
                <div class="flex flex-col items-center justify-center py-20">
                    <div class="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-border bg-muted/50">
                        <svg class="h-10 w-10 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3H21m-3.75 3H21" />
                        </svg>
                    </div>
                    <h3 class="mt-6 text-lg font-medium">Nenhum projeto ainda</h3>
                    <p class="mt-2 text-sm text-muted-foreground">
                        Crie seu primeiro projeto e defina o contexto da marca
                    </p>
                    <Button class="mt-6" onclick={() => goto("/projects/new")}>
                        <svg class="h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Criar Primeiro Projeto
                    </Button>
                </div>
            {:else}
                <!-- Projects grid -->
                <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {#each projects as project (project._id)}
                        <ProjectCard
                            {project}
                            postCount={project.postCount ?? 0}
                            ondelete={handleDeleteProject}
                        />
                    {/each}
                </div>
            {/if}
        </SignedIn>
    </main>
</div>

<!-- Delete Confirmation Modal -->
{#if deleteConfirmId}
    <!-- Backdrop -->
    <div
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onclick={cancelDelete}
        onkeydown={(e) => e.key === "Enter" && cancelDelete()}
        role="button"
        tabindex="0"
    ></div>

    <!-- Modal -->
    <div class="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border bg-background shadow-xl p-6">
        <h3 class="text-lg font-semibold">Excluir projeto?</h3>
        <p class="mt-2 text-sm text-muted-foreground">
            Esta ação irá excluir o projeto e todos os posts associados permanentemente. Esta ação não pode ser desfeita.
        </p>
        <div class="mt-6 flex justify-end gap-3">
            <Button variant="outline" onclick={cancelDelete} disabled={isDeleting}>
                Cancelar
            </Button>
            <Button variant="destructive" onclick={confirmDelete} disabled={isDeleting}>
                {#if isDeleting}
                    <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Excluindo...
                {:else}
                    Excluir
                {/if}
            </Button>
        </div>
    </div>
{/if}

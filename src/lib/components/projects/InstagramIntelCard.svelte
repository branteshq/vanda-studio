<script lang="ts">
    import { BookMarked, Sparkles } from "lucide-svelte";

    interface InstagramDigest {
        recentThemes: string[];
        recentHooks: string[];
        avoidNext: string[];
        summaryForModel: string;
        postsAnalyzed: number;
        updatedAt: number;
    }

    interface Props {
        digest: InstagramDigest | null;
        lastInstagramSyncAt?: number;
        lastInstagramSyncMode?: "intel_only" | "full";
        /** Optional brand primary for subtle accent (hex) */
        brandAccent?: string | null;
        onOpenSettings?: () => void;
    }

    let {
        digest,
        lastInstagramSyncAt,
        lastInstagramSyncMode,
        brandAccent = null,
        onOpenSettings,
    }: Props = $props();

    function formatSync(ts: number): string {
        return new Date(ts).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    const modeLabel = $derived(
        lastInstagramSyncMode === "full"
            ? "Sincronização completa (mídias na Vanda)"
            : lastInstagramSyncMode === "intel_only"
              ? "Captura leve (legendas)"
              : null
    );
</script>

<section
    class="intel-strip relative overflow-hidden border border-border/80 bg-card/40 p-6 backdrop-blur-sm"
    style={brandAccent
        ? `box-shadow: inset 0 1px 0 0 color-mix(in oklch, ${brandAccent} 25%, transparent);`
        : undefined}
>
    <div
        class="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-[0.07]"
        style={brandAccent ? `background: ${brandAccent}` : "background: var(--primary)"}
    ></div>

    <div class="relative flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-center gap-3">
            <div
                class="flex h-10 w-10 shrink-0 items-center justify-center border border-border/60 bg-background/80 text-muted-foreground"
            >
                <BookMarked class="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div>
                <div class="flex items-center gap-2">
                    <h2 class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/70">
                        Memória do Instagram
                    </h2>
                    <Sparkles class="h-3 w-3 text-muted-foreground/40" strokeWidth={1.5} />
                </div>
                <p class="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground/80">
                    O que a Vanda entende do seu feed público para não repetir temas e datas comemorativas nas
                    sugestões.
                </p>
            </div>
        </div>
        {#if lastInstagramSyncAt}
            <div class="text-right text-[10px] uppercase tracking-wider text-muted-foreground/50">
                <div>Última captura</div>
                <div class="mt-0.5 font-medium normal-case text-foreground/80">{formatSync(lastInstagramSyncAt)}</div>
                {#if modeLabel}
                    <div class="mt-1 normal-case text-muted-foreground/60">{modeLabel}</div>
                {/if}
            </div>
        {/if}
    </div>

    <p class="relative mt-4 border-l-2 border-muted-foreground/20 pl-3 text-[11px] leading-relaxed text-muted-foreground/70">
        Baseado no que estava público no Instagram quando você rodou a captura — posts novos depois disso ainda não
        entram automaticamente.
    </p>

    {#if digest}
        <div class="relative mt-5 space-y-4">
            <p class="text-sm leading-relaxed text-foreground/90">{digest.summaryForModel}</p>

            {#if digest.recentThemes.length > 0}
                <div>
                    <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                        Temas recentes
                    </h3>
                    <div class="flex flex-wrap gap-1.5">
                        {#each digest.recentThemes as theme}
                            <span
                                class="border border-border/70 bg-background/60 px-2 py-0.5 text-[11px] text-foreground/85"
                            >
                                {theme}
                            </span>
                        {/each}
                    </div>
                </div>
            {/if}

            {#if digest.avoidNext.length > 0}
                <div>
                    <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                        Evitar repetir em seguida
                    </h3>
                    <div class="flex flex-wrap gap-1.5">
                        {#each digest.avoidNext as item}
                            <span
                                class="border border-dashed border-amber-500/35 bg-amber-500/[0.06] px-2 py-0.5 text-[11px] text-foreground/80"
                            >
                                {item}
                            </span>
                        {/each}
                    </div>
                </div>
            {/if}

            <p class="text-[10px] text-muted-foreground/45">
                {digest.postsAnalyzed} postagens analisadas nas legendas · digest atualizado em {formatSync(digest.updatedAt)}
            </p>
        </div>
    {:else}
        <div class="relative mt-6 border border-dashed border-border/60 bg-muted/20 px-4 py-5 text-center">
            <p class="text-sm text-muted-foreground">
                Ainda não há memória do feed. Uma captura leve lê as últimas legendas e prepara a Vanda para sugestões
                mais inteligentes.
            </p>
            {#if onOpenSettings}
                <button
                    type="button"
                    class="mt-4 text-xs font-medium text-primary underline-offset-4 hover:underline"
                    onclick={() => onOpenSettings()}
                >
                    Abrir configurações e capturar
                </button>
            {/if}
        </div>
    {/if}
</section>

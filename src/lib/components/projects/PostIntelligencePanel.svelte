<script lang="ts">
	import {
		Info,
		MessageSquare,
		ShieldCheck,
		Sparkles,
		Target,
		X,
	} from "lucide-svelte";

	export type PostIntelligencePost = {
		title: string;
		caption: string;
		mediaLabel: string;
		thumbnailUrl: string | null;
		publishedAt: number;
		likeCount: number;
		commentsCount: number;
		shares: number;
		saves: number;
		reach: number;
		impressions: number;
		engagementRate: number;
		intelligence?: {
			hook?: string;
			visualSignals?: string[];
			performanceNotes?: string[];
		} | null | undefined;
	};

	let { post, onclose }: { post: PostIntelligencePost | null; onclose?: () => void } = $props();

	function formatShortNumber(value: number): string {
		if (value >= 1000) return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
		return value.toLocaleString("pt-BR");
	}

	function formatPercent(value: number): string {
		return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
	}

	function formatDate(value: number): string {
		return new Intl.DateTimeFormat("pt-BR", {
			day: "2-digit",
			month: "short",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(value);
	}
</script>

<aside class="min-h-full border-l border-border bg-card/95 px-5 py-5 xl:sticky xl:top-14 xl:h-[calc(100vh-3.5rem)] xl:overflow-y-auto">
	<div class="flex items-center justify-between">
		<h2 class="text-base font-semibold text-foreground">Inteligência do post</h2>
		<button class="text-muted-foreground/70 hover:text-foreground" aria-label="Fechar painel" onclick={onclose}><X class="h-4 w-4" /></button>
	</div>

	{#if post}
		<p class="mt-7 text-sm font-medium text-muted-foreground">Post selecionado</p>
		<div class="mt-3 grid gap-4 border border-border bg-background/30 p-3 sm:grid-cols-[10.5rem_1fr]">
			<div class="relative aspect-[1.45/1] overflow-hidden bg-muted sm:aspect-square">
				{#if post.thumbnailUrl}
					<img src={post.thumbnailUrl} alt={post.title} class="h-full w-full object-cover" />
				{:else}
					<div class="flex h-full flex-col justify-between bg-[radial-gradient(circle_at_20%_20%,rgba(20,184,166,0.24),transparent_35%),linear-gradient(135deg,rgba(6,78,59,.78),rgba(20,20,24,.96))] p-5">
						<ShieldCheck class="h-11 w-11 text-foreground/45" />
						<p class="text-sm font-black uppercase leading-tight text-foreground">{post.title}</p>
					</div>
				{/if}
				<span class="absolute right-2 top-2 bg-background/80 px-2 py-1 text-xs text-foreground">{post.mediaLabel}</span>
			</div>
			<div class="min-w-0 py-3">
				<h3 class="line-clamp-3 text-base font-semibold leading-6 text-foreground">{post.title}! Entenda as mudanças e como sua empresa deve se preparar para estar em conformidade.</h3>
				<p class="mt-4 text-xs text-muted-foreground/75">{formatDate(post.publishedAt)}</p>
				<p class="mt-2 text-xs font-semibold text-emerald-500">● Publicado</p>
			</div>
		</div>

		<section class="mt-4 border border-border bg-background/30 p-4">
			<div class="flex items-center justify-between gap-3">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-foreground">Resumo de desempenho <Info class="h-3.5 w-3.5 text-muted-foreground" /></h3>
			</div>
			<div class="mt-4 grid grid-cols-5 border-b border-border pb-4">
				<div class="border-r border-border pr-3"><p class="text-xs text-muted-foreground">Alcance</p><p class="mt-1 text-xl text-foreground">{formatShortNumber(post.reach)}</p></div>
				<div class="border-r border-border px-3"><p class="text-xs text-muted-foreground">Engajamento</p><p class="mt-1 text-xl text-foreground">{formatPercent(post.engagementRate)}</p></div>
				<div class="border-r border-border px-3"><p class="text-xs text-muted-foreground">Curtidas</p><p class="mt-1 text-xl text-foreground">{post.likeCount}</p></div>
				<div class="border-r border-border px-3"><p class="text-xs text-muted-foreground">Comentários</p><p class="mt-1 text-xl text-foreground">{post.commentsCount}</p></div>
				<div class="pl-3"><p class="text-xs text-muted-foreground">Compart.</p><p class="mt-1 text-xl text-foreground">{post.shares}</p></div>
			</div>
			<div class="mt-4 grid grid-cols-3">
				<div class="border-r border-border pr-3"><p class="text-xs text-muted-foreground">Salvos</p><p class="mt-1 text-lg text-foreground">{post.saves}</p></div>
				<div class="border-r border-border px-3"><p class="text-xs text-muted-foreground">Impressões</p><p class="mt-1 text-lg text-foreground">{formatShortNumber(post.impressions)}</p></div>
				<div class="pl-3"><p class="text-xs text-muted-foreground">ER por alcance</p><p class="mt-1 text-lg text-foreground">{formatPercent(post.engagementRate)}</p></div>
			</div>
		</section>

		{#if post.intelligence}
			<section class="mt-4 overflow-hidden border border-border bg-background/30">
				<article class="p-4"><h4 class="flex items-center gap-3 text-sm font-semibold"><Target class="h-4 w-4 text-violet-400" />Análise do gancho</h4><p class="mt-2 pl-7 text-sm text-muted-foreground">{post.intelligence.hook}</p></article>
				<article class="border-t border-border p-4"><h4 class="flex items-center gap-3 text-sm font-semibold"><Sparkles class="h-4 w-4 text-teal-400" />Análise visual</h4><p class="mt-2 pl-7 text-sm text-muted-foreground">{post.intelligence.visualSignals?.join(". ") ?? "—"}</p></article>
				<article class="border-t border-border p-4"><h4 class="flex items-center gap-3 text-sm font-semibold"><MessageSquare class="h-4 w-4 text-orange-400" />Análise da legenda</h4><p class="mt-2 pl-7 text-sm text-muted-foreground">{post.intelligence.performanceNotes?.join(". ") ?? "—"}</p></article>
			</section>
		{/if}
	{:else}
		<div class="mt-6 border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Selecione um post para ver a inteligência.</div>
	{/if}
</aside>

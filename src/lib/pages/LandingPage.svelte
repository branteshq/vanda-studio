<script lang="ts">
	import Logo from "$lib/components/Logo.svelte";
	import SettingsMenu from "$lib/components/SettingsMenu.svelte";
	import { onMount } from "svelte";

	// Carousel state for stacked cards
	let cardOrder = $state([0, 1, 2]);
	let animatingCard = $state<number | null>(null);
	let isAnimating = $state(false);
	let autoPlayInterval: ReturnType<typeof setInterval> | null = null;
	const appUrl = "/images";

	const cards = [
		{
			image: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&h=500&fit=crop&q=80",
			alt: "AI generated abstract art",
			caption: "Explorando novas fronteiras da criatividade digital ✨",
			tags: ["#arte", "#design", "#ai"]
		},
		{
			image: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500&h=500&fit=crop&q=80",
			alt: "AI generated colorful design",
			caption: "O futuro do conteúdo está aqui 🚀",
			tags: ["#criativo", "#marketing"]
		},
		{
			image: "https://images.unsplash.com/photo-1633177317976-3f9bc45e1d1d?w=500&h=500&fit=crop&q=80",
			alt: "AI generated gradient art",
			caption: "Transformando ideias em realidade visual 💡",
			tags: ["#branding", "#visual", "#inovação"]
		}
	];

	function getCardPosition(cardIndex: number): number {
		return cardOrder.indexOf(cardIndex);
	}

	function bringToFront(cardIndex: number) {
		const currentPosition = getCardPosition(cardIndex);
		if (currentPosition === 0 || isAnimating) return;

		isAnimating = true;
		animatingCard = cardIndex;

		// After the sweep-out animation, reorder and animate to front
		setTimeout(() => {
			const newOrder = cardOrder.filter(i => i !== cardIndex);
			cardOrder = [cardIndex, ...newOrder];

			// Reset animation state after settle
			setTimeout(() => {
				animatingCard = null;
				isAnimating = false;
			}, 400);
		}, 350);
	}

	function cycleToNext() {
		// Bring the back card (last in order) to front
		const backCard = cardOrder[cardOrder.length - 1];
		if (backCard === undefined) return;
		bringToFront(backCard);
	}

	function startAutoPlay() {
		if (autoPlayInterval) return;
		autoPlayInterval = setInterval(cycleToNext, 3000);
	}

	function stopAutoPlay() {
		if (autoPlayInterval) {
			clearInterval(autoPlayInterval);
			autoPlayInterval = null;
		}
	}

	function resetAutoPlay() {
		stopAutoPlay();
		startAutoPlay();
	}

	function handleCardClick(cardIndex: number) {
		bringToFront(cardIndex);
		resetAutoPlay(); // Reset timer when user interacts
	}

	onMount(() => {
		startAutoPlay();
		return () => stopAutoPlay();
	});
</script>

<svelte:head>
	<title>Vanda Studio - Geração de Posts com IA</title>
	<meta name="description" content="Crie posts incríveis para Instagram com inteligência artificial. Vanda Studio automatiza sua criação de conteúdo." />
</svelte:head>

<!-- DESIGN 2 REFINED: Bold geometric with design system consistency -->
<div class="min-h-screen bg-background text-foreground overflow-hidden">
	<!-- Navigation - Consistent with app navbar -->
	<nav class="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
		<div class="flex items-center justify-between px-6 lg:px-16 h-14">
			<Logo size="lg" />
			<div class="flex items-center gap-2">
				<a href="#recursos" class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">Recursos</a>
				<a href="#precos" class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">Preços</a>
				<SettingsMenu />
				<a
					href={appUrl}
					class="btn-glow ml-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
				>
					Ir Para App
				</a>
			</div>
		</div>
	</nav>

	<!-- Hero Section - Bold typography with refined structure -->
	<section class="relative min-h-screen flex items-center pt-14">
		<!-- Geometric accents -->
		<div class="absolute top-32 right-0 w-[40vw] h-[60vh] bg-primary/5 dark:bg-primary/10"></div>
		<div class="absolute bottom-0 left-0 w-[30vw] h-[40vh] border border-border"></div>
		<div class="absolute top-1/2 left-1/4 w-24 h-24 bg-muted transform rotate-45 hidden lg:block"></div>

		<!-- Vertical accent stripe -->
		<div class="absolute left-0 top-14 bottom-0 w-1 bg-primary"></div>

		<div class="relative z-10 px-8 lg:px-16 w-full max-w-[1800px] mx-auto">
			<div class="grid lg:grid-cols-2 gap-16 items-center">
				<!-- Left - Typography -->
				<div class="space-y-8">
					<div class="inline-block border border-border px-4 py-2">
						<span class="text-sm font-medium uppercase tracking-[0.2em] text-primary">Estúdio de Criação</span>
					</div>

					<h1 class="text-5xl sm:text-6xl lg:text-8xl font-serif leading-[0.9] tracking-tight">
						Posts<br/>
						Que<br/>
						<span class="text-primary">Impactam</span>
					</h1>

					<div class="border-l-2 border-primary pl-6">
						<p class="text-lg lg:text-xl text-muted-foreground max-w-md leading-relaxed">
							Geração de imagens. Legendas inteligentes. Agendamento automático.
							<span class="text-foreground font-medium">Tudo com IA.</span>
						</p>
					</div>

					<div class="flex flex-wrap gap-4 pt-4">
						<a
							href={appUrl}
							class="btn-glow group relative bg-primary text-primary-foreground px-8 py-4 text-sm font-medium tracking-wide uppercase overflow-hidden"
						>
							<span class="relative z-10">Começar Agora</span>
							<div class="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
						</a>
						<a href="#demo" class="border border-border px-8 py-4 text-sm font-medium tracking-wide uppercase hover:bg-secondary hover:border-primary/50 transition-colors">
							Ver Demo
						</a>
					</div>
				</div>

				<!-- Right - Stacked cards with real posts (carousel) -->
				<div class="relative h-[600px] hidden lg:block card-stack">
					{#each cards as card, cardIndex}
						{@const position = getCardPosition(cardIndex)}
						{@const isSweeping = animatingCard === cardIndex}
						<button
							type="button"
							onclick={() => handleCardClick(cardIndex)}
							class="card-item absolute w-80 border bg-card overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
								{position === 0 ? 'card-front border-primary/50 shadow-md' : ''}
								{position === 1 ? 'card-middle border-border shadow-lg' : ''}
								{position === 2 ? 'card-back border-border shadow-xl' : ''}
								{isSweeping ? 'card-sweep-out' : ''}
							"
							style="--card-index: {position};"
						>
							{#if position === 2 && !isSweeping}
								<div class="absolute -top-3 -left-3 w-6 h-6 bg-primary z-10"></div>
							{:else if position === 1 && !isSweeping}
								<div class="absolute -bottom-3 -right-3 w-6 h-6 bg-foreground z-10"></div>
							{/if}
							<img
								src={card.image}
								alt={card.alt}
								class="w-full aspect-square object-cover"
							/>
							<div class="p-4 space-y-2 text-left">
								<p class="text-sm text-muted-foreground line-clamp-2">{card.caption}</p>
								<div class="flex gap-1.5 flex-wrap">
									{#each card.tags as tag}
										<span class="text-xs text-primary">{tag}</span>
									{/each}
								</div>
							</div>
						</button>
					{/each}
				</div>
			</div>
		</div>

		<!-- Decorative number -->
		<div class="absolute bottom-8 right-8 text-[15vw] font-serif text-foreground/[0.02] dark:text-white/[0.03] leading-none pointer-events-none select-none">
			01
		</div>
	</section>

	<!-- Features Section -->
	<section id="recursos" class="py-24 lg:py-32 border-t border-border">
		<div class="max-w-[1800px] mx-auto px-8 lg:px-16">
			<!-- Section header -->
			<div class="flex flex-col lg:flex-row lg:items-end justify-between mb-16 pb-8 border-b border-border">
				<div>
					<span class="text-sm font-medium uppercase tracking-[0.2em] text-primary">Recursos</span>
					<h2 class="text-4xl lg:text-5xl font-serif mt-4">
						O Que Você<br/>Pode Fazer
					</h2>
				</div>
				<p class="text-muted-foreground max-w-md mt-6 lg:mt-0 lg:text-right">
					Ferramentas profissionais de criação de conteúdo, simplificadas pela inteligência artificial.
				</p>
			</div>

			<!-- Features grid -->
			<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
				<div class="bg-background p-8 lg:p-10 group hover:bg-muted/30 transition-colors">
					<div class="text-4xl font-serif text-primary mb-4">01</div>
					<h3 class="text-xl font-serif mb-3 group-hover:text-primary transition-colors">Imagens com IA</h3>
					<p class="text-muted-foreground leading-relaxed">
						Gere visuais únicos com modelos de última geração. Controle estilo, composição e formato.
					</p>
				</div>

				<div class="bg-background p-8 lg:p-10 group hover:bg-muted/30 transition-colors">
					<div class="text-4xl font-serif text-primary mb-4">02</div>
					<h3 class="text-xl font-serif mb-3 group-hover:text-primary transition-colors">Legendas Inteligentes</h3>
					<p class="text-muted-foreground leading-relaxed">
						IA que entende seu contexto. Gere textos envolventes com hashtags otimizadas.
					</p>
				</div>

				<div class="bg-background p-8 lg:p-10 group hover:bg-muted/30 transition-colors">
					<div class="text-4xl font-serif text-primary mb-4">03</div>
					<h3 class="text-xl font-serif mb-3 group-hover:text-primary transition-colors">Agendamento</h3>
					<p class="text-muted-foreground leading-relaxed">
						Agende posts no calendário do Vanda e exporte lembretes em ICS quando precisar.
					</p>
				</div>

				<div class="bg-background p-8 lg:p-10 group hover:bg-muted/30 transition-colors">
					<div class="text-4xl font-serif text-primary mb-4">04</div>
					<h3 class="text-xl font-serif mb-3 group-hover:text-primary transition-colors">Multi-Projetos</h3>
					<p class="text-muted-foreground leading-relaxed">
						Organize múltiplas contas. Cada projeto com sua identidade visual única.
					</p>
				</div>

				<div class="bg-background p-8 lg:p-10 group hover:bg-muted/30 transition-colors">
					<div class="text-4xl font-serif text-primary mb-4">05</div>
					<h3 class="text-xl font-serif mb-3 group-hover:text-primary transition-colors">Galeria</h3>
					<p class="text-muted-foreground leading-relaxed">
						Visualize todos seus posts gerados. Busca avançada e filtros inteligentes.
					</p>
				</div>

				<div class="bg-primary text-primary-foreground p-8 lg:p-10">
					<div class="text-4xl font-serif mb-4">→</div>
					<h3 class="text-xl font-serif mb-3">Comece Agora</h3>
					<p class="text-primary-foreground/80 leading-relaxed mb-6">
						Crie sua conta gratuita e transforme seu conteúdo.
					</p>
					<a
						href={appUrl}
						class="border border-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary-foreground hover:text-primary transition-colors"
					>
						Criar Conta
					</a>
				</div>
			</div>
		</div>
	</section>

	<!-- Stats Section -->
	<section class="py-24 border-t border-border bg-card">
		<div class="max-w-[1800px] mx-auto px-8 lg:px-16">
			<div class="grid md:grid-cols-3 gap-8 lg:gap-16">
				<div class="text-center lg:text-left">
					<div class="text-5xl lg:text-7xl font-serif text-primary">5K+</div>
					<p class="text-sm font-medium uppercase tracking-widest mt-3 text-muted-foreground">Criadores Ativos</p>
				</div>
				<div class="text-center">
					<div class="text-5xl lg:text-7xl font-serif text-primary">100K+</div>
					<p class="text-sm font-medium uppercase tracking-widest mt-3 text-muted-foreground">Posts Gerados</p>
				</div>
				<div class="text-center lg:text-right">
					<div class="text-5xl lg:text-7xl font-serif text-primary">99%</div>
					<p class="text-sm font-medium uppercase tracking-widest mt-3 text-muted-foreground">Satisfação</p>
				</div>
			</div>
		</div>
	</section>

	<!-- CTA Section -->
	<section class="py-24 lg:py-32 border-t border-border relative">
		<div class="absolute top-0 left-0 w-1/2 h-full bg-primary/5 dark:bg-primary/10"></div>

		<div class="relative max-w-[1800px] mx-auto px-8 lg:px-16">
			<div class="grid lg:grid-cols-2 gap-16 items-center">
				<div>
					<span class="text-sm font-medium uppercase tracking-[0.2em] text-primary">Começar</span>
					<h2 class="text-4xl lg:text-5xl font-serif mt-4">
						Pronto Para<br/>
						<span class="text-primary">Transformar</span><br/>
						Seu Conteúdo?
					</h2>
				</div>
				<div class="flex flex-col items-start gap-6">
					<p class="text-lg text-muted-foreground">
						Junte-se a milhares de criadores. Comece gratuitamente, escale quando precisar.
					</p>
					<a
						href={appUrl}
						class="btn-glow group relative bg-primary text-primary-foreground px-10 py-5 text-sm font-medium tracking-wide uppercase overflow-hidden"
					>
						<span class="relative z-10">Começar Gratuitamente</span>
						<div class="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
					</a>
				</div>
			</div>
		</div>
	</section>

	<!-- Footer -->
	<footer class="border-t border-border py-12">
		<div class="max-w-[1800px] mx-auto px-8 lg:px-16 flex flex-col lg:flex-row items-center justify-between gap-6">
			<Logo size="sm" />
			<p class="text-sm text-muted-foreground">
				© 2025 Vanda Studio. Todos os direitos reservados.
			</p>
			<div class="flex items-center gap-6">
				<a href="/privacidade" class="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacidade</a>
				<a href="/termos" class="text-sm text-muted-foreground hover:text-foreground transition-colors">Termos</a>
			</div>
		</div>
	</footer>
</div>

<style>
	/* Card stack positions */
	.card-stack {
		perspective: 1000px;
	}

	.card-item {
		transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
		transform-style: preserve-3d;
	}

	/* Front card - closest to viewer */
	.card-front {
		top: 160px;
		right: 128px;
		z-index: 30;
		transform: translateZ(0);
	}

	/* Middle card */
	.card-middle {
		top: 64px;
		right: 64px;
		z-index: 20;
		transform: translateZ(-20px) scale(0.98);
	}

	/* Back card - furthest */
	.card-back {
		top: -32px;
		right: 0px;
		z-index: 10;
		transform: translate(32px, 32px) translateZ(-40px) scale(0.96);
	}

	/* Sweep out animation - card arcs out to the left then comes to front */
	.card-sweep-out {
		animation: sweepOut 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
		z-index: 50 !important;
	}

	@keyframes sweepOut {
		0% {
			transform: translateZ(0);
		}
		30% {
			transform: translateX(-120px) translateY(-80px) rotateY(-25deg) rotateZ(-8deg) scale(1.05);
		}
		60% {
			transform: translateX(-60px) translateY(-40px) rotateY(-10deg) rotateZ(-3deg) scale(1.02);
		}
		100% {
			/* End at front position */
			top: 160px;
			right: 128px;
			transform: translateZ(0) rotateY(0) rotateZ(0) scale(1);
		}
	}
</style>

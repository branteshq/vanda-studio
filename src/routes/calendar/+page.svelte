<script lang="ts">
	import { Button, Badge, Popover, PopoverTrigger, PopoverContent } from "$lib/components/ui";
	import { Calendar } from "$lib/components/ui/calendar";
	import { SignedIn, SignedOut, SignInButton } from "svelte-clerk";
	import { useConvexClient, useQuery } from "convex-svelte";
	import { api } from "../../convex/_generated/api.js";
	import type { Id } from "../../convex/_generated/dataModel.js";
	import { goto } from "$app/navigation";
	import Navbar from "$lib/components/Navbar.svelte";
	import { CalendarDate, getLocalTimeZone, today, isSameDay } from "@internationalized/date";
	import { ChevronLeft, ChevronRight, Download, Check, Clock, AlertCircle, Settings } from "lucide-svelte";
	import { generateBulkICS } from "$lib/utils.js";

	// Settings panel state
	let settingsOpen = $state(false);

	const client = useConvexClient();

	// Current month state
	let currentDate = $state(today(getLocalTimeZone()));
	
	// Calculate month boundaries for query
	let monthStart = $derived(() => {
		const firstOfMonth = new CalendarDate(currentDate.year, currentDate.month, 1);
		return firstOfMonth.toDate(getLocalTimeZone()).getTime();
	});
	
	let monthEnd = $derived(() => {
		const lastDay = new CalendarDate(currentDate.year, currentDate.month, 1)
			.add({ months: 1 })
			.subtract({ days: 1 });
		const endOfDay = lastDay.toDate(getLocalTimeZone());
		endOfDay.setHours(23, 59, 59, 999);
		return endOfDay.getTime();
	});

	// Query scheduled posts for current month
	const scheduledPostsQuery = useQuery(
		api.scheduledPosts.getScheduledPosts,
		() => ({ startDate: monthStart(), endDate: monthEnd() })
	);

	// Query scheduling stats
	const statsQuery = useQuery(api.scheduledPosts.getSchedulingStats, () => ({}));

	let scheduledPosts = $derived(scheduledPostsQuery.data ?? []);
	let stats = $derived(statsQuery.data ?? { scheduled: 0, posted: 0, missed: 0 });
	let isLoading = $derived(scheduledPostsQuery.isLoading);

	// Selected day for detail view
	let selectedDay = $state<CalendarDate | null>(null);
	let dayDetailOpen = $state(false);

	// Get posts for a specific day
	function getPostsForDay(date: CalendarDate) {
		return scheduledPosts.filter(post => {
			if (!post.scheduledFor) return false;
			const postDate = new Date(post.scheduledFor);
			return (
				postDate.getFullYear() === date.year &&
				postDate.getMonth() + 1 === date.month &&
				postDate.getDate() === date.day
			);
		});
	}

	// Navigate months
	function previousMonth() {
		currentDate = currentDate.subtract({ months: 1 });
	}

	function nextMonth() {
		currentDate = currentDate.add({ months: 1 });
	}

	function goToToday() {
		currentDate = today(getLocalTimeZone());
	}

	// Format month header
	function formatMonthHeader(date: CalendarDate): string {
		const jsDate = date.toDate(getLocalTimeZone());
		return jsDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
	}

	// Format time for display
	function formatTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString('pt-BR', {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Format full date
	function formatFullDate(date: CalendarDate): string {
		return date.toDate(getLocalTimeZone()).toLocaleDateString('pt-BR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		});
	}

	// Truncate caption
	function truncateCaption(caption: string, maxLength: number = 80): string {
		if (caption.length <= maxLength) return caption;
		return caption.substring(0, maxLength).trim() + '...';
	}

	// Get status badge color
	function getStatusColor(status: string | undefined): string {
		switch (status) {
			case 'posted': return 'bg-green-500/10 text-green-600 border-green-500/30';
			case 'missed': return 'bg-red-500/10 text-red-600 border-red-500/30';
			default: return 'bg-blue-500/10 text-blue-600 border-blue-500/30';
		}
	}

	// Get status label
	function getStatusLabel(status: string | undefined): string {
		switch (status) {
			case 'posted': return 'Postado';
			case 'missed': return 'Perdido';
			default: return 'Agendado';
		}
	}

	// Handle day click
	function handleDayClick(date: CalendarDate) {
		const posts = getPostsForDay(date);
		if (posts.length > 0) {
			selectedDay = date;
			dayDetailOpen = true;
		}
	}

	// Handle mark as posted
	async function handleMarkAsPosted(postId: Id<"generated_posts">) {
		await client.mutation(api.scheduledPosts.markAsPosted, { postId });
	}

	// Handle unschedule
	async function handleUnschedule(postId: Id<"generated_posts">) {
		await client.mutation(api.scheduledPosts.unschedulePost, { postId });
		dayDetailOpen = false;
	}

	// Export all scheduled posts as ICS
	function handleExportAll() {
		const events = scheduledPosts
			.filter(p => p.schedulingStatus === 'scheduled' && p.scheduledFor)
			.map(p => ({
				title: `Postar no Instagram${p.projectName ? ` - ${p.projectName}` : ''}`,
				description: p.caption,
				startTime: p.scheduledFor!,
				reminderMinutes: p.reminderMinutes,
			}));

		if (events.length === 0) return;

		const icsContent = generateBulkICS(events);
		const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `vanda-calendario-${currentDate.year}-${String(currentDate.month).padStart(2, '0')}.ics`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	// Generate calendar days for the month
	function getCalendarDays() {
		const firstDay = new CalendarDate(currentDate.year, currentDate.month, 1);
		const lastDay = firstDay.add({ months: 1 }).subtract({ days: 1 });
		
		// Get the day of week for the first day (0 = Sunday)
		const startDayOfWeek = firstDay.toDate(getLocalTimeZone()).getDay();
		
		const days: { date: CalendarDate; isCurrentMonth: boolean }[] = [];
		
		// Add days from previous month to fill the week
		for (let i = startDayOfWeek - 1; i >= 0; i--) {
			days.push({
				date: firstDay.subtract({ days: i + 1 }),
				isCurrentMonth: false
			});
		}
		
		// Add days of current month
		for (let d = 1; d <= lastDay.day; d++) {
			days.push({
				date: new CalendarDate(currentDate.year, currentDate.month, d),
				isCurrentMonth: true
			});
		}
		
		// Add days from next month to complete the grid (always 6 rows = 42 cells)
		const remaining = 42 - days.length;
		for (let i = 1; i <= remaining; i++) {
			days.push({
				date: lastDay.add({ days: i }),
				isCurrentMonth: false
			});
		}
		
		return days;
	}

	let calendarDays = $derived(getCalendarDays());
	let todayDate = $derived(today(getLocalTimeZone()));
</script>

<svelte:head>
	<title>Calendário - Vanda Studio</title>
</svelte:head>

<div class="flex h-screen flex-col bg-background">
	<Navbar />

	<SignedOut>
		<div class="flex flex-1 flex-col items-center justify-center gap-6 py-20">
			<div class="text-center">
				<h2 class="text-2xl font-bold">Entre para ver seu calendário</h2>
				<p class="mt-2 text-muted-foreground">
					Faça login para acessar seus posts agendados
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
		<!-- Header -->
		<div class="shrink-0 border-b border-border bg-muted/30 px-6 py-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-4">
					<h1 class="text-xl font-semibold">Calendário</h1>
					
					<!-- Stats -->
					<div class="flex items-center gap-3">
						<div class="flex items-center gap-1.5">
							<div class="h-2 w-2 rounded-full bg-blue-500"></div>
							<span class="text-sm text-muted-foreground">{stats.scheduled} agendados</span>
						</div>
						<div class="flex items-center gap-1.5">
							<div class="h-2 w-2 rounded-full bg-green-500"></div>
							<span class="text-sm text-muted-foreground">{stats.posted} postados</span>
						</div>
						<div class="flex items-center gap-1.5">
							<div class="h-2 w-2 rounded-full bg-red-500"></div>
							<span class="text-sm text-muted-foreground">{stats.missed} perdidos</span>
						</div>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" onclick={handleExportAll} disabled={scheduledPosts.filter(p => p.schedulingStatus === 'scheduled').length === 0}>
						<Download class="h-4 w-4" />
						Exportar ICS
					</Button>
					<Button variant="outline" size="sm" onclick={() => settingsOpen = true}>
						<Settings class="h-4 w-4" />
					</Button>
					<Button onclick={() => goto('/posts/create')}>
						Criar Post
					</Button>
				</div>
			</div>
		</div>

		<!-- Calendar -->
		<main class="flex-1 overflow-hidden p-6">
			<div class="mx-auto h-full max-w-6xl">
				<!-- Month Navigation -->
				<div class="mb-4 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Button variant="outline" size="sm" onclick={previousMonth}>
							<ChevronLeft class="h-4 w-4" />
						</Button>
						<Button variant="outline" size="sm" onclick={nextMonth}>
							<ChevronRight class="h-4 w-4" />
						</Button>
						<Button variant="ghost" size="sm" onclick={goToToday}>
							Hoje
						</Button>
					</div>
					<h2 class="text-lg font-medium capitalize">{formatMonthHeader(currentDate)}</h2>
					<div class="w-32"></div> <!-- Spacer for alignment -->
				</div>

				<!-- Calendar Grid -->
				<div class="h-[calc(100%-3rem)] overflow-hidden rounded-none border border-border bg-background">
					{#if isLoading}
						<div class="flex h-full items-center justify-center">
							<svg class="h-8 w-8 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
						</div>
					{:else}
						<!-- Weekday Headers -->
						<div class="grid grid-cols-7 border-b border-border">
							{#each ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'] as day}
								<div class="border-r border-border p-2 text-center text-sm font-medium text-muted-foreground last:border-r-0">
									{day}
								</div>
							{/each}
						</div>

						<!-- Days Grid -->
						<div class="grid h-[calc(100%-2.5rem)] grid-cols-7 grid-rows-6">
							{#each calendarDays as { date, isCurrentMonth }, i}
								{@const dayPosts = getPostsForDay(date)}
								{@const isToday = isSameDay(date, todayDate)}
								<button
									type="button"
									class="relative flex flex-col border-b border-r border-border p-1 text-left transition-colors last:border-r-0 hover:bg-muted/50 {!isCurrentMonth ? 'bg-muted/30' : ''} {isToday ? 'bg-primary/5' : ''}"
									onclick={() => handleDayClick(date)}
									disabled={dayPosts.length === 0}
								>
									<!-- Day Number -->
									<span class="mb-1 flex h-6 w-6 items-center justify-center text-sm {!isCurrentMonth ? 'text-muted-foreground' : ''} {isToday ? 'rounded-full bg-primary text-primary-foreground' : ''}">
										{date.day}
									</span>

									<!-- Posts Preview -->
									<div class="flex flex-1 flex-col gap-0.5 overflow-hidden">
										{#each dayPosts.slice(0, 3) as post}
											<div class="flex items-center gap-1 rounded-none px-1 py-0.5 text-xs {getStatusColor(post.schedulingStatus)}">
												{#if post.schedulingStatus === 'posted'}
													<Check class="h-2.5 w-2.5 shrink-0" />
												{:else if post.schedulingStatus === 'missed'}
													<AlertCircle class="h-2.5 w-2.5 shrink-0" />
												{:else}
													<Clock class="h-2.5 w-2.5 shrink-0" />
												{/if}
												<span class="truncate">{formatTime(post.scheduledFor ?? 0)}</span>
											</div>
										{/each}
										{#if dayPosts.length > 3}
											<span class="px-1 text-[10px] text-muted-foreground">
												+{dayPosts.length - 3} mais
											</span>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</main>
	</SignedIn>
</div>

<!-- Settings Panel -->
{#if settingsOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-40 bg-black/30"
		onclick={() => settingsOpen = false}
		onkeydown={(e) => e.key === 'Escape' && (settingsOpen = false)}
		role="button"
		tabindex="-1"
	></div>

	<!-- Settings Panel -->
	<div class="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-border bg-background shadow-xl">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-border px-4 py-3">
			<h3 class="font-medium">Configurações do Calendário</h3>
			<button
				type="button"
				class="rounded-none p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() => settingsOpen = false}
			>
				<svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-4">
			<p class="text-sm text-muted-foreground">
				Na beta, os posts ficam só no Vanda. Use Exportar ICS no calendário ou Baixar ICS ao agendar para lembrar no seu app de agenda.
			</p>
		</div>
	</div>
{/if}

<!-- Day Detail Popover -->
{#if selectedDay && dayDetailOpen}
	{@const dayPosts = getPostsForDay(selectedDay)}
	
	<!-- Backdrop -->
	<div 
		class="fixed inset-0 z-40 bg-black/30"
		onclick={() => dayDetailOpen = false}
		onkeydown={(e) => e.key === 'Escape' && (dayDetailOpen = false)}
		role="button"
		tabindex="-1"
	></div>

	<!-- Detail Panel -->
	<div class="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-border bg-background shadow-xl">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-border px-4 py-3">
			<h3 class="font-medium capitalize">{formatFullDate(selectedDay)}</h3>
			<button
				type="button"
				class="rounded-none p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() => dayDetailOpen = false}
			>
				<svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Posts List -->
		<div class="flex-1 overflow-y-auto p-4">
			<div class="space-y-4">
				{#each dayPosts as post}
					<div class="rounded-none border border-border bg-card p-4">
						<!-- Time and Status -->
						<div class="mb-3 flex items-center justify-between">
							<span class="text-sm font-medium">{formatTime(post.scheduledFor ?? 0)}</span>
							<Badge variant="outline" class={getStatusColor(post.schedulingStatus)}>
								{getStatusLabel(post.schedulingStatus)}
							</Badge>
						</div>

						<!-- Image Preview -->
						{#if post.imageUrl}
							<div class="mb-3 aspect-square w-full overflow-hidden border border-border bg-muted">
								<img src={post.imageUrl} alt="Post preview" class="h-full w-full object-cover" />
							</div>
						{/if}

						<!-- Caption -->
						<p class="mb-3 text-sm leading-relaxed text-muted-foreground">
							{truncateCaption(post.caption)}
						</p>

						<!-- Project -->
						{#if post.projectName}
							<div class="mb-3 flex items-center gap-2">
								{#if post.projectProfilePicture}
									<img 
										src={post.projectProfilePicture} 
										alt={post.projectName}
										class="h-5 w-5 rounded-full border border-border"
									/>
								{/if}
								<span class="text-xs text-muted-foreground">{post.projectName}</span>
							</div>
						{/if}

						<!-- Actions -->
						<div class="flex gap-2">
							{#if post.schedulingStatus === 'scheduled'}
								<Button size="sm" variant="outline" class="flex-1" onclick={() => handleMarkAsPosted(post._id)}>
									<Check class="h-4 w-4" />
									Marcar como Postado
								</Button>
							{/if}
							<Button size="sm" variant="ghost" onclick={() => goto(`/posts/${post._id}`)}>
								Ver Post
							</Button>
							{#if post.schedulingStatus === 'scheduled'}
								<Button size="sm" variant="ghost" class="text-destructive hover:text-destructive" onclick={() => handleUnschedule(post._id)}>
									Cancelar
								</Button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

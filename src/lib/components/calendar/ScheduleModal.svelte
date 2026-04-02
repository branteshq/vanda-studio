<script lang="ts">
	import { Button, Badge, Label, Input, Popover, PopoverTrigger, PopoverContent } from "$lib/components/ui";
	import { Calendar } from "$lib/components/ui/calendar";
	import { useConvexClient } from "convex-svelte";
	import { api } from "../../../convex/_generated/api.js";
	import type { Id } from "../../../convex/_generated/dataModel.js";
	import { CalendarDate, getLocalTimeZone, today } from "@internationalized/date";
	import { ChevronDown, X, Clock, Calendar as CalendarIcon, Download } from "lucide-svelte";
	import { generateICS } from "$lib/utils.js";
	import { formatUserFacingMessage } from "$lib/errors";

	type Props = {
		open: boolean;
		onclose: () => void;
		postId: Id<"generated_posts">;
		caption: string;
		imageUrl: string | null;
		projectName?: string | undefined;
	};

	let { open, onclose, postId, caption, imageUrl, projectName }: Props = $props();

	const client = useConvexClient();

	// Scheduling state
	let selectedDate = $state<CalendarDate>(today(getLocalTimeZone()).add({ days: 1 }));
	let selectedTime = $state("12:00");
	let reminderMinutes = $state<number | undefined>(30);
	let isScheduling = $state(false);
	let error = $state<string | null>(null);
	let datePickerOpen = $state(false);

	// Reminder options
	const reminderOptions = [
		{ value: undefined, label: "Sem lembrete" },
		{ value: 15, label: "15 minutos antes" },
		{ value: 30, label: "30 minutos antes" },
		{ value: 60, label: "1 hora antes" },
		{ value: 1440, label: "1 dia antes" },
	];

	// Format date for display
	function formatDisplayDate(date: CalendarDate): string {
		const jsDate = date.toDate(getLocalTimeZone());
		return jsDate.toLocaleDateString('pt-BR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}

	// Get scheduled timestamp from date and time
	function getScheduledTimestamp(): number {
		const [hours, minutes] = selectedTime.split(':').map(Number);
		const jsDate = selectedDate.toDate(getLocalTimeZone());
		jsDate.setHours(hours ?? 0, minutes ?? 0, 0, 0);
		return jsDate.getTime();
	}

	// Format scheduled time for display
	function formatScheduledDateTime(): string {
		const timestamp = getScheduledTimestamp();
		const date = new Date(timestamp);
		return date.toLocaleString('pt-BR', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Check if scheduled time is valid (in the future)
	let isValidTime = $derived(getScheduledTimestamp() > Date.now());

	// Handle schedule
	async function handleSchedule() {
		if (!isValidTime) {
			error = "A data e hora devem ser no futuro";
			return;
		}

		isScheduling = true;
		error = null;

		try {
			await client.mutation(api.scheduledPosts.schedulePost, {
				postId,
				scheduledFor: getScheduledTimestamp(),
				...(reminderMinutes !== undefined && { reminderMinutes }),
			});

			onclose();
		} catch (err) {
			error = formatUserFacingMessage(err);
		} finally {
			isScheduling = false;
		}
	}

	// Handle ICS download
	function handleDownloadICS() {
		const scheduledFor = getScheduledTimestamp();
		const icsContent = generateICS({
			title: `Postar no Instagram${projectName ? ` - ${projectName}` : ''}`,
			description: caption,
			startTime: scheduledFor,
			reminderMinutes,
		});

		const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `vanda-post-${new Date(scheduledFor).toISOString().split('T')[0]}.ics`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	// Truncate caption for preview
	function truncateCaption(text: string, maxLength: number = 150): string {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength).trim() + '...';
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div 
		class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
		onclick={onclose}
		onkeydown={(e) => e.key === 'Escape' && onclose()}
		role="button"
		tabindex="-1"
	></div>

	<!-- Modal -->
	<div class="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 border border-border bg-background shadow-lg">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-border px-6 py-4">
			<div class="flex items-center gap-2">
				<CalendarIcon class="h-5 w-5 text-primary" />
				<h2 class="text-lg font-semibold">Agendar Post</h2>
			</div>
			<button
				type="button"
				class="rounded-none p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={onclose}
			>
				<X class="h-5 w-5" />
			</button>
		</div>

		<!-- Content -->
		<div class="flex gap-6 p-6">
			<!-- Left: Post Preview -->
			<div class="w-48 shrink-0 space-y-3">
				<Label class="text-xs text-muted-foreground">Preview</Label>
				{#if imageUrl}
					<div class="aspect-square overflow-hidden border border-border bg-muted">
						<img src={imageUrl} alt="Post preview" class="h-full w-full object-cover" />
					</div>
				{:else}
					<div class="flex aspect-square items-center justify-center border border-dashed border-border bg-muted/50">
						<span class="text-xs text-muted-foreground">Sem imagem</span>
					</div>
				{/if}
				<p class="text-xs leading-relaxed text-muted-foreground">
					{truncateCaption(caption)}
				</p>
				{#if projectName}
					<Badge variant="outline" class="text-xs">{projectName}</Badge>
				{/if}
			</div>

			<!-- Right: Scheduling Options -->
			<div class="flex-1 space-y-5">
				<!-- Date Selection -->
				<div class="space-y-2">
					<Label>Data</Label>
					<Popover bind:open={datePickerOpen}>
						<PopoverTrigger class="w-full">
							<button
								type="button"
								class="flex h-10 w-full items-center justify-between border border-border bg-background px-3 text-sm hover:bg-muted"
							>
								<span class="capitalize">{formatDisplayDate(selectedDate)}</span>
								<ChevronDown class="h-4 w-4 text-muted-foreground" />
							</button>
						</PopoverTrigger>
						<PopoverContent class="w-auto p-0" align="start">
							<Calendar
								type="single"
								value={selectedDate}
								minValue={today(getLocalTimeZone())}
								onValueChange={(value) => {
									if (value) selectedDate = value as CalendarDate;
									datePickerOpen = false;
								}}
								class="rounded-none"
							/>
						</PopoverContent>
					</Popover>
				</div>

				<!-- Time Selection -->
				<div class="space-y-2">
					<Label>Horário</Label>
					<div class="relative">
						<Clock class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							type="time"
							bind:value={selectedTime}
							class="pl-10"
						/>
					</div>
				</div>

				<!-- Reminder Selection -->
				<div class="space-y-2">
					<Label>Lembrete</Label>
					<div class="grid grid-cols-2 gap-2">
						{#each reminderOptions as option}
							<button
								type="button"
								class="h-9 rounded-none border px-3 text-sm transition-colors {reminderMinutes === option.value
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border bg-background hover:bg-muted'}"
								onclick={() => reminderMinutes = option.value}
							>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Summary -->
				<div class="rounded-none border border-border bg-muted/30 p-4">
					<div class="flex items-start gap-3">
						<div class="mt-0.5 rounded-none bg-primary/10 p-2">
							<CalendarIcon class="h-4 w-4 text-primary" />
						</div>
						<div class="space-y-1">
							<p class="text-sm font-medium">Agendado para</p>
							<p class="text-sm text-muted-foreground capitalize">
								{formatScheduledDateTime()}
							</p>
							{#if reminderMinutes}
								<p class="text-xs text-muted-foreground">
									Lembrete {reminderMinutes >= 60 
										? `${reminderMinutes / 60} hora${reminderMinutes >= 120 ? 's' : ''}` 
										: `${reminderMinutes} minutos`} antes
								</p>
							{/if}
						</div>
					</div>
				</div>

				<!-- Error -->
				{#if error}
					<div class="rounded-none border border-destructive/50 bg-destructive/10 p-3">
						<p class="text-sm text-destructive">{error}</p>
					</div>
				{/if}

			</div>
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-between border-t border-border px-6 py-4">
			<Button variant="outline" size="sm" onclick={handleDownloadICS}>
				<Download class="h-4 w-4" />
				Baixar ICS
			</Button>
			<div class="flex gap-2">
				<Button variant="outline" onclick={onclose}>
					Cancelar
				</Button>
				<Button 
					onclick={handleSchedule} 
					disabled={isScheduling || !isValidTime}
				>
					{#if isScheduling}
						<svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						Agendando...
					{:else}
						Agendar Post
					{/if}
				</Button>
			</div>
		</div>
	</div>
{/if}

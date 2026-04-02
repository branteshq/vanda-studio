<script lang="ts">
	import "../app.css";
	import { env } from "$env/dynamic/public";
	import { ClerkProvider } from "svelte-clerk";
	import { setupConvex } from "convex-svelte";
	import { ModeWatcher } from "mode-watcher";
	import { Toaster } from "svelte-sonner";
	import ConvexClerkProvider from "$lib/components/convex-clerk-provider.svelte";
	import CommandPalette from "$lib/components/CommandPalette.svelte";
	import { goto } from "$app/navigation";
	import type { Appearance } from "@clerk/types";

	const { children } = $props();

	let commandPaletteOpen = $state(false);

	function handleGlobalKeydown(e: KeyboardEvent) {
		const meta = e.metaKey || e.ctrlKey;

		// ⌘K — Toggle command palette
		if (meta && !e.shiftKey && e.key.toLowerCase() === "k") {
			e.preventDefault();
			commandPaletteOpen = !commandPaletteOpen;
			return;
		}

		// ⌘⇧O — Criar post
		if (meta && e.shiftKey && e.key.toLowerCase() === "o") {
			e.preventDefault();
			goto("/posts/create");
			return;
		}
	}

	// Set up Convex first (without auth)
	const convexUrl = env.PUBLIC_CONVEX_URL;
	if (convexUrl) {
		setupConvex(convexUrl);
	}

	const clerkAppearance: Appearance = {
		variables: {
			borderRadius: "0px",
			fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
			colorBackground: "var(--popover)",
			colorText: "var(--foreground)",
			colorTextSecondary: "var(--muted-foreground)",
			colorPrimary: "var(--primary)",
			colorInputBackground: "var(--input)",
			colorInputText: "var(--foreground)",
			colorNeutral: "var(--foreground)",
		},
		elements: {
			card: "bg-popover shadow-md border border-border",
			userButtonPopoverCard: "bg-popover border border-border",
			userButtonPopoverMain: "bg-popover",
			userButtonPopoverActions: "bg-popover",
			userButtonPopoverActionButton: "text-foreground hover:bg-muted",
			userButtonPopoverActionButtonText: "text-foreground",
			userButtonPopoverActionButtonIcon: "text-muted-foreground",
			userButtonPopoverFooter: "hidden",
			userPreviewMainIdentifier: "text-foreground",
			userPreviewSecondaryIdentifier: "text-muted-foreground",
		},
	};
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<ModeWatcher defaultMode="light" />
<Toaster
	position="bottom-right"
	closeButton
	duration={9000}
	theme="light"
	toastOptions={{
		unstyled: true,
		classes: {
			toast:
				"group pointer-events-auto flex w-[min(100vw-2rem,22rem)] items-start gap-3 rounded-none border border-border bg-card p-4 text-left text-card-foreground shadow-md",
			title: "pr-7 text-sm font-semibold tracking-tight text-foreground",
			description: "mt-1.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground",
			closeButton:
				"absolute right-2 top-2 rounded-none border border-transparent p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
			actionButton:
				"mt-3 shrink-0 self-start rounded-none border border-primary bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
			error: "!bg-card !text-foreground border-destructive/45",
			success: "!bg-card border-emerald-600/25",
			warning: "!bg-card border-amber-500/35",
			info: "!bg-card",
		},
	}}
/>

<ClerkProvider appearance={clerkAppearance}>
	<div class="ambient-glow ambient-noise min-h-screen">
		{#if env.PUBLIC_CONVEX_URL}
			<ConvexClerkProvider>
				{@render children()}
				<CommandPalette open={commandPaletteOpen} onclose={() => commandPaletteOpen = false} />
			</ConvexClerkProvider>
		{:else}
			<div class="flex min-h-screen items-center justify-center">
				<div class="text-center">
					<h1 class="text-xl font-semibold text-destructive">Missing Configuration</h1>
					<p class="mt-2 text-sm text-muted-foreground">
						PUBLIC_CONVEX_URL environment variable is not set.
					</p>
				</div>
			</div>
		{/if}
	</div>
</ClerkProvider>

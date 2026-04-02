<script lang="ts">
	import { SignedIn, SignedOut, SignInButton, useClerkContext } from "svelte-clerk";
	import { useConvexClient } from "convex-svelte";
	import { api } from "../../convex/_generated/api.js";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { Tabs } from "bits-ui";
	import Navbar from "$lib/components/Navbar.svelte";
	import { Button } from "$lib/components/ui";
	import { formatUserFacingMessage } from "$lib/errors";
	import {
		AccountSidebar,
		AccountTab,
		PlansTab,
		PreferencesTab,
	} from "$lib/components/account";

	const clerk = useClerkContext();
	const client = useConvexClient();

	// ── Billing data ──────────────────────────────────────────
	type AccessStatus = "trialing" | "active" | "expired" | "trial_eligible" | "none";
	type SubscriptionData = {
		subscription: {
			plan: string;
			monthlyCreditsIncluded: number;
			monthlyCreditsUsed: number;
			monthlyCreditsRemaining: number;
			totalCreditsRemaining: number;
			periodEnd?: number;
			resetAt?: number;
		};
		accessStatus: AccessStatus;
		trialEligible: boolean;
	};
	type BillingOverview = {
		activePlanId: string | null;
		scheduledPlan: { id: string; startsAt: number | null } | null;
		accessStatus: AccessStatus;
		trialEligible: boolean;
		renewalAt: number | null;
		usage: {
			monthlyIncluded: number;
			monthlyUsed: number;
			monthlyRemaining: number;
			extraIncluded: number;
			extraRemaining: number;
			totalRemaining: number;
			nextResetAt?: number;
		};
	};

	let billingOverview = $state<BillingOverview | null>(null);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let subscriptionData = $state<SubscriptionData | null>(null);

	async function loadCustomer() {
		isLoading = true;
		loadError = null;
		try {
			const data = await client.action(
				(api as any).billing.autumn.getBillingOverview,
				{}
			);
			billingOverview = data ?? null;
		} catch (err) {
			loadError = formatUserFacingMessage(err);
			billingOverview = null;
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		void loadCustomer();
	});

	// Scheduled plan (pending downgrade)
	let scheduledPlan = $state<{ id: string; startsAt: number } | null>(null);

	$effect(() => {
		if (!billingOverview) {
			subscriptionData = null;
			scheduledPlan = null;
			return;
		}

		scheduledPlan = billingOverview.scheduledPlan?.startsAt
			? {
					id: billingOverview.scheduledPlan.id,
					startsAt: billingOverview.scheduledPlan.startsAt,
				}
			: null;

		subscriptionData = {
			subscription: {
				plan: billingOverview.activePlanId ?? "",
				monthlyCreditsIncluded: billingOverview.usage.monthlyIncluded,
				monthlyCreditsUsed: billingOverview.usage.monthlyUsed,
				monthlyCreditsRemaining: billingOverview.usage.monthlyRemaining,
				totalCreditsRemaining: billingOverview.usage.totalRemaining,
				...(billingOverview.renewalAt
					? { periodEnd: billingOverview.renewalAt }
					: {}),
				...(billingOverview.usage.nextResetAt
					? { resetAt: billingOverview.usage.nextResetAt }
					: {}),
			},
			accessStatus: billingOverview.accessStatus,
			trialEligible: billingOverview.trialEligible,
		};
	});

	// ── Tab state ─────────────────────────────────────────────
	const validTabs = ["conta", "planos", "preferencias"];

	function getInitialTab(): string {
		const hash = $page.url.hash?.replace("#", "");
		return validTabs.includes(hash) ? hash : "conta";
	}

	let activeTab = $state(getInitialTab());

	$effect(() => {
		if (activeTab && typeof window !== "undefined") {
			const currentHash = window.location.hash.replace("#", "");
			if (currentHash !== activeTab) {
				history.replaceState(null, "", `/account#${activeTab}`);
			}
		}
	});

	// ── URL params ────────────────────────────────────────────
	let expired = $derived(
		$page.url.searchParams.get("expired") === "true"
	);

	// ── Upgrade state ─────────────────────────────────────────
	let isUpgrading = $state<string | null>(null);
	let upgradeError = $state<string | null>(null);
	let isOpeningPortal = $state(false);
	let portalError = $state<string | null>(null);

	async function handleUpgrade(
		planId: "basico" | "mediano" | "profissional"
	) {
		isUpgrading = planId;
		upgradeError = null;

		try {
			const result = await client.action(
				(api as any).billing.autumn.startCheckout,
				{ planId }
			);
			if (result?.checkoutUrl) {
				window.location.href = result.checkoutUrl;
				return;
			}

			const attachResult = await client.action(
				(api as any).billing.autumn.attachPlan,
				{ planId }
			);
			if (attachResult?.checkoutUrl) {
				window.location.href = attachResult.checkoutUrl;
				return;
			}

			goto("/billing/success");
		} catch (err) {
			upgradeError = formatUserFacingMessage(err);
			isUpgrading = null;
		}
	}

	async function handleManageBilling() {
		isOpeningPortal = true;
		portalError = null;

		try {
			const result = await client.action(
				(api as any).billing.autumn.getBillingPortalUrl,
				{}
			);
			if (result?.url) {
				window.location.href = result.url;
				return;
			}
			throw new Error("Não foi possível abrir o portal de cobrança");
		} catch (err) {
			portalError = formatUserFacingMessage(err);
			isOpeningPortal = false;
		}
	}

	// ── Tab metadata ──────────────────────────────────────────
	const tabs = [
		{
			value: "conta",
			label: "Conta",
			icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
		},
		{
			value: "planos",
			label: "Planos",
			icon: "M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z",
		},
		{
			value: "preferencias",
			label: "Preferências",
			icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
		},
	];
</script>

<svelte:head>
	<title>Conta - Vanda Studio</title>
</svelte:head>

<div class="flex h-screen flex-col bg-background">
	<Navbar />

	<SignedOut>
		<div class="flex flex-1 flex-col items-center justify-center gap-6 py-20">
			<div class="text-center">
				<h2 class="text-2xl font-bold">Entre para acessar sua conta</h2>
				<p class="mt-2 text-muted-foreground">
					Faça login para gerenciar seu perfil e assinatura
				</p>
			</div>
			<SignInButton mode="modal">
				<button class="btn-glow h-9 rounded-none border border-border bg-background px-4 text-sm font-medium hover:bg-muted hover:border-primary/50 transition-all">
					Entrar
				</button>
			</SignInButton>
		</div>
	</SignedOut>

	<SignedIn>
		<div class="flex flex-1 overflow-hidden">
			<!-- Left sidebar (desktop) -->
			<AccountSidebar
				user={clerk.user}
				{subscriptionData}
				{isLoading}
			/>

			<!-- Right content area -->
			<main class="flex-1 overflow-y-auto">
				<Tabs.Root bind:value={activeTab} class="flex h-full flex-col">
					<!-- Tab triggers -->
					<div class="shrink-0 border-b border-border bg-background/50 backdrop-blur-sm sticky top-0 z-10">
						<div class="flex items-center px-6 lg:px-8 pt-5 pb-0">
							<h1 class="text-2xl font-bold font-serif mr-8">Configurações</h1>
						</div>
						<Tabs.List class="flex gap-0 px-6 lg:px-8 -mb-px">
							{#each tabs as tab}
								<Tabs.Trigger
									value={tab.value}
									class="group flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors
										data-[state=active]:border-primary data-[state=active]:text-foreground
										data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground
										hover:text-foreground"
								>
									<svg
										class="h-4 w-4"
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										stroke-width="1.5"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d={tab.icon}
										/>
									</svg>
									{tab.label}
								</Tabs.Trigger>
							{/each}
						</Tabs.List>
					</div>

					<!-- Tab content -->
					<div class="flex-1 p-6 lg:p-8">
						<Tabs.Content value="conta" class="focus-visible:outline-none">
							<AccountTab
								user={clerk.user}
								clerkInstance={clerk.clerk}
							/>
						</Tabs.Content>

						<Tabs.Content value="planos" class="focus-visible:outline-none">
							<PlansTab
								{subscriptionData}
								{isLoading}
								{expired}
								{scheduledPlan}
								onUpgrade={handleUpgrade}
								onManageBilling={handleManageBilling}
								{isUpgrading}
								{upgradeError}
								{isOpeningPortal}
								{portalError}
							/>
						</Tabs.Content>

						<Tabs.Content value="preferencias" class="focus-visible:outline-none">
							<PreferencesTab />
						</Tabs.Content>
					</div>
				</Tabs.Root>
			</main>
		</div>
	</SignedIn>
</div>

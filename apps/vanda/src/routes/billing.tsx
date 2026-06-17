import { Show, SignInButton } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";

export const Route = createFileRoute("/billing")({
	component: BillingRoute,
});

function BillingRoute() {
	const getOverview = useAction(api.billing.autumn.getBillingOverview);
	const startCheckout = useAction(api.billing.autumn.startCheckout);
	const getPortal = useAction(api.billing.autumn.getBillingPortalUrl);
	const [summary, setSummary] = useState<string>("Not loaded");
	const [busy, setBusy] = useState(false);

	async function loadBilling() {
		setBusy(true);
		try {
			const overview = await getOverview();
			setSummary(JSON.stringify(overview ?? { status: "no customer" }, null, 2));
		} catch (error) {
			setSummary(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	}

	async function checkout() {
		setBusy(true);
		try {
			const result = await startCheckout({ planId: "basico" });
			if (result.checkoutUrl) window.location.href = result.checkoutUrl;
			else setSummary("Checkout returned no URL.");
		} catch (error) {
			setSummary(error instanceof Error ? error.message : String(error));
			setBusy(false);
		}
	}

	async function portal() {
		setBusy(true);
		try {
			const result = await getPortal();
			if (result.url) window.location.href = result.url;
			else setSummary("Billing portal returned no URL.");
		} catch (error) {
			setSummary(error instanceof Error ? error.message : String(error));
			setBusy(false);
		}
	}

	return (
		<main className="route-panel panel">
			<p className="eyebrow">billing sanity</p>
			<Show when="signed-out">
				<h1>Sign in to test billing.</h1>
				<div className="actions">
					<SignInButton mode="modal">
						<button className="btn" type="button">
							Sign in
						</button>
					</SignInButton>
				</div>
			</Show>
			<Show when="signed-in">
				<h1>Autumn wiring.</h1>
				<p className="lede">This page only checks checkout, customer overview, and portal links.</p>
				<div className="actions">
					<button className="btn secondary" type="button" disabled={busy} onClick={loadBilling}>
						Load overview
					</button>
					<button className="btn" type="button" disabled={busy} onClick={checkout}>
						Start Basico checkout
					</button>
					<button className="btn secondary" type="button" disabled={busy} onClick={portal}>
						Open portal
					</button>
				</div>
				<pre className="card">{summary}</pre>
			</Show>
		</main>
	);
}

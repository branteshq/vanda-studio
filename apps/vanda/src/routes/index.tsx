import { createFileRoute } from "@tanstack/react-router";
import { Instagram, ShieldCheck, Sparkles } from "lucide-react";
import { getAppUrl } from "../appUrl";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="main">
			<section className="hero">
				<div className="panel">
					<p className="eyebrow">TanStack Start rebuild</p>
					<h1>Blank slate, live wiring.</h1>
					<p className="lede">
						The old product UI is gone. This placeholder keeps the boring but critical
						parts online: Clerk auth, Convex data, Autumn billing, OpenRouter env, and
						Instagram Graph OAuth.
					</p>
					<div className="actions">
						<a href={getAppUrl("/app")} className="btn">
							<ShieldCheck size={18} /> Check auth
						</a>
						<a href={getAppUrl("/instagram")} className="btn instagram">
							<Instagram size={18} /> Connect Instagram
						</a>
					</div>
				</div>
				<div className="panel dark">
					<p className="eyebrow">integration surface</p>
					<div className="stack">
						<div className="check">
							<span>TanStack Start</span>
							<span className="status">active</span>
						</div>
						<div className="check">
							<span>Clerk</span>
							<span className="status">provider</span>
						</div>
						<div className="check">
							<span>Convex</span>
							<span className="status">minimal</span>
						</div>
						<div className="check">
							<span>Instagram Graph</span>
							<span className="status">oauth</span>
						</div>
					</div>
				</div>
			</section>

			<section className="grid" aria-label="Remaining product primitives">
				<div className="card">
					<Sparkles size={20} />
					<h2>OpenRouter</h2>
					<p className="muted">Env kept for the next agent/operator pass.</p>
				</div>
				<div className="card">
					<ShieldCheck size={20} />
					<h2>Billing</h2>
					<p className="muted">Autumn checkout and portal actions remain in Convex.</p>
				</div>
				<div className="card">
					<Instagram size={20} />
					<h2>Instagram</h2>
					<p className="muted">Connections are now user-owned, not project-owned.</p>
				</div>
			</section>
		</main>
	);
}

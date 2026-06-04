import { AuthStatus } from "./components/AuthStatus";
import { Dashboard } from "./components/Dashboard";
import { VandaCopilotSidebar } from "./components/VandaCopilotSidebar";

const prompts = [
  "Vanda, fetch my latest Instagram post",
  "Vanda, what post hit hardest this month?",
  "Vanda, what are my current account stats?",
  "Vanda, summarize my Instagram performance",
  "Vanda, what should I post next based on what worked recently?",
];

export default function Page() {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Throwaway CopilotKit POC</span>
          <h1>Vanda is becoming an agentic social media operator.</h1>
          <p>
            This sidecar app demonstrates natural language prompts flowing into read-only project, account, and
            Instagram post data, then back into a dynamic operator response.
          </p>
        </div>
        <div className="prompt-box">
          <h2>Try these prompts</h2>
          <ul>
            {prompts.map((prompt) => (
              <li key={prompt}>{prompt}</li>
            ))}
          </ul>
        </div>
      </section>

      <AuthStatus />
      <Dashboard />
      <VandaCopilotSidebar />
    </main>
  );
}

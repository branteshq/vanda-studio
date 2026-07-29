import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/conversa")({
  component: ConversaPage,
});

// Placeholder shell — the conversation surface lands with the Vanda agent.
function ConversaPage() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <p className="text-sm text-text-4">A conversa com a Vanda chega em breve.</p>
    </div>
  );
}

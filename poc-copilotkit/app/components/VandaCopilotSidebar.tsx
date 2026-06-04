"use client";

import { CopilotSidebar } from "@copilotkit/react-core/v2";

export function VandaCopilotSidebar() {
  return (
    <CopilotSidebar
      defaultOpen
      labels={{
        chatInputPlaceholder: "Ask Vanda about Instagram performance...",
        welcomeMessageText: "Ask me about your Instagram posts, account stats, or recent performance.",
      }}
    />
  );
}

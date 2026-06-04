import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { CopilotProvider } from "./components/CopilotProvider";
import { loadRootEnv } from "../lib/loadRootEnv";

loadRootEnv();

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;

export const metadata = {
  title: "Vanda CopilotKit POC",
  description: "Throwaway CopilotKit POC for an agentic social media operator.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider publishableKey={clerkPublishableKey}>
          <CopilotProvider>{children}</CopilotProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

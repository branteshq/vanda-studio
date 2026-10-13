import type { ReactNode } from "react";
import { cn } from "@vanda-studio/ui/lib/utils";
import { VandaMark } from "../vanda-mark";

/** The Vanda lockup: orchid mark + wordmark, shared across every onboarding frame. */
export function OnboardingHeader() {
  return (
    <div className="flex items-center gap-2">
      <VandaMark size={18} />
      <span className="text-base tracking-tight">
        <span className="font-semibold text-text">Vanda</span>{" "}
        <span className="text-text-3">Studio</span>
      </span>
    </div>
  );
}

/** The top of every onboarding screen: the lockup, and an optional way out on the right. */
export function OnboardingTop({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-4 px-5">
      <OnboardingHeader />
      {children}
    </header>
  );
}

/** A full-screen moment outside the chat (Conectar, Guia pronto): Caetano, one line, one button. */
export function OnboardingCenter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-svh flex-col bg-app text-text antialiased", className)}>
      <OnboardingTop />
      <main className="flex flex-1 items-center justify-center px-6 pb-13">
        <div className="flex w-full max-w-105 flex-col items-center text-center">{children}</div>
      </main>
    </div>
  );
}

import type { ReactNode } from "react";
import { StatusRing } from "@vanda-studio/ui/components/status-ring";
import { cn } from "@vanda-studio/ui/lib/utils";
import { OrchidAperture } from "../orchid-aperture";
import { VandaMark } from "../vanda-mark";

export type OnboardingStep = "conectar" | "conhecer" | "confirmar";

const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: "conectar", label: "Conectar" },
  { key: "conhecer", label: "Conhecer" },
  { key: "confirmar", label: "Confirmar" },
];

/** The Vanda lockup: orchid mark + wordmark, shared across every onboarding frame. */
export function OnboardingHeader() {
  return (
    <div className="flex items-center gap-2">
      <VandaMark size={18} />
      <span className="text-[15px] tracking-[-0.01em]">
        <span className="font-semibold text-text">Vanda</span>{" "}
        <span className="text-text-3">Studio</span>
      </span>
    </div>
  );
}

/** Conectar · Conhecer · Confirmar, with rings: done / active / pending. */
export function StepIndicator({ current }: { current: OnboardingStep }) {
  const currentIndex = STEPS.findIndex((step) => step.key === current);
  return (
    <div className="hidden items-center gap-2 sm:flex">
      {STEPS.map((step, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "pending";
        return (
          <div key={step.key} className="flex items-center gap-2">
            {index > 0 ? <span className="h-px w-5 bg-border" /> : null}
            <span className="flex items-center gap-1.5">
              <StatusRing state={state} />
              <span
                className={cn(
                  "text-[12px]",
                  state === "active"
                    ? "text-text-2"
                    : state === "done"
                      ? "text-text-3"
                      : "text-text-5",
                )}
              >
                {step.label}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The login-continuity split: a calm content column on the left, the orchid
 * aperture blooming on the right. Used by Connect, Observing, and Mode (Confirm
 * uses its own centered layout). The aperture caption labels the moment.
 */
export function OnboardingSplit({
  current,
  aperture,
  children,
}: {
  current: OnboardingStep;
  aperture: { caption: string; sub?: string };
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh overflow-hidden bg-app text-text antialiased">
      <div className="relative flex w-full shrink-0 flex-col border-r border-border px-6 py-9 sm:px-12 lg:w-[47%] lg:max-w-[720px]">
        <div className="flex items-center justify-between gap-4">
          <OnboardingHeader />
          <StepIndicator current={current} />
        </div>
        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>
        <p className="text-[11.5px] text-text-5">© 2026 Vanda Studio</p>
      </div>

      <div className="relative hidden flex-1 items-center justify-center overflow-hidden bg-inset lg:flex">
        <div className="relative z-10 size-[520px] max-w-[80%]">
          <OrchidAperture />
        </div>
        <div className="absolute right-8 bottom-8 text-right">
          <p className="text-[12.5px] text-text-4">{aperture.caption}</p>
          {aperture.sub ? (
            <p className="mt-1 text-[11.5px] text-text-5">{aperture.sub}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

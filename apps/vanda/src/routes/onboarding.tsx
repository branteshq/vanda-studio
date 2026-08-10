import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useEffect, useState } from "react";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { ConfirmStep } from "../components/onboarding/confirm-step";
import { ConnectStep } from "../components/onboarding/connect-step";
import { ModeStep, type Mode } from "../components/onboarding/mode-step";
import { ObservingStep } from "../components/onboarding/observing-step";
import {
  type CorpusStats,
  type EditableAnalysis,
  toEditable,
} from "../components/onboarding/types";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): { flow?: "add"; accountId?: string } => ({
    ...(search.flow === "add" ? { flow: "add" as const } : {}),
    ...(typeof search.accountId === "string" ? { accountId: search.accountId } : {}),
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  return (
    <>
      <Show when="signed-out">
        <RedirectToSignIn />
      </Show>
      <Show when="signed-in">
        <OnboardingFlow />
      </Show>
    </>
  );
}

function OnboardingLoading() {
  return (
    <div className="grid min-h-svh place-items-center bg-app">
      <Spinner className="size-6 text-text-3" />
    </div>
  );
}

/**
 * The onboarding gate, aligned with `DashboardGate`: once any business is
 * onboarded the user is past first-time setup (-> dashboard). Explicit search
 * state targets add-business and resume flows; without it, first-time setup either
 * connects the first account or resumes its pending analysis.
 */
function OnboardingFlow() {
  const { flow, accountId } = Route.useSearch();
  const accounts = useQuery(api.accounts.listMine);
  if (accounts === undefined) return <OnboardingLoading />;
  const requested = accounts.find((account) => account.id === accountId);
  if (requested?.onboardedAt != null) return <ActivateAndRedirect accountId={requested.id} />;
  if (requested) {
    return requested.connected ? (
      <AnalyzeFlow accountId={requested.id} />
    ) : (
      <SyncConnection accountId={requested.id} />
    );
  }
  if (flow === "add") return <ConnectStep />;
  if (accounts.some((account) => account.onboardedAt != null)) {
    return <Navigate to="/conversa" />;
  }
  const pending = accounts.find((account) => account.onboardedAt == null);
  if (pending === undefined) return <ConnectStep />;
  return pending.connected ? (
    <AnalyzeFlow accountId={pending.id} />
  ) : (
    <ConnectStep accountId={pending.id} />
  );
}

/**
 * Landing spot after the publisher's connect page redirects back: pull the
 * profile once and cache the connection. On success the reactive accounts
 * query flips `connected` and the parent advances to AnalyzeFlow; on failure
 * (customer bailed out of the OAuth page) we offer the connect button again.
 */
function SyncConnection({ accountId }: { accountId: Id<"accounts"> }) {
  const sync = useAction(api.publisherConnect.syncConnection);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void sync({ accountId })
      .then((result) => {
        if (!cancelled && !result.connected) setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, sync]);

  return failed ? <ConnectStep accountId={accountId} /> : <OnboardingLoading />;
}

function ActivateAndRedirect({ accountId }: { accountId: Id<"accounts"> }) {
  const selectActive = useMutation(api.accounts.selectActive);
  const navigate = useNavigate();

  useEffect(() => {
    void selectActive({ accountId }).then(() => navigate({ to: "/conversa" }));
  }, [accountId, navigate, selectActive]);

  return <OnboardingLoading />;
}

type Step = "observing" | "confirm" | "mode";

function AnalyzeFlow({ accountId }: { accountId: Id<"accounts"> }) {
  const navigate = useNavigate();
  const approve = useMutation(api.brandProfile.approveBrandProfile);
  const [step, setStep] = useState<Step>("observing");
  const [analysis, setAnalysis] = useState<EditableAnalysis | null>(null);
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish(mode: Mode) {
    if (!analysis) return;
    setBusy(true);
    try {
      await approve({ accountId, mode, ...analysis });
      await navigate({ to: "/conversa" });
    } catch {
      setBusy(false);
    }
  }

  if (step === "observing") {
    return (
      <ObservingStep
        accountId={accountId}
        onComplete={(result) => {
          setAnalysis(toEditable(result.analysis));
          setStats(result.stats);
          setStep("confirm");
        }}
      />
    );
  }
  if (step === "confirm" && analysis && stats) {
    return (
      <ConfirmStep
        accountId={accountId}
        analysis={analysis}
        stats={stats}
        onContinue={(edited) => {
          setAnalysis(edited);
          setStep("mode");
        }}
      />
    );
  }
  if (step === "mode" && analysis) {
    return <ModeStep busy={busy} onFinish={finish} />;
  }
  return <OnboardingLoading />;
}

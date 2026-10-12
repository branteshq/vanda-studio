import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { ConnectStep } from "../components/onboarding/connect-step";
import { GuideStep } from "../components/onboarding/guide-step";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const Route = createFileRoute("/onboarding")({
  validateSearch: z.object({
    flow: z.literal("add").optional(),
    accountId: z.string().optional(),
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

type Pending = { id: Id<"accounts">; connected: boolean };

function OnboardingLoading() {
  return (
    <div className="grid min-h-svh place-items-center bg-app">
      <Spinner className="size-6 text-text-3" />
    </div>
  );
}

/**
 * The onboarding gate, aligned with `DashboardGate`: once any business is
 * onboarded the user is past first-time setup (-> app). Explicit search
 * state targets add-business and resume flows; without it, first-time setup either
 * connects the first account or resumes its pending analysis.
 */
function OnboardingFlow() {
  const { flow, accountId } = Route.useSearch();
  const accounts = useQuery(api.accounts.listMine);

  if (accounts === undefined) return <OnboardingLoading />;
  const requested = accounts.find((account) => account.id === accountId);

  if (requested?.onboardedAt != null) {
    return <GuideGate accountId={requested.id} />;
  }

  if (requested) {
    return requested.connected ? (
      <GuideGate accountId={requested.id} refresh={false} />
    ) : (
      <SyncConnection accountId={requested.id} />
    );
  }

  const pending = accounts.find((account) => account.onboardedAt == null);

  // Resume the unfinished account instead of creating another orphan one.
  if (flow === "add") return <ResumePending account={pending} />;

  // The account onboarding just finished is active: its brand guide is the last step.
  const ready = accounts.find((account) => account.onboardedAt != null && account.active);

  if (ready) return <GuideGate accountId={ready.id} refresh={false} />;

  if (accounts.some((account) => account.onboardedAt != null)) {
    return <Navigate to="/conversa" />;
  }

  return <ResumePending account={pending} />;
}

/** An unfinished account resumes where it stopped: the guide once connected, else the connect step. */
function ResumePending({ account }: { account: Pending | undefined }) {
  if (account === undefined) return <ConnectStep />;

  return account.connected ? (
    <GuideGate accountId={account.id} refresh={false} />
  ) : (
    <ConnectStep accountId={account.id} />
  );
}

/**
 * Landing spot after the publisher's connect page redirects back: pull the
 * profile (retrying briefly) and cache the connection. On success the reactive accounts
 * query flips `connected` and the parent advances to the guide; on failure
 * (customer bailed out of the OAuth page) we offer the connect button again.
 */
function SyncConnection({ accountId }: { accountId: Id<"accounts"> }) {
  const sync = useAction(api.publisherConnect.syncConnection);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Upload-Post may not have the connection yet right after the redirect, so retry a few times.
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));

        if (cancelled) return;

        try {
          const result = await sync({ accountId });

          if (result.connected) return;
        } catch {
          // Treated like "not connected yet": try again.
        }
      }

      if (!cancelled) setFailed(true);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [accountId, sync]);

  return failed ? <ConnectStep accountId={accountId} /> : <OnboardingLoading />;
}

/**
 * Connect, reconnect and the finished onboarding land here. A connected business
 * is onboarded, then an incomplete brand file keeps the owner on Caetano's guide
 * screen, where Caetano reads the account first; otherwise the app opens.
 * `refresh` re-syncs the connection first; a just-connected account is already in sync.
 */
function GuideGate({
  accountId,
  refresh = true,
}: {
  accountId: Id<"accounts">;
  refresh?: boolean;
}) {
  const sync = useAction(api.publisherConnect.syncConnection);
  const onboard = useMutation(api.brandProfile.onboard);
  const selectActive = useMutation(api.accounts.selectActive);
  const openGuide = useMutation(api.brandProfile.openGuide);
  const navigate = useNavigate();
  const [guideThreadId, setGuideThreadId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (refresh) await sync({ accountId }).catch(() => null);

      await onboard({ accountId });
      await selectActive({ accountId });
      const guide = await openGuide({ accountId });

      if (cancelled) return;

      if (guide) {
        setGuideThreadId(guide);
      } else {
        void navigate({ to: "/conversa" });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [accountId, navigate, onboard, openGuide, refresh, selectActive, sync]);

  if (guideThreadId) return <GuideStep accountId={accountId} threadId={guideThreadId} />;

  return <OnboardingLoading />;
}

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex-helpers/react/cache";
import { Button } from "@vanda-studio/ui/components/button";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Caetano, CaetanoSleepyContext } from "../caetano";
import { Conversation } from "../conversation";
import { OnboardingCenter, OnboardingTop } from "./onboarding-shell";

/**
 * Step 2 — Caetano's brand guide, a plain chat. He reads the Instagram, writes the
 * whole brand file, shows what he got in one message and asks only what the feed
 * cannot show. When the owner approves, he ends the guide (brand_guide_finish) and
 * the page turns into "Guia pronto.".
 */
export function GuideStep({
  accountId,
  threadId,
}: {
  accountId: Id<"accounts">;
  threadId: string;
}) {
  const navigate = useNavigate();
  const guide = useQuery(api.brandFile.guide, { accountId });
  // Easter egg: hovering "Terminar depois" makes Caetano sleepy.
  const [sleepy, setSleepy] = useState(false);

  const onFinish = () => void navigate({ to: "/conversa" });

  if (guide?.done) return <GuideDone onStart={onFinish} />;

  return (
    <CaetanoSleepyContext.Provider value={sleepy}>
      <div className="flex h-svh flex-col overflow-hidden bg-app text-text antialiased">
        <OnboardingTop>
          <Button
            variant="ghost"
            size="sm"
            onClick={onFinish}
            onPointerEnter={() => setSleepy(true)}
            onPointerLeave={() => setSleepy(false)}
          >
            Terminar depois
          </Button>
        </OnboardingTop>

        <div className="flex min-h-0 flex-1">
          <Conversation
            accountId={accountId}
            threadId={threadId}
            guide
            composer={{
              placeholder: "Responder ao Caetano…",
              ariaLabel: "Mensagem para o Caetano",
              agentName: "O Caetano",
              attachLabel: "Enviar foto ou logo",
            }}
          />
        </div>
      </div>
    </CaetanoSleepyContext.Provider>
  );
}

/** The guide is done: Caetano jumps (and again on click), one line, one button. */
function GuideDone({ onStart }: { onStart: () => void }) {
  return (
    <OnboardingCenter>
      <Caetano state="cheer" size={168} intro="jump" onClickMove="jump" />
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Guia pronto.</h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-text-3">
        A Vanda já usa ele em todo post. Dá pra mudar quando quiser em Perfil › Negócios.
      </p>
      <Button variant="brand" size="lg" className="mt-7" onClick={onStart}>
        Começar a criar
      </Button>
    </OnboardingCenter>
  );
}

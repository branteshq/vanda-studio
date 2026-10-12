import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex-helpers/react/cache";
import { Button } from "@vanda-studio/ui/components/button";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Conversation } from "../conversation";
import { BrandColors } from "./brand-colors";
import { OnboardingHeader, StepIndicator } from "./onboarding-shell";

/**
 * Step 3 — Caetano's brand guide, as a conversation. Caetano lives in the chat
 * (his pose shows what he is doing); either button leaves onboarding for the app.
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
  const sections = guide?.sections ?? [];
  const complete = sections.length > 0 && sections.every((section) => section.filled);

  const onFinish = () => void navigate({ to: "/conversa" });

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-app text-text antialiased">
      <div className="flex items-center justify-between gap-4 px-4 py-6 sm:px-12">
        <OnboardingHeader />
        <div className="flex items-center gap-4 sm:gap-8">
          <StepIndicator current="conversar" />
          <Button size="sm" onClick={onFinish}>
            Terminar depois
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <Conversation
          accountId={accountId}
          threadId={threadId}
          guide
          done={complete}
          intro={
            <div className="pb-2">
              <h1 className="text-3xl font-semibold leading-tight tracking-tight">
                Vamos montar o guia da sua marca
              </h1>
              <p className="mt-3 text-sm text-text-3">
                Converse com o Caetano: ele lê seu Instagram primeiro e pergunta só o que falta.
              </p>
              <p className="mt-2 text-caption text-text-5">
                Leva uns 5 minutos · dá para terminar depois
              </p>
            </div>
          }
          composer={{
            placeholder: "Responda ao Caetano…",
            ariaLabel: "Mensagem para o Caetano",
            agentName: "O Caetano",
            attachLabel: "Enviar foto ou logo",
          }}
          actions={
            <div className="flex flex-col gap-3">
              <BrandColors accountId={accountId} threadId={threadId} />
              {complete ? (
                <div className="flex justify-end">
                  <Button onClick={onFinish}>Começar a criar →</Button>
                </div>
              ) : null}
            </div>
          }
        />
      </div>
    </div>
  );
}

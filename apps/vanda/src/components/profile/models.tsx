import { useState, type ReactNode } from "react";
import {
  AnthropicIcon,
  FluxIcon,
  GeminiIcon,
  MetaIcon,
  OpenAiIcon,
} from "@vanda-studio/ui/components/model-marks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vanda-studio/ui/components/select";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import {
  DEFAULT_CAETANO_MODEL,
  DEFAULT_ORCHESTRATOR_MODEL,
  ORCHESTRATOR_MODELS,
  isTextModelAvailable,
  type ModelMaker,
} from "../../convex/agentModels";
import {
  CONECTADO_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  resolveConnectedImageModel,
  type ImageModel,
} from "../../convex/imageModels";
import { errorMessage } from "../../errors";
import { useProfileRuntime } from "./runtime";

/**
 * Vanda and image choices respect the connected transport. Caetano has an
 * independent preference and continues using Vanda's OpenRouter budget.
 */
export function ModelsCard() {
  const runtime = useProfileRuntime();

  const {
    preferences: prefs,
    setAgentModel,
    setCaetanoModel,
    setImageModel,
  } = runtime.useModelPreferences();

  const [error, setError] = useState<string | null>(null);

  const conectado = prefs?.conectado ?? false;
  const orchestratorId = prefs?.orchestrator ?? DEFAULT_ORCHESTRATOR_MODEL;
  const caetanoId = prefs?.caetano ?? DEFAULT_CAETANO_MODEL;

  const imageId = conectado
    ? resolveConnectedImageModel(prefs?.image)
    : (prefs?.image ?? DEFAULT_IMAGE_MODEL);

  const orchestrator = ORCHESTRATOR_MODELS.find((model) => model.id === orchestratorId);
  const imageModels = conectado ? CONECTADO_IMAGE_MODELS : IMAGE_MODELS;
  const image = imageModels.find((model) => model.id === imageId);

  const choose = async (action: Promise<unknown>) => {
    setError(null);

    try {
      await action;
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <div>
      <p className="text-body-sm text-text-3">
        A Vanda escolhe bons padrões. Mude aqui, ou peça na conversa, se preferir outro modelo.
      </p>

      <div className="mt-4 space-y-4">
        {[
          {
            label: "Vanda",
            ariaLabel: "Modelo de conversa",
            id: orchestratorId,
            description: orchestrator?.tagline ?? "O modelo que pensa e escreve como a Vanda.",
            setModel: setAgentModel,
          },
          {
            label: "Caetano",
            ariaLabel: "Modelo do Caetano",
            id: caetanoId,
            description: "O assistente no WhatsApp. Usa a mesma conexão da Vanda.",
            setModel: setCaetanoModel,
          },
        ].map((choice) => (
          <ModelRow
            key={choice.label}
            label={choice.label}
            description={choice.description}
            loading={prefs === undefined}
          >
            <Select
              value={choice.id}
              onValueChange={(value) => void choose(choice.setModel({ modelId: String(value) }))}
            >
              <SelectTrigger className="w-56" aria-label={choice.ariaLabel}>
                <SelectValue>
                  {(value) => {
                    const model = ORCHESTRATOR_MODELS.find((item) => item.id === value);

                    return model ? (
                      <>
                        <MakerMark maker={model.maker} />
                        <span className="truncate">{model.label}</span>
                      </>
                    ) : null;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="w-72">
                {ORCHESTRATOR_MODELS.map((model) => {
                  const blocked = !isTextModelAvailable(model, conectado);

                  return (
                    <SelectItem key={model.id} value={model.id} disabled={blocked}>
                      <span className="flex items-center gap-2">
                        <MakerMark maker={model.maker} />
                        <span className="truncate font-medium">{model.label}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-text-4">
                        {blocked ? "Indisponível pela assinatura do ChatGPT" : model.tagline}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </ModelRow>
        ))}

        <ModelRow
          label="Imagens"
          description={image?.blurb ?? "O modelo que a Vanda usa para criar e editar imagens."}
          loading={prefs === undefined}
        >
          <Select
            value={imageId}
            onValueChange={(value) => void choose(setImageModel({ modelId: String(value) }))}
          >
            <SelectTrigger className="w-56" aria-label="Modelo de imagens">
              <SelectValue>
                {(value) => {
                  const model = imageModels.find((item) => item.id === value);

                  return model ? (
                    <>
                      <MakerMark maker={model.maker} />
                      <span className="truncate">{model.label}</span>
                    </>
                  ) : null;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="w-72">
              {imageModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <span className="flex items-center gap-2">
                    <MakerMark maker={model.maker} />
                    <span className="truncate font-medium">{model.label}</span>
                    <span className="text-note font-semibold text-green">{model.priceTier}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-text-4">{model.blurb}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ModelRow>
      </div>

      {conectado ? (
        <p className="mt-4 text-xs text-text-4">
          No plano ChatGPT, Vanda, Caetano e imagens usam sua assinatura da OpenAI. Apenas modelos
          compatíveis com essa conexão ficam disponíveis.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One labelled choice: name + why it matters on the left, control on the right. */
function ModelRow({
  label,
  description,
  loading,
  children,
}: {
  label: string;
  description: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="text-body-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-text-4">{description}</p>
      </div>
      {loading ? <Skeleton className="h-9 w-56 rounded-md" /> : children}
    </div>
  );
}

/** The maker's brand mark — monochrome, inheriting the row's text color. */
function MakerMark({ maker }: { maker: ModelMaker | ImageModel["maker"] }) {
  const Icon = {
    OpenAI: OpenAiIcon,
    Anthropic: AnthropicIcon,
    Meta: MetaIcon,
    Google: GeminiIcon,
    "Black Forest Labs": FluxIcon,
  }[maker];

  return <Icon className="size-4 shrink-0 text-text-2" />;
}

import type { ContextHandler } from "@convex-dev/agent";
import { z } from "zod";
import { compactInstagramHistory } from "./instagram/toolSummary";
import { dedupeResources, threadResourceSchema } from "./resourceRefs";

export type ModelMessage = Parameters<ContextHandler>[1]["allMessages"][number];

const delegationSchema = z.object({
  data: z.record(z.string(), z.json()),
  resources: z.array(threadResourceSchema),
  presented: z.array(threadResourceSchema).optional(),
});

/** Upgrade legacy results on read; durable messages and UI manifests are untouched. */
export const compactHistory = (
  messages: ModelMessage[],
  keepImagesFrom = messages.length,
): ModelMessage[] =>
  compactInstagramHistory(messages).map((message, index) => {
    if (message.role === "user" && Array.isArray(message.content) && index < keepImagesFrom) {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "image"
            ? {
                type: "text" as const,
                text: `[Imagem histórica: pixels omitidos. Reabra pelo imageId em vanda_attachment_context antes de comparar ou editar; original preservado.]`,
              }
            : part,
        ),
      };
    }

    if (message.role !== "tool") return message;

    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;

        if (part.toolName === "ask_vanda" && part.output.type === "json") {
          const parsed = delegationSchema.safeParse(part.output.value);

          if (parsed.success) {
            const { resources: _resources, presented: _presented, ...data } = parsed.data.data;

            return {
              ...part,
              output: {
                type: "json" as const,
                value: {
                  data,
                  resources: dedupeResources([
                    ...parsed.data.resources,
                    ...(parsed.data.presented ?? []),
                  ]),
                },
              },
            };
          }
        }

        if (index >= keepImagesFrom || part.output.type !== "content") return part;

        return {
          ...part,
          output: {
            ...part.output,
            value: part.output.value.map((content) =>
              content.type.startsWith("image-") ||
              ("mediaType" in content && content.mediaType.startsWith("image/"))
                ? {
                    type: "text" as const,
                    text: "[Pixels históricos omitidos; use read/inspect_image com o imageId acima se precisar rever. A inspeção anterior não substitui uma revisão atual.]",
                  }
                : content,
            ),
          },
        };
      }),
    };
  });

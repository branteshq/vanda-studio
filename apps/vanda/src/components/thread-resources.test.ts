import { describe, expect, it } from "vitest";
import { resourcesForMessage, type PresentedResourceManifest } from "./thread-resources";
import type { UIMessage } from "@convex-dev/agent/react";

const message = (id: string, role: "user" | "assistant"): UIMessage =>
  ({ id, role, parts: [], key: id }) as unknown as UIMessage;

describe("resourcesForMessage", () => {
  it("attaches tool resources to the assistant response after their prompt", () => {
    const messages = [message("prompt", "user"), message("answer", "assistant")];
    const manifests: PresentedResourceManifest[] = [
      {
        anchorMessageId: "prompt",
        presented: [{ kind: "link", url: "https://example.com", title: "Resultado" }],
      },
    ];
    expect(resourcesForMessage(messages, 1, manifests)).toEqual(manifests[0]!.presented);
  });

  it("supports resources anchored to a standalone background message", () => {
    const messages = [message("follow-up", "assistant")];
    const manifests: PresentedResourceManifest[] = [
      {
        anchorMessageId: "follow-up",
        presented: [
          {
            kind: "operation",
            operation: "post.publish",
            status: "succeeded",
            label: "Publicado",
          },
        ],
      },
    ];
    expect(resourcesForMessage(messages, 0, manifests)).toEqual(manifests[0]!.presented);
  });
});

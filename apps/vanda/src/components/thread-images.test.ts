// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadResource } from "../convex/resourceRefs";
import { ThreadResourceList } from "./thread-resources";
import { ThreadImage } from "./thread-images";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  rename: vi.fn().mockResolvedValue(null),
  remove: vi.fn().mockResolvedValue(null),
  copy: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("convex-helpers/react/cache", () => ({ useQuery: mocks.query }));
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "gallery:rename" ? mocks.rename : mocks.remove,
}));
vi.mock("./media-tile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media-tile")>()),
  copyImageToClipboard: mocks.copy,
  downloadImageFile: mocks.download,
}));
vi.mock("thinking-orbs", () => ({ ThinkingOrb: () => null }));

const image = {
  id: "image-a",
  url: "https://example.com/a.png",
  name: "Coado da manhã",
  model: "openai/gpt-image-2",
  prompt: "Cafeteria brasileira com luz da manhã",
  width: 1024,
  height: 1024,
  generationMs: 132_000,
  costUsd: 0.2117,
  createdAt: 1_788_551_122_000,
  origin: "generated",
  edited: false,
  promptAuthor: "vanda",
};
const resource = { kind: "image", accountId: "account-a", imageId: "image-a" } as Extract<
  ThreadResource,
  { kind: "image" }
>;
let root: Root;
let container: HTMLDivElement;

const button = (label: string, scope: ParentNode = document) => {
  const result = scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`button not found: ${label}`);
  return result;
};
const click = async (target: HTMLElement) => {
  await act(async () => target.click());
};
const render = async (resources: ThreadResource[] = [resource]) => {
  await act(async () => root.render(createElement(ThreadResourceList, { resources })));
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.query.mockImplementation((_ref, args) => (args === "skip" ? undefined : image));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("thread image presentation", () => {
  it("uses the same card for generated and presented images", async () => {
    await render();
    const presented = container.innerHTML;
    expect(container.querySelector("a")).toBeNull();
    expect(button("Copiar imagem", container)).toBeDefined();
    expect(button("Baixar", container)).toBeDefined();
    expect(button("Excluir", container)).toBeDefined();
    expect(container.textContent).toContain("GPT Image 2");
    expect(container.querySelector("img")?.parentElement?.parentElement?.style.aspectRatio).toBe(
      "1 / 1",
    );
    await act(async () =>
      root.render(
        createElement(ThreadImage, {
          accountId: resource.accountId,
          image: { imageId: resource.imageId, width: 1024, height: 1024 },
          onOpen: vi.fn(),
        }),
      ),
    );
    // Both paths use MediaTile rather than a separate linked thumbnail.
    expect(container.querySelector("img")?.getAttribute("src")).toBe(image.url);
    expect(container.textContent).toBe("Coado da manhãGPT Image 2");
    expect(presented).toContain('aria-label="Coado da manhã"');
  });

  it("opens the full metadata viewer and supports its actions", async () => {
    await render();
    await click(button(image.name, container));
    const panel = document.querySelector('[data-slot="lightbox-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain(image.prompt);
    expect(panel?.textContent).toContain("132.0s");
    expect(panel?.textContent).toContain("0.2117");
    expect(panel?.textContent).toContain("1024 × 1024");
    expect(panel?.textContent).toContain("GPT Image 2");
    await click(button("Copiar imagem", panel!));
    expect(mocks.copy).toHaveBeenCalledWith(image.url);
    await click(button("Baixar", panel!));
    expect(mocks.download).toHaveBeenCalledWith(image.url, image.name);
    const input = panel!.querySelector<HTMLInputElement>('input[aria-label="Nome da imagem"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Novo nome",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(mocks.rename).toHaveBeenCalledWith({
      accountId: resource.accountId,
      imageId: resource.imageId,
      name: "Novo nome",
    });
    await click(button("Excluir", panel!));
    expect(mocks.remove).toHaveBeenCalledWith({
      accountId: resource.accountId,
      imageId: resource.imageId,
    });
    expect(document.querySelector('[data-slot="lightbox-panel"]')).toBeNull();
  });

  it("navigates presented images without using a different account's IDs", async () => {
    const second = { ...resource, imageId: "image-b" as typeof resource.imageId };
    const foreign = {
      ...resource,
      accountId: "account-b" as typeof resource.accountId,
      imageId: "image-c" as typeof resource.imageId,
    };
    mocks.query.mockImplementation((_ref, args) =>
      args === "skip" ? undefined : { ...image, id: args.imageId, name: args.imageId },
    );
    await render([resource, foreign, second]);
    await click(button("image-a", container));
    await click(button("Próxima"));
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Nome da imagem"]')?.value,
    ).toBe("image-b");
    expect(document.querySelector('button[aria-label="Próxima"]')).toBeNull();
    await click(button("Anterior"));
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Nome da imagem"]')?.value,
    ).toBe("image-a");
    await click(button("Fechar"));
    await click(button("image-c", container));
    await click(button("Excluir", document.querySelector('[data-slot="lightbox-panel"]')!));
    expect(mocks.remove).toHaveBeenLastCalledWith({
      accountId: foreign.accountId,
      imageId: foreign.imageId,
    });
  });

  it("handles loading and deleted records without opening a raw URL", async () => {
    mocks.query.mockReturnValue(undefined);
    await render();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    mocks.query.mockReturnValue(image);
    await render();
    await click(button(image.name, container));
    mocks.query.mockReturnValue(null);
    await render();
    expect(container.textContent).toContain("Imagem excluída");
    expect(document.querySelector('[data-slot="lightbox-panel"]')).toBeNull();
  });
});

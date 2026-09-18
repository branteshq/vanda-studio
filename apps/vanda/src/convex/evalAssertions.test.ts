import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";
import {
  assertDelegatedImagesWereInspected,
  assertProtectedPixelsPreserved,
  assertRejectedPaintWasReported,
  type EvalTraceStep,
} from "../../evals/assertions";
import { referenceImage } from "../../evals/references";

describe("evaluation guards", () => {
  it("requires successful inspection of every final image after the latest delegation", () => {
    const delegation: EvalTraceStep = { agent: "caetano", results: [{ toolName: "ask_vanda" }] };
    const trace: EvalTraceStep[] = [delegation];
    const check = () => assertDelegatedImagesWereInspected(trace, ["final-a", "final-b"]);
    expect(check).toThrow("inspect_image");
    trace.push({
      agent: "caetano",
      calls: [{ toolName: "inspect_image" }],
      errors: [{ toolName: "inspect_image" }],
    });
    expect(check).toThrow("inspect_image");

    for (const imageId of ["reference", "final-a", "final-b"]) {
      expect(check).toThrow("inspect_image");
      trace.push({
        agent: "caetano",
        results: [
          {
            toolName: "inspect_image",
            output: { imageId, url: "https://example.com/image.png", mimeType: "image/png" },
          },
        ],
      });
    }

    expect(check).not.toThrow();
    trace.push(delegation);
    expect(check).toThrow("inspect_image");
  });

  it("rejects success prose after a failed paint and requires an actual rejection", () => {
    const failed: EvalTraceStep[] = [
      { agent: "vanda", errors: [{ toolName: "paint", message: "unavailable" }] },
    ];

    expect(() => assertRejectedPaintWasReported([], "Não consegui gerar a imagem.")).toThrow(
      "did not execute",
    );

    expect(() => assertRejectedPaintWasReported(failed, "A imagem está pronta.")).toThrow(
      "does not conservatively report",
    );
    expect(() =>
      assertRejectedPaintWasReported(failed, "Não consegui gerar a imagem."),
    ).not.toThrow();
    expect(() =>
      assertRejectedPaintWasReported(failed, "Gerador indisponível. Nenhuma imagem foi criada."),
    ).not.toThrow();
    expect(() =>
      assertRejectedPaintWasReported(failed, "Gerador falhou, mas criei a imagem."),
    ).toThrow();
  });

  it.each(["caju-background-revision", "orvalho-product-identity-revision", "pimba-kit-revision"])(
    "allows a real background change for %s",
    async (referenceId) => {
      const original = referenceImage(referenceId);
      const changed = await Jimp.read(Buffer.from(original));
      const background = changed.getPixelColor(0, 0);

      for (let y = 0; y < changed.height; y++)
        for (let x = 0; x < changed.width; x++) {
          // Independent geometric exclusion covering the purple pen, not the assertion's flood mask.
          if (referenceId === "pimba-kit-revision" && x >= 456 && x <= 540 && y >= 346 && y <= 875)
            continue;

          if (changed.getPixelColor(x, y) === background) changed.setPixelColor(0xf4e7d3ff, x, y);
        }

      const output = await changed.getBuffer("image/png");
      expect(changed.getPixelColor(0, 0)).not.toBe(background);
      await expect(
        assertProtectedPixelsPreserved(referenceId, original, output),
      ).resolves.toBeUndefined();
    },
  );

  it("detects a single changed protected pixel, including unsampled purple pen pixels", async () => {
    const original = referenceImage("pimba-kit-revision");
    const changed = await Jimp.read(Buffer.from(original));
    changed.setPixelColor(0xff4f8bff, 497, 501);
    await expect(
      assertProtectedPixelsPreserved(
        "pimba-kit-revision",
        original,
        await changed.getBuffer("image/png"),
      ),
    ).rejects.toThrow("protected pixel changed");
  });
});

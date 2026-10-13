import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";
import {
  assertFeedReferenced,
  assertIdentityKeptExecutionImproved,
  assertImagesWereInspected,
  assertKeepAndEvolveWritten,
  assertProtectedPixelsPreserved,
  assertRejectedPaintWasReported,
  type EvalTraceStep,
} from "../../evals/assertions";
import { brands } from "../../evals/fixtures";
import { feedImage, referenceImage } from "../../evals/references";

/** An extend result; the strip comes only with the call that closes the loop. */
const chain = (slides: string[], strip?: string) => {
  const chainSlides = slides.map((imageId) => ({ imageId }));

  return {
    toolName: "extend_infinite_carousel",
    output: {
      data: strip
        ? {
            slides: chainSlides,
            seams: [],
            strip: { imageId: strip, url: "https://example.com/strip.jpg" },
          }
        : { slides: chainSlides, seams: [] },
    },
  };
};

const paint = (referenceImageIds: string[]) => ({
  calls: [{ toolName: "paint", input: { prompt: "no estilo do feed", referenceImageIds } }],
});

describe("evaluation guards", () => {
  it("counts an infinite carousel as inspected only once its strip came back", () => {
    // An unclosed chain the model never saw.
    const trace: EvalTraceStep[] = [{ results: [chain(["a1", "a2"]), chain(["a1", "b2", "b3"])] }];
    expect(() => assertImagesWereInspected(trace, ["a1", "b2", "b3"])).toThrow("pixel result");

    trace.push({ results: [chain(["c1", "b2", "c3"], "strip")] });
    expect(() => assertImagesWereInspected(trace, ["c1", "b2", "c3"])).not.toThrow();
  });

  it("requires pixels for every final image, not presentation metadata or failed reads", () => {
    const trace: EvalTraceStep[] = [
      {
        agent: "caetano",
        results: [
          {
            toolName: "present",
            output: {
              resources: [
                { kind: "image", imageId: "final-a" },
                { kind: "image", imageId: "final-b" },
              ],
            },
          },
        ],
      },
    ];

    const check = () => assertImagesWereInspected(trace, ["final-a", "final-b"]);
    expect(check).toThrow("pixel result");
    trace.push({
      agent: "caetano",
      calls: [{ toolName: "read" }],
      errors: [{ toolName: "read" }],
    });
    expect(check).toThrow("pixel result");

    for (const imageId of ["reference", "final-a", "final-b"]) {
      expect(check).toThrow("pixel result");
      trace.push({
        agent: "caetano",
        results: [
          {
            toolName: "read",
            output: {
              data: {
                ok: true,
                file: {
                  kind: "image",
                  imageId,
                  url: "https://example.com/image.png",
                  mimeType: "image/png",
                },
              },
            },
          },
        ],
      });
    }

    expect(check).not.toThrow();
    expect(() => assertImagesWereInspected(trace, ["corrected-image"])).toThrow("pixel result");
    trace.push({
      agent: "caetano",
      results: [
        {
          toolName: "paint",
          output: {
            data: {
              imageId: "corrected-image",
              url: "https://example.com/corrected.png",
              mimeType: "image/png",
            },
          },
        },
      ],
    });
    expect(() => assertImagesWereInspected(trace, ["corrected-image"])).not.toThrow();
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
    // Rendering and comparing 1024×1280 PNGs exceeds the default 5s on macOS CI.
    30_000,
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
  it("counts feed posts only when one paint call conditions on enough of them", () => {
    const feed = ["feed-1", "feed-2", "feed-3", "feed-4"];

    // Saying "feed" in prose, unrelated references, or one post per call are not enough.
    const trace: EvalTraceStep[] = [
      { text: "Usei os posts do feed como referência." },
      paint(["logo"]),
      paint(["feed-1"]),
      paint(["feed-2", "painted-cover"]),
      { calls: [{ toolName: "read", input: { path: "/images/feed-3.png" } }] },
    ];

    expect(() => assertFeedReferenced(trace, feed)).toThrow("best: 1");
    trace.push(paint(["feed-3", "feed-1"]));
    expect(() => assertFeedReferenced(trace, feed)).not.toThrow();
  });

  it("renders the feed-fit brand's posts in one deterministic layout", async () => {
    const brand = brands.find((candidate) => candidate.id === "tabua-contabil")!;
    const [first, second] = brand.feed!;
    const a = feedImage(brand, first!);
    expect(Buffer.from(feedImage(brand, first!)).equals(Buffer.from(a))).toBe(true);

    const [one, two] = await Promise.all(
      [a, feedImage(brand, second!)].map((bytes) => Jimp.read(Buffer.from(bytes))),
    );

    for (const image of [one!, two!]) {
      expect([image.width, image.height]).toEqual([1024, 1280]);
      // Ink ground, mustard quarter circle top right, mustard rule under the title.
      expect(image.getPixelColor(40, 640).toString(16).slice(0, 6)).toBe("14213d");
      expect(image.getPixelColor(1000, 20).toString(16).slice(0, 6)).toBe("f2b134");
      expect(image.getPixelColor(150, 905).toString(16).slice(0, 6)).toBe("f2b134");
    }
  });

  it("requires Manter and Evoluir in the Design section", () => {
    const file = (design: string) =>
      `# Marca\n\n## Voz\n\n- Manter: fora do Design (dono)\n\n## Design\n\n${design}\n## Provas\n`;

    expect(() => assertKeepAndEvolveWritten(file("- Paleta: #00999E (dono)\n"))).toThrow("Manter");
    expect(() =>
      assertKeepAndEvolveWritten(file("- Manter: turquesa e assinatura (Vanda)\n")),
    ).toThrow("Evoluir");
    expect(() =>
      assertKeepAndEvolveWritten(
        file("- Manter: turquesa (Vanda)\n- Evoluir: sem moldura, foto do produto (Vanda)\n"),
      ),
    ).not.toThrow();
  });

  it("keeps identity in the paint prompt and only names dated elements to exclude them", () => {
    const options = {
      hex: "#00999E",
      signature: "@plugue.loja",
      dated:
        /moldura (fina )?dupla|double[- ](thin )?(white )?(frame|border)|starburst|clip[- ]?art/i,
    };

    const prompt = (text: string): EvalTraceStep[] => [
      { calls: [{ toolName: "paint", input: { prompt: text } }] },
    ];

    expect(() => assertIdentityKeptExecutionImproved([], options)).toThrow("no paint");
    expect(() =>
      assertIdentityKeptExecutionImproved(prompt("teal #00999e, footer @plugue.loja"), options),
    ).not.toThrow();
    expect(() =>
      assertIdentityKeptExecutionImproved(prompt("orange ground, footer @plugue.loja"), options),
    ).toThrow("#00999E");
    expect(() =>
      assertIdentityKeptExecutionImproved(prompt("teal #00999E background"), options),
    ).toThrow("signature");
    expect(() =>
      assertIdentityKeptExecutionImproved(
        prompt("teal #00999E, thin double white frame around it, @plugue.loja"),
        options,
      ),
    ).toThrow("dated element");
    expect(() =>
      assertIdentityKeptExecutionImproved(
        prompt("teal #00999E, no double frame, no clip art, real product photo, @plugue.loja"),
        options,
      ),
    ).not.toThrow();
  });

  it("renders the weak feed as a square with the brand's turquoise and a double frame", async () => {
    const brand = brands.find((candidate) => candidate.id === "plugue-eletronicos")!;
    const image = await Jimp.read(Buffer.from(feedImage(brand, brand.feed![0]!)));

    expect([image.width, image.height]).toEqual([1024, 1024]);

    const hex = (x: number, y: number) =>
      image.getPixelColor(x, y).toString(16).padStart(8, "0").slice(0, 6);

    expect(hex(10, 500)).toBe("00999e");
    expect(hex(22, 500)).toBe("ffffff");
  });
});

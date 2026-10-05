// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { brandDirection, completePrompt, extendPrompt, seamPrompt } from "./carouselWeave";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const png = async (color: number) =>
  Buffer.from(await new Jimp({ width: 40, height: 50, color }).getBuffer("image/png"));

async function setup() {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
  vi.stubEnv("VANDA_WEAVE_CONCURRENCY", "1");
  const t = convexTest(schema, modules);

  const accountId = await t.run((ctx) =>
    ctx.db.insert("accounts", { createdAt: Date.now(), updatedAt: Date.now() }),
  );

  const slide = async (color: number) => {
    const bytes = await png(color);

    return t.run(async (ctx) =>
      ctx.db.insert("images", {
        accountId,
        origin: "generated",
        purpose: "post",
        storageId: await ctx.storage.store(new Blob([bytes], { type: "image/png" })),
        width: 40,
        height: 50,
        createdAt: 1,
      }),
    );
  };

  const imageIds = [await slide(0xff0000ff), await slide(0x00ff00ff), await slide(0x0000ffff)];

  return { t, accountId, imageIds };
}

type Test = Awaited<ReturnType<typeof setup>>["t"];

/** Run the deferred discards now: they are scheduled an hour out, past the turn. */
async function runDiscards(t: Test) {
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const discards = jobs.filter((job) => job.name.includes("discardChainSlides"));

  for (const job of discards) {
    await t.mutation(internal.gallery.discardChainSlides, job.args[0]);
  }

  // The cut close-ups leave on the same delay.
  for (const job of jobs.filter((entry) => entry.name.includes("discardWorking")))
    await t.mutation(internal.gallery.discardWorking, job.args[0]);

  return discards;
}

describe("carouselWeave.weave", () => {
  it("repaints every seam including the loop and keeps only the woven slides", async () => {
    const { t, accountId, imageIds } = await setup();
    const repaint = (await png(0x808080ff)).toString("base64");
    const prompts: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        prompts.push(JSON.parse(String(init?.body)).prompt);

        return Response.json({ data: [{ b64_json: repaint, media_type: "image/png" }] });
      }),
    );

    const result = await t.action(internal.carouselWeave.weave, {
      accountId,
      imageIds,
      format: "4:5",
      bridges: ["uma fita dourada", "um balão", "uma onda"],
      style: "aquarela suave",
    });

    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toContain("uma onda");
    expect(prompts[0]).toContain("hero subject");
    expect(prompts[1]).not.toContain("hero subject");
    expect(prompts[0]).toContain("aquarela suave");
    expect(result.slides).toHaveLength(3);
    expect(result.seams.map((seam) => [seam.seam, seam.woven])).toEqual([
      ["1→2", true],
      ["2→3", true],
      ["3→1 (volta)", true],
    ]);

    // Every cut is now the same gray on both sides.
    for (const seam of result.seams) expect(seam.score).toBe(0);

    const images = await t.run((ctx) => ctx.db.query("images").collect());
    // 3 sources + 3 woven slides + strip + cut close-ups; repainted seams were discarded.
    expect(images).toHaveLength(8);
    expect(result.cuts).toBeDefined();
    const woven = images.find((image) => image._id === result.slides[0]!.imageId);
    expect(woven).toMatchObject({
      editOfImageId: imageIds[0],
      width: 40,
      height: 50,
      mimeType: "image/jpeg",
    });

    const bytes = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(woven!.storageId!);

      return blob!.arrayBuffer();
    });

    const image = await Jimp.read(Buffer.from(bytes));
    // Slides are JPEG: compare within compression noise.

    const red = (x: number) => {
      const color = image.getPixelColor(x, 25);

      return Math.abs((color >>> 24) - 255) <= 4 && ((color >>> 16) & 0xff) <= 4;
    };

    expect(red(20)).toBe(true); // the text column is untouched
    // Both edges now carry the repainted bridge (tone-matched toward each neighbor).
    expect(red(39)).toBe(false);
    expect(red(0)).toBe(false);
  });

  it("re-weaves only the requested seams and validates the bridge count", async () => {
    const { t, accountId, imageIds } = await setup();
    const repaint = (await png(0x808080ff)).toString("base64");

    const request = vi.fn(async () =>
      Response.json({ data: [{ b64_json: repaint, media_type: "image/png" }] }),
    );

    vi.stubGlobal("fetch", request);

    await expect(
      t.action(internal.carouselWeave.weave, {
        accountId,
        imageIds,
        format: "4:5",
        bridges: ["a", "b"],
      }),
    ).rejects.toThrow("informe 3 pontes");

    const result = await t.action(internal.carouselWeave.weave, {
      accountId,
      imageIds,
      format: "4:5",
      bridges: ["a fita", "o balão", "a onda"],
      onlySeams: [3],
    });

    expect(request).toHaveBeenCalledOnce();
    expect(result.seams.map((seam) => seam.woven)).toEqual([false, false, true]);
    // Seam 3→1 touches slides 3 and 1; slide 2 keeps its id.
    expect(result.slides[1]!.imageId).toBe(imageIds[1]);
    expect(result.slides[0]!.imageId).not.toBe(imageIds[0]);
    expect(result.slides[2]!.imageId).not.toBe(imageIds[2]);
    // 3 sources + 2 changed slides + strip + cuts, and the replaced versions are queued for discard.
    expect(await t.run((ctx) => ctx.db.query("images").collect())).toHaveLength(7);
    const [discard] = await runDiscards(t);
    expect(discard!.args[0].imageIds).toEqual([imageIds[0], imageIds[2]]);
    expect(result.seams[0]!.score).toBeGreaterThan(50);
    expect(result.seams[2]!.score).toBe(0);
  });
});

describe("carouselWeave cleanup", () => {
  it("stops starting seams after a failed repaint and leaves no working rows", async () => {
    const { t, accountId, imageIds } = await setup();
    const repaint = (await png(0x808080ff)).toString("base64");
    let calls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;

        return calls === 2
          ? new Response("upstream down", { status: 500 })
          : Response.json({ data: [{ b64_json: repaint, media_type: "image/png" }] });
      }),
    );

    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      t.action(internal.carouselWeave.weave, {
        accountId,
        imageIds,
        format: "4:5",
        bridges: ["a fita", "o balão", "a onda"],
      }),
    ).rejects.toThrow();

    // Seam 3 never started; seam 1's billed repaint was discarded.
    expect(calls).toBe(2);
    expect(await t.run((ctx) => ctx.db.query("images").collect())).toHaveLength(3);
  });

  it("tolerates working rows the owner already deleted", async () => {
    const { t, accountId, imageIds } = await setup();
    await t.run((ctx) => ctx.db.delete(imageIds[2]!));

    await t.mutation(internal.gallery.discardWorking, { accountId, imageIds });

    expect(await t.run((ctx) => ctx.db.query("images").collect())).toHaveLength(0);
  });

  it("refuses slides too big to decode before fetching a repaint", async () => {
    const { t, accountId } = await setup();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    // A 4K 4:5 PNG, header only: the size is read without decoding.
    const header = new Uint8Array(33);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(header.buffer).setUint32(16, 3712);
    new DataView(header.buffer).setUint32(20, 4640);

    const huge = await t.run(async (ctx) =>
      ctx.db.insert("images", {
        accountId,
        origin: "generated",
        purpose: "post",
        storageId: await ctx.storage.store(new Blob([header], { type: "image/png" })),
        createdAt: 1,
      }),
    );

    await expect(
      t.action(internal.carouselWeave.extend, {
        accountId,
        imageIds: [huge],
        format: "4:5",
        bridge: "herói",
        content: "passo 1",
      }),
    ).rejects.toThrow("pinte o slide 1 em 1K ou 2K");

    expect(request).not.toHaveBeenCalled();
  });

  it("repaints 2K slides at 2K", async () => {
    const { t, accountId } = await setup();
    const bodies: { resolution?: string }[] = [];

    const big = await new Jimp({ width: 1296, height: 1620, color: 0x335577ff }).getBuffer(
      "image/png",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));

        return Response.json({
          data: [{ b64_json: Buffer.from(big).toString("base64"), media_type: "image/png" }],
        });
      }),
    );

    const slide = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", {
        name: "Dona",
        email: "dona@example.com",
        clerkId: "clerk_dona",
        imageModel: "google/gemini-3.1-flash-image",
      });

      await ctx.db.patch(accountId, { ownerUserId });

      return ctx.db.insert("images", {
        accountId,
        origin: "generated",
        purpose: "post",
        storageId: await ctx.storage.store(new Blob([new Uint8Array(big)], { type: "image/png" })),
        width: 1296,
        height: 1620,
        createdAt: 1,
      });
    });

    await t.action(internal.carouselWeave.extend, {
      accountId,
      imageIds: [slide],
      format: "4:5",
      bridge: "herói",
      content: "passo 1",
    });

    expect(bodies.map((body) => body.resolution)).toEqual(["2K", "2K"]);
  }, 30_000);

  it("falls back to one worker for a nonsense concurrency", async () => {
    const { t, accountId, imageIds } = await setup();
    vi.stubEnv("VANDA_WEAVE_CONCURRENCY", "-1");
    const repaint = (await png(0x808080ff)).toString("base64");

    const request = vi.fn(async () =>
      Response.json({ data: [{ b64_json: repaint, media_type: "image/png" }] }),
    );

    vi.stubGlobal("fetch", request);

    const result = await t.action(internal.carouselWeave.weave, {
      accountId,
      imageIds,
      format: "4:5",
      bridges: ["a fita", "o balão", "a onda"],
    });

    expect(request).toHaveBeenCalledTimes(3);
    expect(result.slides.every((slide) => slide.imageId)).toBe(true);
  });
});

describe("seamPrompt", () => {
  it("sizes the hero bigger than a satellite and never asks for text", () => {
    const hero = seamPrompt("astronauta de corpo inteiro", "espaço escuro", "hero");
    const satellite = seamPrompt("esfera laranja brilhante", undefined, "satellite");

    expect(hero).toContain("55–70% of the image height");
    expect(hero).toContain("never through a face");
    expect(satellite).toContain("25–45% of the image height");

    for (const prompt of [hero, satellite]) expect(prompt).toContain("Do not add any new text");
  });
});

describe("carouselWeave.extend", () => {
  const stubPaint = async (prompts: string[]) => {
    const repaint = (await png(0x808080ff)).toString("base64");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        prompts.push(JSON.parse(String(init?.body)).prompt);

        return Response.json({ data: [{ b64_json: repaint, media_type: "image/png" }] });
      }),
    );
  };

  it("chains slides, replaces the edited ones and closes the loop on the last", async () => {
    const { t, accountId, imageIds } = await setup();
    const prompts: string[] = [];
    await stubPaint(prompts);

    const second = await t.action(internal.carouselWeave.extend, {
      accountId,
      imageIds: [imageIds[0]!],
      format: "4:5",
      bridge: "astronauta de traje branco",
      content: "título PASSO 1, progresso 25%",
      style: "espaço escuro",
    });

    // A (extend) + B (complete).
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("is the hero: astronauta de traje branco");
    expect(prompts[1]).toContain("título PASSO 1");
    expect(second.slides).toHaveLength(2);
    // The previous slide's right edge was repainted, so it is a new image.
    expect(second.slides[0]!.imageId).not.toBe(imageIds[0]);
    expect(second.seams.map((seam) => seam.seam)).toEqual(["1→2"]);
    // No preview while the chain is still growing.
    expect(second.strip).toBeUndefined();
    expect(prompts[1]).toContain("Text never overlaps the hero");

    const third = await t.action(internal.carouselWeave.extend, {
      accountId,
      imageIds: second.slides.map((slide) => slide.imageId),
      format: "4:5",
      bridge: "esfera laranja",
      content: "título SALVE, progresso 100%",
      loopBridge: "esfera azul",
    });

    // A + B + the loop seam.
    expect(prompts).toHaveLength(5);
    expect(prompts[2]).toContain("bridge element crossing the vertical line at x=24%");
    expect(third.slides).toHaveLength(3);
    expect(third.seams.map((seam) => seam.seam)).toEqual(["2→3", "3→1 (volta)"]);
    // Slide 1 changed again for the loop; every slide is a fresh image.
    expect(new Set(third.slides.map((slide) => slide.imageId)).size).toBe(3);

    // Superseded slides wait out the turn, so links the model already holds stay valid.
    expect(await t.run((ctx) => ctx.db.query("images").collect())).toHaveLength(10);
    await runDiscards(t);

    const images = await t.run((ctx) => ctx.db.query("images").collect());
    const ids = new Set(images.map((image) => image._id));

    // Owner-painted sources stay; superseded chain slides and working repaints are gone.
    for (const id of imageIds) expect(ids.has(id)).toBe(true);

    for (const slide of second.slides.slice(0, 2)) expect(ids.has(slide.imageId)).toBe(false);

    for (const slide of third.slides) expect(ids.has(slide.imageId)).toBe(true);
    expect(third.strip).toBeDefined();
    expect(ids.has(third.cuts!.imageId)).toBe(false);
    // 3 sources + 3 final slides + the one final strip; the cut close-ups are gone.
    expect(images).toHaveLength(7);
  });

  it("never discards a slide a post, the chain or an agent paint still owns", async () => {
    const { t, accountId, imageIds } = await setup();
    await stubPaint([]);

    // An agent paint whose prompt opens the way chain slides do is not a chain slide.
    await t.run((ctx) =>
      ctx.db.patch(imageIds[0]!, { prompt: "Carrossel infinito, slide 1 de 3: astronauta" }),
    );

    const second = await t.action(internal.carouselWeave.extend, {
      accountId,
      imageIds: [imageIds[0]!],
      format: "4:5",
      bridge: "astronauta",
      content: "passo 1",
    });

    const third = await t.action(internal.carouselWeave.extend, {
      accountId,
      imageIds: second.slides.map((slide) => slide.imageId),
      format: "4:5",
      bridge: "esfera",
      content: "fim",
      loopBridge: "esfera azul",
    });

    // The owner already drafted (and maybe scheduled) the earlier chain.
    await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: [...second.slides.map((slide) => slide.imageId), imageIds[1]!],
      caption: "legenda",
    });

    expect(await runDiscards(t)).toHaveLength(2);
    const ids = new Set((await t.run((ctx) => ctx.db.query("images").collect())).map((i) => i._id));

    expect(ids.has(imageIds[0]!)).toBe(true);

    for (const slide of [...second.slides, ...third.slides])
      expect(ids.has(slide.imageId)).toBe(true);

    // A superseded id the returned chain repeats at another position stays too.
    const repeated = third.slides[1]!.imageId;

    await t.mutation(internal.gallery.discardChainSlides, {
      accountId,
      imageIds: [repeated],
      keep: [third.slides[0]!.imageId, repeated],
    });

    expect(await t.run((ctx) => ctx.db.get(repeated))).not.toBeNull();
  });

  it("carries the brand kit into every repaint and slide 1 into the text step", async () => {
    const { t, accountId, imageIds } = await setup();
    const repaint = (await png(0x808080ff)).toString("base64");
    const bodies: { prompt: string; input_references?: unknown[] }[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));

        return Response.json({ data: [{ b64_json: repaint, media_type: "image/png" }] });
      }),
    );

    await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/brand/kit.json",
      content: JSON.stringify({
        colors: [{ hex: "#183B56", name: "Azul ferramenta", role: "primária" }],
        fonts: [{ family: "Archivo", role: "títulos" }],
      }),
    });

    await t.action(internal.carouselWeave.extend, {
      accountId,
      imageIds: [imageIds[0]!, imageIds[1]!],
      format: "4:5",
      bridge: "esfera",
      content: "título FIM, progresso 100%",
      loopBridge: "esfera azul",
    });

    // A, B and the loop seam all carry the kit.
    expect(bodies).toHaveLength(3);

    for (const body of bodies) {
      // The kit normalizes hex to lowercase on write.
      expect(body.prompt).toContain("#183b56 (Azul ferramenta, primária)");
      expect(body.prompt).toContain("Archivo for títulos");
    }

    // A edits only the canvas; B also sees slide 1 for typography.
    expect(bodies[0]!.input_references).toHaveLength(1);
    expect(bodies[1]!.input_references).toHaveLength(2);
  });

  it("refuses a loop before 3 slides and a chain past 5", async () => {
    const { t, accountId, imageIds } = await setup();
    await stubPaint([]);

    await expect(
      t.action(internal.carouselWeave.extend, {
        accountId,
        imageIds: [imageIds[0]!],
        format: "4:5",
        bridge: "herói",
        content: "fim",
        loopBridge: "esfera",
      }),
    ).rejects.toThrow("pelo menos 3");

    await expect(
      t.action(internal.carouselWeave.extend, {
        accountId,
        imageIds: [...imageIds, imageIds[0]!, imageIds[1]!],
        format: "4:5",
        bridge: "esfera",
        content: "slide 6",
      }),
    ).rejects.toThrow("o máximo é 5");
  });
});

describe("brandDirection", () => {
  it("renders a filled kit and stays silent without one", () => {
    expect(
      brandDirection({
        colors: [{ hex: "#F2C14E", name: "Amarelo fita" }, { hex: "#F7F7F2" }],
        fonts: [{ family: "Archivo", role: "títulos" }, { family: "Source Sans 3" }],
      }),
    ).toBe(
      "Brand palette: #F2C14E (Amarelo fita), #F7F7F2. Paint new objects, accents and text in these colors, no other dominant colors; scenery that continues from the existing image keeps the colors it already has. Brand typography: set every text in Archivo for títulos, Source Sans 3, unless slide 1 already sets its text in another face; then match slide 1 so the carousel reads as one piece.",
    );
    expect(brandDirection(null)).toBe("");
    expect(seamPrompt("esfera", undefined, "satellite")).not.toContain("Brand palette");
  });
});

describe("chain prompts", () => {
  it("continues the hero on seam 1→2 and keeps text in the safe column", () => {
    expect(extendPrompt("garrafa de vidro", undefined, "hero")).toContain("is the hero: garrafa");
    expect(extendPrompt("esfera", undefined, "satellite")).toContain("20–30% of the image height");
    // Only the previous slide's edge is context: never its text column.
    expect(extendPrompt("esfera", undefined, "satellite")).toContain("The left 24% of this image");
    expect(extendPrompt("garrafa", undefined, "hero")).toContain("The left 32% of this image");

    const slide2 = completePrompt("título X", "estúdio", 1, false);
    expect(slide2).toContain("left 30%");
    expect(slide2).toContain("between 40% and 72%");
    expect(completePrompt("título Y", undefined, 3, true)).toContain(
      "flows back into the first slide",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  bandAlpha,
  blendBand,
  buildPatch,
  extendCanvas,
  matchColors,
  restoreLeft,
  seamPairs,
  seamScore,
  weaveGeometry,
  type Bitmap,
} from "./seamWeave";

const solid = (width: number, height: number, rgb: readonly [number, number, number]): Bitmap => {
  const data = new Uint8Array(width * height * 4);

  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);

  return { width, height, data };
};

const pixel = (image: Bitmap, x: number, y: number) =>
  Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));

describe("seamWeave", () => {
  it("pairs every slide with the next and closes the loop", () => {
    expect(seamPairs(4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]);
  });

  it("builds a one-slide patch from the right half of left and the left half of right", () => {
    const left = solid(10, 4, [255, 0, 0]);
    const right = solid(10, 4, [0, 0, 255]);
    left.data.set([9, 9, 9, 255], (0 * 10 + 9) * 4); // left's last column → patch column 4
    right.data.set([7, 7, 7, 255], (0 * 10 + 0) * 4); // right's first column → patch column 5

    const patch = buildPatch(left, right);

    expect(patch).toMatchObject({ width: 10, height: 4 });
    expect(pixel(patch, 0, 1)).toEqual([255, 0, 0]);
    expect(pixel(patch, 4, 0)).toEqual([9, 9, 9]);
    expect(pixel(patch, 5, 0)).toEqual([7, 7, 7]);
    expect(pixel(patch, 9, 1)).toEqual([0, 0, 255]);
  });

  it("feathers the band: opaque at the cut, ramped at the edges, zero outside", () => {
    const geometry = { band: 20, feather: 6 };

    expect(bandAlpha(49.5, 50, geometry)).toBe(1);
    expect(bandAlpha(36, 50, geometry)).toBe(1);
    expect(bandAlpha(32, 50, geometry)).toBeCloseTo(2.5 / 6);
    expect(bandAlpha(29, 50, geometry)).toBe(0);
    expect(bandAlpha(80, 50, geometry)).toBe(0);
  });

  it("pulls a drifted repaint back to the original tone on each side", () => {
    const original = buildPatch(solid(20, 2, [100, 100, 100]), solid(20, 2, [200, 200, 200]));

    const drifted = {
      ...original,
      data: original.data.map((value, i) => (i % 4 === 3 ? 255 : value + 30)),
    };

    const matched = matchColors(drifted, original, 4);

    expect(pixel(matched, 0, 0)).toEqual([100, 100, 100]);
    expect(pixel(matched, 19, 1)).toEqual([200, 200, 200]);
  });

  it("writes the repaint into both slides only inside the band and removes the step", () => {
    const left = solid(100, 8, [255, 0, 0]);
    const right = solid(100, 8, [0, 0, 255]);
    const repaint = solid(100, 8, [128, 0, 128]);
    const geometry = weaveGeometry(100);

    expect(seamScore(left, right)).toBeGreaterThan(100);
    blendBand(left, right, repaint, geometry);

    expect(pixel(left, 99, 0)).toEqual([128, 0, 128]);
    expect(pixel(right, 0, 0)).toEqual([128, 0, 128]);
    expect(pixel(left, 50, 0)).toEqual([255, 0, 0]); // the text column is untouched
    expect(pixel(right, 50, 0)).toEqual([0, 0, 255]);
    expect(pixel(left, 100 - geometry.band - 1, 0)).toEqual([255, 0, 0]);
    expect(seamScore(left, right)).toBe(0);
  });

  it("widens the band on the hero seam and still leaves the slide centre untouched", () => {
    const left = solid(100, 4, [255, 0, 0]);
    const right = solid(100, 4, [0, 0, 255]);
    const repaint = solid(100, 4, [128, 0, 128]);
    const geometry = weaveGeometry(100, true);

    expect(geometry).toEqual({ band: 30, feather: 6 });
    blendBand(left, right, repaint, geometry);

    expect(pixel(left, 100 - 24, 0)).toEqual([128, 0, 128]);
    expect(pixel(right, 23, 0)).toEqual([128, 0, 128]);
    expect(pixel(left, 100 - geometry.band - 1, 0)).toEqual([255, 0, 0]);
    expect(pixel(right, 50, 0)).toEqual([0, 0, 255]);
  });

  it("builds an outpainting canvas: known right half on the left, edge color on the right", () => {
    const known = solid(10, 2, [10, 10, 10]);

    for (let x = 5; x < 10; x++) known.data.set([200, 100, 50, 255], x * 4);

    const canvas = extendCanvas(known, 5, 2);

    expect(pixel(canvas, 0, 0)).toEqual([200, 100, 50]); // known x=5 moved to x=0
    expect(pixel(canvas, 4, 0)).toEqual([200, 100, 50]);
    expect(pixel(canvas, 9, 0)).toEqual([200, 100, 50]); // row 0 edge color
    expect(pixel(canvas, 9, 1)).toEqual([10, 10, 10]); // row 1 edge color
  });

  it("matches tone from the left strip only when the right side is a placeholder", () => {
    const original = solid(20, 2, [100, 100, 100]);
    // The placeholder half must not pull the correction toward its flat color.

    for (let y = 0; y < 2; y++)
      for (let x = 10; x < 20; x++) original.data.set([255, 255, 255, 255], (y * 20 + x) * 4);
    const repaint = solid(20, 2, [130, 130, 130]);

    expect(pixel(matchColors(repaint, original, 4, "left"), 19, 0)).toEqual([100, 100, 100]);
  });

  it("restores the kept left strip and ramps into the repaint", () => {
    const original = solid(20, 1, [0, 0, 0]);
    const repaint = solid(20, 1, [100, 100, 100]);
    const out = restoreLeft(repaint, original, 10, 4);

    expect(pixel(out, 0, 0)).toEqual([0, 0, 0]);
    expect(pixel(out, 5, 0)).toEqual([0, 0, 0]);
    expect(pixel(out, 8, 0)).toEqual([50, 50, 50]);
    expect(pixel(out, 15, 0)).toEqual([100, 100, 100]);
  });

  it("keeps only the requested edge strip and blends back at that cut", () => {
    const known = solid(10, 1, [0, 0, 0]);
    known.data.set([90, 90, 90, 255], 9 * 4);

    const canvas = extendCanvas(known, 2, 1);
    expect(pixel(canvas, 1, 0)).toEqual([90, 90, 90]); // known x=9
    expect(pixel(canvas, 2, 0)).toEqual([90, 90, 90]); // edge fill

    const previous = solid(10, 1, [0, 0, 0]);
    const next = solid(10, 1, [0, 0, 0]);
    blendBand(previous, next, solid(10, 1, [200, 200, 200]), { band: 2, feather: 0 }, 2);

    expect(pixel(previous, 8, 0)).toEqual([200, 200, 200]); // patch x=0 → previous x=8
    expect(pixel(previous, 7, 0)).toEqual([0, 0, 0]);
    expect(pixel(next, 1, 0)).toEqual([200, 200, 200]); // patch x=3 → next x=1
    expect(pixel(next, 2, 0)).toEqual([0, 0, 0]);
  });

  it("keeps letters the repaint erased but lets a new bridge object through", () => {
    const size = 400;
    const left = solid(size, size, [240, 230, 220]);
    const right = solid(size, size, [240, 230, 220]);

    // Stripes stand in for type on left's right edge, 30 px before the cut.
    for (let y = 40; y < 120; y++)
      for (let x = size - 60; x < size - 30; x++)
        if (x % 4 < 2) left.data.set([40, 20, 10], (y * size + x) * 4);

    // The repaint is plain where the stripes were and adds a bar across the cut lower down.
    const repaint = solid(size, size, [240, 230, 220]);
    const cut = size - Math.floor(size / 2);

    for (let y = 300; y < 340; y++)
      for (let x = cut - 50; x < cut + 50; x++)
        if (x % 4 < 2) repaint.data.set([30, 30, 200], (y * size + x) * 4);

    blendBand(left, right, repaint, weaveGeometry(size));

    expect(pixel(left, size - 60, 80)).toEqual([40, 20, 10]); // letter kept
    expect(pixel(left, size - 40, 320)).toEqual([30, 30, 200]); // bridge pasted
    expect(pixel(right, 20, 320)).toEqual([30, 30, 200]);
  });
});

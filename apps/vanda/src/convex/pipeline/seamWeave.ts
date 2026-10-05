/**
 * Infinite-carousel seam weaving, as pure RGBA bitmap math (Jimp's `bitmap`
 * shape). A seam patch is the right half of slide k beside the left half of
 * slide k+1 — exactly one slide in size, so the image model can repaint it as
 * one picture. Only a central band of the repaint goes back into the slides,
 * feathered at its edges and color-matched to the untouched outer strips.
 */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface WeaveGeometry {
  /** Half-width of the band pasted back, centered on the seam, in px. */
  readonly band: number;
  /** Width of the linear alpha ramp at each band edge, in px. */
  readonly feather: number;
}

/**
 * Band ±20% of a slide around each cut, ramped over its outer 6%. The hero
 * seam takes ±30% so a big subject keeps a recognisable share on both slides.
 */
export const weaveGeometry = (width: number, hero = false): WeaveGeometry => ({
  band: Math.round(width * (hero ? 0.3 : 0.2)),
  feather: Math.round(width * 0.06),
});

/** Seam s joins slide s to slide s+1; the last one is the loop seam back to slide 0. */
export const seamPairs = (count: number): ReadonlyArray<readonly [left: number, right: number]> =>
  Array.from({ length: count }, (_, seam) => [seam, (seam + 1) % count] as const);

const blank = (width: number, height: number): Bitmap => ({
  width,
  height,
  data: new Uint8Array(width * height * 4),
});

/** Right half of `left` beside the left half of `right`; the cut sits at `width - half`. */
export const buildPatch = (left: Bitmap, right: Bitmap): Bitmap => {
  const { width, height } = left;
  const half = Math.floor(width / 2);
  const leftPart = width - half;
  const patch = blank(width, height);

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    // left slide x ∈ [half, width) → patch x ∈ [0, leftPart)
    patch.data.set(left.data.subarray(row + half * 4, row + width * 4), row);
    // right slide x ∈ [0, half) → patch x ∈ [leftPart, width)
    patch.data.set(right.data.subarray(row, row + half * 4), row + leftPart * 4);
  }

  return patch;
};

/** Opacity of the repaint at patch column x: 1 near the cut, 0 outside the band. */
export const bandAlpha = (x: number, cut: number, { band, feather }: WeaveGeometry): number => {
  const distance = Math.abs(x + 0.5 - cut);

  if (distance >= band) return 0;

  if (distance <= band - feather) return 1;

  return (band - distance) / feather;
};

type ChannelStats = { mean: number[]; std: number[] };

const stripStats = (image: Bitmap, from: number, to: number): ChannelStats => {
  const sum = [0, 0, 0];
  const squares = [0, 0, 0];
  let count = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = from; x < to; x++) {
      const i = (y * image.width + x) * 4;

      for (let c = 0; c < 3; c++) {
        const value = image.data[i + c]!;
        sum[c]! += value;
        squares[c]! += value * value;
      }

      count++;
    }
  }

  const mean = sum.map((total) => total / count);
  const std = squares.map((total, c) => Math.sqrt(Math.max(0, total / count - mean[c]! ** 2)));

  return { mean, std };
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Generative edits drift in tone. Fit a per-channel gain/offset on each outer
 * strip (where the repaint should equal the original) and interpolate the two
 * corrections across the patch, so each side of the band meets its slide.
 */
export const matchColors = (
  repaint: Bitmap,
  original: Bitmap,
  stripWidth: number,
  // "left" when the right strip of `original` is only a placeholder.
  sides: "both" | "left" = "both",
): Bitmap => {
  const { width, height } = repaint;
  const strip = Math.max(1, Math.min(stripWidth, Math.floor(width / 2)));

  const fit = (from: number, to: number) => {
    const target = stripStats(original, from, to);
    const source = stripStats(repaint, from, to);

    return [0, 1, 2].map((c) => {
      const gain = clamp(source.std[c]! > 1 ? target.std[c]! / source.std[c]! : 1, 0.7, 1.4);

      return { gain, offset: target.mean[c]! - gain * source.mean[c]! };
    });
  };

  const left = fit(0, strip);
  const right = sides === "left" ? left : fit(width - strip, width);
  const out = blank(width, height);

  for (let x = 0; x < width; x++) {
    const t = width === 1 ? 0 : x / (width - 1);

    const correction = [0, 1, 2].map((c) => ({
      gain: left[c]!.gain * (1 - t) + right[c]!.gain * t,
      offset: left[c]!.offset * (1 - t) + right[c]!.offset * t,
    }));

    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;

      for (let c = 0; c < 3; c++) {
        out.data[i + c] = clamp(
          Math.round(repaint.data[i + c]! * correction[c]!.gain + correction[c]!.offset),
          0,
          255,
        );
      }

      out.data[i + 3] = 255;
    }
  }

  return out;
};

// Text guard. Generative repaints often drop letters they were told to keep, and
// pasting the band back would erase them. Blocks where the original had strong
// fine detail that the repaint lost keep the original pixels; blocks where the
// repaint adds detail (the bridge object on plain background) still go through.
const GUARD_BLOCK = 8;

// Mean |dx|+|dy| luma per pixel above which a block reads as type or fine line art.
const GUARD_DETAIL = 22;

// The repaint "lost" a block's detail when it keeps less than this share of it
// and is near flat there: erased type turns into plain background, while a
// re-rendered subject (softer texture, same object) keeps some detail.
const GUARD_LOSS = 0.5;

const GUARD_FLAT = 8;

// Erased type leaves the background around the letters as it was: at least this
// share of the block's pixels match the repaint. A moved subject changes them all.
const GUARD_KEPT = 0.35;

const GUARD_MATCH = 14;

// Erased type clusters into lines; a cluster taller than this (in blocks) and at
// least twice as tall as wide is a moved subject's outline, which must not stay.
const GUARD_OUTLINE = 16;

// Fewer blocks than this is a speck of changed texture, not erased type.
const GUARD_MIN_CLUSTER = 4;

// Closest blocks to the cut always take the repaint, or the cut itself would show.
const GUARD_MARGIN = 0.04;

const luma = (image: Bitmap, x: number, y: number): number => {
  const i = (y * image.width + x) * 4;

  return 0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]!;
};

/** Mean gradient magnitude of a block, read through `at` so patch and slide share one function. */
const blockDetail = (
  at: (x: number, y: number) => number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number => {
  let total = 0;
  let count = 0;

  for (let y = y0; y < y1 - 1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      const here = at(x, y);
      total += Math.abs(at(x + 1, y) - here) + Math.abs(at(x, y + 1) - here);
      count++;
    }
  }

  return count ? total / count : 0;
};

/**
 * Clear erased clusters shaped like an outline (tall and thin) or too small to
 * be type. Blocks up to two apart join one cluster: an outline breaks into pieces.
 */
const dropOutlines = (raw: Float32Array, columns: number, rows: number): void => {
  const seen = new Uint8Array(raw.length);

  for (let start = 0; start < raw.length; start++) {
    if (!raw[start] || seen[start]) continue;
    const cluster = [start];
    seen[start] = 1;
    let [top, bottom, leftmost, rightmost] = [rows, 0, columns, 0];

    for (let next = 0; next < cluster.length; next++) {
      const index = cluster[next]!;
      const row = Math.floor(index / columns);
      const column = index % columns;
      [top, bottom] = [Math.min(top, row), Math.max(bottom, row)];
      [leftmost, rightmost] = [Math.min(leftmost, column), Math.max(rightmost, column)];

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const r = row + dy;
          const c = column + dx;

          if (r < 0 || c < 0 || r >= rows || c >= columns) continue;
          const neighbor = r * columns + c;

          if (!raw[neighbor] || seen[neighbor]) continue;
          seen[neighbor] = 1;
          cluster.push(neighbor);
        }
      }
    }

    const height = bottom - top + 1;

    const outline = height > GUARD_OUTLINE && height >= 2 * (rightmost - leftmost + 1);

    if (outline || cluster.length < GUARD_MIN_CLUSTER) for (const index of cluster) raw[index] = 0;
  }
};

/** One protection value (0–1) per GUARD_BLOCK block, row-major. */
export interface GuardMask {
  readonly columns: number;
  readonly rows: number;
  readonly values: Float32Array;
}

/**
 * Patch-space mask (one value per GUARD_BLOCK block, 0–1) of where pasting the
 * repaint would erase detail the slides already had, grown by two blocks so
 * glyph edges are covered and the transition is not blocky.
 */
export const erasureMask = (
  left: Bitmap,
  right: Bitmap,
  repaint: Bitmap,
  geometry: WeaveGeometry,
  cut: number,
): GuardMask => {
  const { width, height } = left;
  const columns = Math.ceil(width / GUARD_BLOCK);
  const rows = Math.ceil(height / GUARD_BLOCK);
  const raw = new Float32Array(columns * rows);
  const margin = Math.round(width * GUARD_MARGIN);

  const original = (x: number, y: number) =>
    x < cut ? luma(left, x + width - cut, y) : luma(right, x - cut, y);

  const repainted = (x: number, y: number) => luma(repaint, x, y);

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x0 = column * GUARD_BLOCK;
      const x1 = Math.min(width, x0 + GUARD_BLOCK);
      const center = (x0 + x1) / 2;

      if (Math.abs(center - cut) > geometry.band || Math.abs(center - cut) < margin) continue;
      const y0 = row * GUARD_BLOCK;
      const y1 = Math.min(height, y0 + GUARD_BLOCK);
      const before = blockDetail(original, x0, y0, x1, y1);

      if (before < GUARD_DETAIL) continue;

      const after = blockDetail(repainted, x0, y0, x1, y1);

      if (after >= Math.min(before * GUARD_LOSS, GUARD_FLAT)) continue;
      let kept = 0;

      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          if (Math.abs(original(x, y) - repainted(x, y)) < GUARD_MATCH) kept++;

      if (kept >= GUARD_KEPT * (x1 - x0) * (y1 - y0)) raw[row * columns + column] = 1;
    }
  }

  dropOutlines(raw, columns, rows);

  // Blocks touching an erased one are protected too (glyph edges carry less
  // detail); the ring after that is half protected so the edge is not blocky.
  const values = new Float32Array(columns * rows);

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let nearest = Infinity;

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const r = row + dy;
          const c = column + dx;

          if (r < 0 || c < 0 || r >= rows || c >= columns || !raw[r * columns + c]) continue;
          nearest = Math.min(nearest, Math.max(Math.abs(dx), Math.abs(dy)));
        }
      }

      values[row * columns + column] = nearest <= 1 ? 1 : nearest === 2 ? 0.5 : 0;
    }
  }

  return { columns, rows, values };
};

/**
 * Paste the repaint's central band back into both slides in place: the part
 * left of the cut lands on `left`'s right edge, the rest on `right`'s left edge.
 * Detail the repaint erased (usually text) keeps its original pixels.
 */
export const blendBand = (
  left: Bitmap,
  right: Bitmap,
  repaint: Bitmap,
  geometry: WeaveGeometry,
  // Patch column of the cut; patch x < cut is `left`'s last `cut` columns.
  cut = left.width - Math.floor(left.width / 2),
): void => {
  const { width, height } = left;
  const guard = erasureMask(left, right, repaint, geometry, cut);

  for (let x = Math.max(0, cut - geometry.band); x < Math.min(width, cut + geometry.band); x++) {
    const base = bandAlpha(x, cut, geometry);

    if (base <= 0) continue;
    const [target, targetX] = x < cut ? [left, x + width - cut] : [right, x - cut];
    const column = Math.floor(x / GUARD_BLOCK);

    for (let y = 0; y < height; y++) {
      const protectedShare = guard.values[Math.floor(y / GUARD_BLOCK) * guard.columns + column]!;
      const alpha = base * (1 - protectedShare);

      if (alpha <= 0) continue;
      const from = (y * width + x) * 4;
      const to = (y * width + targetX) * 4;

      for (let c = 0; c < 3; c++) {
        target.data[to + c] = Math.round(
          target.data[to + c]! * (1 - alpha) + repaint.data[from + c]! * alpha,
        );
      }

      target.data[to + 3] = 255;
    }
  }
};

/**
 * Mean absolute RGB step across one cut: the last `columns` of `left` against
 * the first `columns` of `right`, minus the same step measured inside each
 * slide, so busy textures aren't mistaken for a seam. ~0 is invisible.
 */
export const seamScore = (left: Bitmap, right: Bitmap, columns = 2): number => {
  const { width, height } = left;

  const column = (image: Bitmap, x: number, y: number, c: number) =>
    image.data[(y * width + x) * 4 + c]!;

  let across = 0;
  let within = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let k = 0; k < columns; k++) {
      for (let c = 0; c < 3; c++) {
        across += Math.abs(column(left, width - 1 - k, y, c) - column(right, k, y, c));
        // Same pixel distance (2k+1) as the cross-cut pair, measured inside each slide.
        const span = 2 * k + 1;
        within +=
          (Math.abs(column(left, width - 1 - k, y, c) - column(left, width - 1 - k - span, y, c)) +
            Math.abs(column(right, k, y, c) - column(right, k + span, y, c))) /
          2;
        count++;
      }
    }
  }

  return Math.max(0, (across - within) / count);
};

/**
 * Outpainting canvas: `known`'s last `keep` columns moved to the left edge, and
 * the rest filled per row with the color of `known`'s right edge, so the model
 * reads it as an empty continuation of the same rows (horizon, sky, floor).
 */
export const extendCanvas = (
  known: Bitmap,
  keep = known.width - Math.floor(known.width / 2),
  edgeColumns = 8,
): Bitmap => {
  const { width, height } = known;
  const leftPart = Math.max(0, Math.min(width, keep));
  const start = width - leftPart;
  const canvas = blank(width, height);
  const edge = Math.max(1, Math.min(edgeColumns, width));

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    canvas.data.set(known.data.subarray(row + start * 4, row + width * 4), row);
    const mean = [0, 0, 0];

    for (let x = width - edge; x < width; x++) {
      for (let c = 0; c < 3; c++) mean[c]! += known.data[row + x * 4 + c]!;
    }

    for (let x = leftPart; x < width; x++) {
      const i = row + x * 4;

      for (let c = 0; c < 3; c++) canvas.data[i + c] = Math.round(mean[c]! / edge);
      canvas.data[i + 3] = 255;
    }
  }

  return canvas;
};

/**
 * Put `original` back over the first `keep` columns of `repaint` (ramped over
 * `feather` px), so a generative edit can't move the pixels a seam depends on.
 */
export const restoreLeft = (
  repaint: Bitmap,
  original: Bitmap,
  keep: number,
  feather: number,
): Bitmap => {
  const { width, height } = repaint;
  const out = { width, height, data: new Uint8Array(repaint.data) };

  for (let x = 0; x < Math.min(width, keep); x++) {
    // Weight of the repaint: 0 inside the kept strip, rising to 1 at its edge.
    const alpha = feather > 0 ? Math.max(0, (x - (keep - feather)) / feather) : 0;

    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;

      for (let c = 0; c < 3; c++) {
        out.data[i + c] = Math.round(
          original.data[i + c]! * (1 - alpha) + repaint.data[i + c]! * alpha,
        );
      }

      out.data[i + 3] = 255;
    }
  }

  return out;
};

import { describe, expect, it } from "vitest";

import { cropOf, referenceSourceOf } from "./references";
import { cropPixels } from "../referencesNode";

describe("referenceSourceOf", () => {
  it("treats a blank field as absent", () => {
    expect(referenceSourceOf({ imageId: "", instagramPost: "17925214752147137" })).toEqual({
      kind: "instagram",
      post: "17925214752147137",
    });
    expect(referenceSourceOf({ imageId: "k57abc", instagramPost: "  " })).toEqual({
      kind: "image",
      imageId: "k57abc",
    });
  });

  it("reads an Instagram post id sent as imageId", () => {
    expect(referenceSourceOf({ imageId: "17925214752147137", instagramPost: "" })).toEqual({
      kind: "instagram",
      post: "17925214752147137",
    });
  });

  it("rejects no source and two different ones", () => {
    expect(() => referenceSourceOf({ imageId: "", instagramPost: "" })).toThrow(/informe imageId/);
    expect(() => referenceSourceOf({ imageId: "k57abc", instagramPost: "179252" })).toThrow(
      /informe só um/,
    );
  });
});

describe("crop boxes", () => {
  it("treats an empty box as no crop", () => {
    expect(cropOf(null)).toBeUndefined();
    expect(cropOf({ x: 0, y: 0, width: 0, height: 0 })).toBeUndefined();
    expect(cropOf({ x: 0.2, y: 0.1, width: 0.5, height: 0.4 })).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.5,
      height: 0.4,
    });
  });

  it("turns fractions into pixels, clamped inside the image", () => {
    expect(
      cropPixels({ x: 0.5, y: 0.1, width: 0.5, height: 0.4 }, { width: 1080, height: 1350 }),
    ).toEqual({ x: 540, y: 135, w: 540, h: 540 });
    expect(
      cropPixels({ x: -0.1, y: 0.8, width: 0.6, height: 0.5 }, { width: 1000, height: 1000 }),
    ).toEqual({ x: 0, y: 800, w: 500, h: 200 });
    expect(() =>
      cropPixels({ x: 0, y: 0, width: 0.05, height: 0.5 }, { width: 1000, height: 1000 }),
    ).toThrow(/pequeno demais/);
  });
});

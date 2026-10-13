import { describe, expect, it } from "vitest";

import { referenceSourceOf } from "./references";

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

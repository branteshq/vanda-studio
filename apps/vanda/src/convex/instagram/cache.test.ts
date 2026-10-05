import { describe, expect, it } from "vitest";
import { instagramRequestKey } from "./cache";

describe("instagramRequestKey", () => {
  it("keys string, nested and array inputs in stable order", () => {
    const key = instagramRequestKey("posts", {
      scope: "connected",
      handle: "@vsteste13166",
      limit: 25,
      cursor: "",
      filters: { b: ["x", "y"], a: 1 },
    });

    expect(key).toBe(
      'posts:{"cursor":"","filters":{"a":1,"b":["x","y"]},"handle":"@vsteste13166","limit":25,"scope":"connected"}',
    );
  });
});

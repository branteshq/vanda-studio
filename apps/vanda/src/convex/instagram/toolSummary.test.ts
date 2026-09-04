import type { ContextHandler } from "@convex-dev/agent";
import { describe, expect, it } from "vitest";
import type { InstagramOperation } from "./cache";
import {
  compactInstagramHistory,
  INSTAGRAM_PREVIEW_MAX_CHARS,
  summarizeInstagramResult,
} from "./toolSummary";

type ModelMessage = Parameters<ContextHandler>[1]["allMessages"][number];

type ToolResult = Extract<
  Extract<ModelMessage, { role: "tool" }>["content"][number],
  { type: "tool-result" }
>;
type JsonValue = Extract<ToolResult["output"], { type: "json" }>["value"];

const observation = <Data>(data: Data, cached = false) => ({
  data,
  source: "apify",
  observedAt: 1_788_386_800_000,
  completeness: "partial",
  costUsd: 0.0324,
  savedTo: "/instagram/searches/marketing.json",
  cached,
  nextCursor: "opaque-provider-cursor",
});

const profiles = () =>
  Array.from({ length: 12 }, (_, i) => ({
    id: `profile-${i}`,
    handle: `cafe${i}`,
    name: `Café ${i}`,
    followers: 1200,
    biography: "Café brasileiro",
    latestPosts: Array.from({ length: 12 }, () => ({
      caption: "a".repeat(2_000),
      mediaUrl: `https://cdn.example.com/${"x".repeat(1_000)}`,
    })),
  }));

const toolMessage = (value: JsonValue): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: "search-1",
      toolName: "search_instagram_profiles",
      output: { type: "json", value },
    },
  ],
});

describe("Instagram tool summaries", () => {
  it.each([false, true])("keeps profile searches compact, cached=%s", (cached) => {
    const full = observation(profiles(), cached);
    const before = JSON.stringify(full);
    expect(before.length).toBeGreaterThan(400_000);
    const summary = summarizeInstagramResult("search_profiles", full);
    expect(JSON.stringify(summary).length).toBeLessThan(4_000);
    expect(summary).toMatchObject({
      source: "apify",
      observedAt: full.observedAt,
      completeness: "partial",
      costUsd: 0.0324,
      cached,
      savedTo: full.savedTo,
      nextCursor: full.nextCursor,
      preview: { totalItems: 12, shownItems: 12, omittedItems: 0 },
    });
    expect(summary.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "profile-0",
          handle: "cafe0",
          followers: 1200,
          latestPostsCount: 12,
        }),
      ]),
    );
    expect(JSON.stringify(summary)).not.toContain("mediaUrl");
    expect(JSON.stringify(summary)).not.toContain('"latestPosts":');
    expect(JSON.stringify(full)).toBe(before);
  });

  it.each<InstagramOperation>([
    "search_profiles",
    "profile",
    "posts",
    "post",
    "comments",
    "insights",
  ])("bounds %s previews even with escaped long text and oversized arrays", (operation) => {
    const huge = "\u0000".repeat(100_000);
    const item = {
      id: "id",
      handle: "cafe",
      name: huge,
      biography: huge,
      category: huge,
      website: huge,
      url: huge,
      shortcode: huge,
      ownerHandle: huge,
      caption: huge,
      transcript: huge,
      text: huge,
      username: huge,
      mediaType: "video",
      mediaUrl: huge,
      thumbnailUrl: huge,
      publicEngagement: { likes: 42, extra: huge },
      privateInsights: { saves: 5 },
      replies: [{ text: huge }],
      demographics: { unknown: huge },
      unexpected: huge,
    };
    const list = ["search_profiles", "posts", "comments"].includes(operation);
    const summary = summarizeInstagramResult(
      operation,
      observation(list ? Array.from({ length: 100 }, () => ({ ...item })) : item),
    );
    expect(JSON.stringify(summary.data).length).toBeLessThanOrEqual(INSTAGRAM_PREVIEW_MAX_CHARS);
    expect(JSON.stringify(summary)).not.toContain('"unexpected"');
    expect(JSON.stringify(summary)).not.toContain('"mediaUrl"');
    expect(summary.preview.notice).toContain("savedTo");
    if (list) expect(summary.preview.omittedItems).toBeGreaterThan(0);
  });

  it("preserves post locators and engagement while limiting caption and transcript", () => {
    const summary = summarizeInstagramResult(
      "post",
      observation({
        id: "media-123",
        url: "https://instagram.com/p/abc",
        caption: "c".repeat(10_000),
        transcript: "t".repeat(20_000),
        publicEngagement: { likes: 42, comments: 7 },
        privateInsights: { saves: 10, reach: 800 },
      }),
    );
    expect(summary.data).toMatchObject({
      id: "media-123",
      url: "https://instagram.com/p/abc",
      publicEngagement: { likes: 42, comments: 7 },
      privateInsights: { saves: 10, reach: 800 },
      caption: `${"c".repeat(512)}…`,
      transcript: `${"t".repeat(512)}…`,
    });
  });

  it("keeps an empty provider result empty", () => {
    expect(summarizeInstagramResult("search_profiles", observation([]))).toMatchObject({
      data: [],
      preview: { totalItems: 0, shownItems: 0, omittedItems: 0 },
    });
  });
});

describe("legacy Instagram history", () => {
  it.each([false, true])("compacts old results without mutating history, wrapped=%s", (wrapped) => {
    const full = observation(profiles());
    const value = wrapped
      ? { data: full, resources: [{ kind: "document", path: full.savedTo }], presented: [] }
      : full;
    const history = [toolMessage(value)];
    const before = JSON.stringify(history);
    const compacted = compactInstagramHistory(history);
    expect(JSON.stringify(compacted).length).toBeLessThan(5_000);
    expect(JSON.stringify(compacted)).toContain("search-1");
    expect(JSON.stringify(compacted)).toContain(full.savedTo);
    if (wrapped) expect(JSON.stringify(compacted)).toContain('"resources"');
    expect(JSON.stringify(history)).toBe(before);
    expect(compactInstagramHistory(compacted)).toEqual(compacted);
  });

  it("leaves errors and unrelated messages alone", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Olá" },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "search_instagram_profiles",
            toolCallId: "failed",
            output: { type: "error-text", value: "provider unavailable" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "another_tool",
            toolCallId: "other",
            output: { type: "json", value: observation(profiles()) },
          },
        ],
      },
    ];
    expect(compactInstagramHistory(messages)).toEqual(messages);
  });
});

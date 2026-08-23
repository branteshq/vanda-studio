import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstagramAnalytics,
  getInstagramComments,
  getInstagramMedia,
  instagramProfileInfoOf,
} from "./uploadpost";

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("Upload-Post Instagram reads", () => {
  beforeEach(() => {
    process.env.UPLOADPOST_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.UPLOADPOST_API_KEY;
  });

  it("reads and normalizes connected media", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        success: true,
        media: [
          {
            id: "1789",
            caption: "  lançamento hoje  ",
            media_type: "IMAGE",
            media_url: "https://cdn.example/post.jpg",
            permalink: "https://instagram.com/p/abc",
            timestamp: "2026-01-01T12:00:00Z",
            thumbnail_url: null,
          },
          { caption: "missing id is ignored" },
        ],
        pagination: { limit: 25, next_cursor: "next-page", has_more: true },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await getInstagramMedia("account id", { limit: 25 });

    expect(page).toEqual({
      media: [
        {
          id: "1789",
          caption: "lançamento hoje",
          mediaType: "IMAGE",
          mediaUrl: "https://cdn.example/post.jpg",
          permalink: "https://instagram.com/p/abc",
          timestamp: "2026-01-01T12:00:00Z",
          thumbnailUrl: null,
        },
      ],
      pagination: { limit: 25, nextCursor: "next-page", hasMore: true },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(
      "/api/uploadposts/media?platform=instagram&user=account+id&limit=25",
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe("Apikey test-key");
  });

  it("reads comments by owned media id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        comments: [
          {
            id: "comment-1",
            text: "  adorei  ",
            timestamp: "2026-01-02T12:00:00Z",
            user: { id: "user-1", username: "cliente" },
          },
        ],
        pagination: { next_cursor: null, has_next: false },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await getInstagramComments("account-1", "media/1", { limit: 10 });

    expect(page.comments).toEqual([
      {
        id: "comment-1",
        text: "adorei",
        timestamp: "2026-01-02T12:00:00Z",
        username: "cliente",
      },
    ]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "platform=instagram&user=account-1&post_id=media%2F1&limit=10",
    );
  });

  it("reads account analytics and falls back from views to impressions", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        instagram: {
          followers: 420,
          reach: 2_400,
          impressions: 3_200,
          profileViews: 80,
          likes: 120,
          comments: 14,
          shares: 8,
          saves: 22,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const analytics = await getInstagramAnalytics("account/1");

    expect(analytics).toEqual({
      followers: 420,
      reach: 2_400,
      views: 3_200,
      profileViews: 80,
      likes: 120,
      comments: 14,
      shares: 8,
      saves: 22,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "/api/analytics/account%2F1?platforms=instagram",
    );
  });

  it("extracts the connected handle and display name", () => {
    expect(
      instagramProfileInfoOf({
        username: "account-1",
        socialAccounts: {
          instagram: { username: "cafelumiar", display_name: "Café Lumiar" },
        },
      }),
    ).toEqual({ connected: true, username: "cafelumiar", displayName: "Café Lumiar" });
  });
});

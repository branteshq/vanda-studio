import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstagramAnalytics,
  getInstagramComments,
  getInstagramMedia,
  getInstagramPostAnalytics,
  getProfile,
  instagramProfileInfoOf,
} from "./uploadpost";

type JsonPrimitive = string | number | boolean | null;

type JsonValue = JsonPrimitive | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue };

/** Stubs fetch to answer once with `body` and returns the mock for its call arguments. */
const stubFetch = (body: JsonValue) => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
};

describe("Upload-Post Instagram reads", () => {
  beforeEach(() => {
    process.env.UPLOADPOST_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.UPLOADPOST_API_KEY;
  });

  it("keeps disconnected accounts and nullable profile fields valid", async () => {
    stubFetch({
      username: "account-1",
      social_accounts: {
        instagram: { handle: null, username: "cafe", display_name: null },
        tiktok: null,
      },
    });
    const profile = await getProfile("account-1");
    expect(profile).not.toBeNull();
    expect(instagramProfileInfoOf(profile!)).toEqual({
      connected: true,
      username: "cafe",
      displayName: "cafe",
      biography: null,
    });
    expect(
      instagramProfileInfoOf({ username: "account-1", socialAccounts: { instagram: null } }),
    ).toEqual({ connected: false, username: null, displayName: null, biography: null });
  });

  it("reads and normalizes connected media", async () => {
    const fetchMock = stubFetch({
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
    });

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
    const fetchMock = stubFetch({
      comments: [
        {
          id: "comment-1",
          text: "  adorei  ",
          timestamp: "2026-01-02T12:00:00Z",
          user: { id: "user-1", username: "cliente" },
        },
      ],
      pagination: { next_cursor: null, has_next: false },
    });

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
    const fetchMock = stubFetch({
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
    });

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
      followerDemographics: null,
      engagedAudienceDemographics: null,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "/api/analytics/account%2F1?platforms=instagram",
    );
  });

  it("reads live insights for an organic connected post", async () => {
    const fetchMock = stubFetch({
      platforms: {
        instagram: {
          platform_post_id: "media-1",
          post_metrics: {
            likes: 30,
            comments: 4,
            views: 900,
            reach: 700,
            impressions: 950,
            saves: 12,
            shares: 5,
          },
        },
      },
    });

    const analytics = await getInstagramPostAnalytics("account-1", "media-1");

    expect(analytics).toEqual({
      postId: "media-1",
      likes: 30,
      comments: 4,
      views: 900,
      reach: 700,
      impressions: 950,
      saves: 12,
      shares: 5,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "platform_post_id=media-1&platform=instagram&user=account-1",
    );
  });

  it("extracts the connected handle, display name and relayed bio", () => {
    expect(
      instagramProfileInfoOf({
        username: "account-1",
        socialAccounts: {
          instagram: {
            username: "cafelumiar",
            display_name: "Café Lumiar",
            biography: "  Café pet-friendly em Pinheiros ",
          },
        },
      }),
    ).toMatchObject({
      connected: true,
      username: "cafelumiar",
      displayName: "Café Lumiar",
      biography: "Café pet-friendly em Pinheiros",
    });
  });
});

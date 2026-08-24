import { describe, expect, it } from "vitest";
import { normalizeApifyPost, normalizeApifyProfile } from "./apify";

describe("Apify Instagram normalization", () => {
  it("normalizes public profiles without inventing unavailable fields", () => {
    expect(
      normalizeApifyProfile({
        id: "profile-1",
        username: "cafeexterno",
        fullName: "Café Externo",
        biography: "Café e brunch",
        externalUrl: "https://cafe.example",
        followersCount: 800,
        followsCount: 120,
        postsCount: 45,
        businessCategoryName: "Coffee Shop",
        private: false,
        verified: false,
      }),
    ).toEqual({
      id: "profile-1",
      handle: "cafeexterno",
      name: "Café Externo",
      biography: "Café e brunch",
      website: "https://cafe.example",
      category: "Coffee Shop",
      followers: 800,
      following: 120,
      postsCount: 45,
      private: false,
      verified: false,
    });
  });

  it("keeps public engagement separate from private insights", () => {
    expect(
      normalizeApifyPost({
        id: "post-1",
        shortCode: "ABC123",
        type: "Video",
        caption: "Bastidores #cafe",
        url: "https://instagram.com/reel/ABC123/",
        ownerUsername: "cafeexterno",
        timestamp: "2026-08-01T12:00:00Z",
        likesCount: 90,
        commentsCount: 7,
        videoViewCount: 1_200,
        videoPlayCount: 1_500,
        sharesCount: 12,
        transcript: "Começamos cedo preparando o café.",
      }),
    ).toEqual({
      id: "post-1",
      url: "https://instagram.com/reel/ABC123/",
      shortcode: "ABC123",
      ownerHandle: "cafeexterno",
      caption: "Bastidores #cafe",
      publishedAt: Date.parse("2026-08-01T12:00:00Z"),
      mediaType: "video",
      transcript: "Começamos cedo preparando o café.",
      publicEngagement: {
        likes: 90,
        comments: 7,
        views: 1_200,
        plays: 1_500,
        shares: 12,
      },
    });
  });
});

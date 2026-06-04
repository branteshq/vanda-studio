import type { AccountStats, ProjectSummary, SocialPost, VandaDataSnapshot } from "./types";

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

export const demoProject: ProjectSummary = {
  id: "demo-vanda-project",
  name: "Vanda Studio Demo",
  mode: "demo",
  instagramHandle: "vanda.demo",
  instagramConnectionStatus: "demo",
  postCount: 18,
  mediaCount: 42,
  socialPostCount: 6,
  scheduledCount: 2,
  publishedCount: 11,
  stats: {
    followersCount: 12840,
    followersDelta: 384,
    postsCount: 146,
    avgEngagement: 7.8,
    reach: 48200,
    profileViews: 3240,
  },
};

export const demoPosts: SocialPost[] = [
  {
    id: "demo-post-1",
    caption: "A behind-the-scenes carousel showing how a launch concept becomes a publish-ready creative system.",
    mediaType: "CAROUSEL_ALBUM",
    permalink: "https://instagram.com/p/demo-post-1",
    publishedAt: now - day,
    likeCount: 1840,
    commentsCount: 96,
    reach: 31100,
    impressions: 40200,
    saved: 238,
    shares: 84,
    engagementScore: 9.2,
  },
  {
    id: "demo-post-2",
    caption: "Three visual hooks that made the feed feel sharper this week.",
    mediaType: "IMAGE",
    permalink: "https://instagram.com/p/demo-post-2",
    publishedAt: now - 4 * day,
    likeCount: 1210,
    commentsCount: 44,
    reach: 21000,
    impressions: 28600,
    saved: 174,
    shares: 47,
    engagementScore: 8.1,
  },
  {
    id: "demo-post-3",
    caption: "A short reel recapping the strongest creative patterns from recent campaigns.",
    mediaType: "VIDEO",
    permalink: "https://instagram.com/p/demo-post-3",
    publishedAt: now - 8 * day,
    likeCount: 980,
    commentsCount: 31,
    reach: 18800,
    impressions: 24700,
    saved: 89,
    shares: 63,
    engagementScore: 7.4,
  },
];

export const demoStats: AccountStats = {
  followersCount: demoProject.stats.followersCount,
  followersDelta: demoProject.stats.followersDelta,
  postsCount: demoProject.stats.postsCount,
  avgEngagement: demoProject.stats.avgEngagement,
  reach: demoProject.stats.reach,
  profileViews: demoProject.stats.profileViews,
};

export function demoSnapshot(reason = "Convex is not configured or authenticated for this POC."): VandaDataSnapshot {
  return {
    mode: "demo",
    reason,
    selectedProject: demoProject,
    projects: [demoProject],
    latestPost: demoPosts[0],
    topPosts: [...demoPosts].sort((a, b) => (b.engagementScore ?? 0) - (a.engagementScore ?? 0)),
    stats: demoStats,
  };
}

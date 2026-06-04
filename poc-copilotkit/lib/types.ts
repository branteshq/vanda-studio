export type DataMode = "live" | "demo";

export type AccountStats = {
  followersCount: number | null;
  followersDelta: number | null;
  postsCount: number | null;
  avgEngagement: number | null;
  reach?: number | null;
  profileViews?: number | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  mode: DataMode;
  instagramHandle?: string | null;
  instagramConnectionStatus?: string | null;
  postCount: number;
  mediaCount: number;
  socialPostCount: number;
  scheduledCount: number;
  publishedCount: number;
  stats: AccountStats;
};

export type SocialPost = {
  id: string;
  caption?: string;
  mediaType: string;
  thumbnailUrl?: string;
  permalink: string;
  publishedAt: number;
  likeCount?: number;
  commentsCount?: number;
  reach?: number;
  impressions?: number;
  saved?: number;
  shares?: number;
  engagementScore?: number;
};

export type VandaDataSnapshot = {
  mode: DataMode;
  reason?: string;
  selectedProject: ProjectSummary | null;
  projects: ProjectSummary[];
  latestPost: SocialPost | null;
  topPosts: SocialPost[];
  stats: AccountStats | null;
};

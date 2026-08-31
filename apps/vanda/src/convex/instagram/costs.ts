/**
 * apify/instagram-scraper currently bills one dataset-result event at US$0.0027.
 * Keep this pinned to the actor's live pay-per-event price; every uncached
 * public Instagram result is charged to the owning plan with this value.
 */
export const APIFY_INSTAGRAM_RESULT_USD = 0.0027;

export const apifyInstagramCostUsd = (items: number): number =>
  Math.max(0, Math.floor(items)) * APIFY_INSTAGRAM_RESULT_USD;

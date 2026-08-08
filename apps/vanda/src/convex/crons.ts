import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The market growth loop observes monitored creators and qualifies breakout
// opportunities; publication metrics measures our own published posts.
// Cadence is a cost decision: each market pass burns real Apify + model money
// against the account's usage budget (hourly would eat an entire plan alone).
crons.interval("market growth loop", { hours: 24 }, internal.marketNode.runAllAccounts, {});
crons.interval(
  "publication metrics",
  { hours: 6 },
  internal.marketNode.measureAllPublications,
  {},
);

export default crons;

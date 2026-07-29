import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The market growth loop observes monitored creators and qualifies breakout
// opportunities; publication metrics measures our own published posts.
crons.interval("market growth loop", { hours: 1 }, internal.marketNode.runAllAccounts, {});
crons.interval(
  "publication metrics",
  { hours: 1 },
  internal.marketNode.measureAllPublications,
  {},
);

export default crons;

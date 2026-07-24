import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Observe runs as a continuous background loop, per the conceptual pipeline;
// consolidate folds the freshly observed signals into memory on a slower cadence;
// plan deliberates over that memory daily, proposing suggestions; create composes
// the approved ones into posts (durable per-image workflow) on the hour.
crons.interval("observe accounts", { minutes: 30 }, internal.observe.observeAllAccounts, {});
crons.interval(
  "consolidate accounts",
  { hours: 1 },
  internal.consolidate.consolidateAllAccounts,
  {},
);
crons.interval("plan accounts", { hours: 24 }, internal.plan.planAllAccounts, {});
crons.interval("create accounts", { hours: 1 }, internal.create.createAllAccounts, {});
crons.interval("market growth loop", { hours: 1 }, internal.marketNode.runAllAccounts, {});

export default crons;

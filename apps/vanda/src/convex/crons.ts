import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sweeping durable activity also recovers old turns that never had a watchdog.
crons.interval("expire stalled Vanda turns", { minutes: 1 }, internal.chat.expireStaleActivities);

// Autopilot: Sunday 10:00 São Paulo plans every enabled account's next week.
crons.weekly(
  "plan autopilot weeks",
  { dayOfWeek: "sunday", hourUTC: 13, minuteUTC: 0 },
  internal.autopilotNode.planAllAccounts,
);

// Autopilot: produce posts ~24h before they publish and collect their results.
crons.hourly("run autopilot", { minuteUTC: 7 }, internal.autopilotNode.tick);

export default crons;

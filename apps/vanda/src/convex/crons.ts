import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// Sweeping durable activity also recovers old turns that never had a watchdog.
crons.interval("expire stalled Vanda turns", { minutes: 1 }, internal.chat.expireStaleActivities);
export default crons;

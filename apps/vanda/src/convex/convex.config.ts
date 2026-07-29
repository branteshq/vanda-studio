import agent from "@convex-dev/agent/convex.config";
import autumn from "@useautumn/convex/convex.config";
import workflow from "@convex-dev/workflow/convex.config.js";
import { defineApp } from "convex/server";

// agent: Vanda's conversation substrate (threads, messages, tool calls,
// streaming, approvals). workflow: durable multi-step jobs. autumn: billing.
const app = defineApp();
app.use(agent);
app.use(autumn);
app.use(workflow);

export default app;

import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createStart } from "@tanstack/react-start";

process.env.CLERK_PUBLISHABLE_KEY ??= process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;

export const startInstance = createStart(() => ({
	requestMiddleware: [clerkMiddleware()],
}));

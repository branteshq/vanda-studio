import type { RequestHandler } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";

/** Google OAuth callback disabled during beta (no server-side Calendar integration). */
export const GET: RequestHandler = async () => {
	redirect(303, "/calendar");
};

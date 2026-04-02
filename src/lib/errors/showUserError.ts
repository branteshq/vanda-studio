import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { toast } from "svelte-sonner";
import { toUserFacingError } from "./userFacingError";

/**
 * Shows a Sonner toast with safe, user-facing copy. Use from any client-side catch / handler.
 * Never pass raw Convex or stack output — this function maps everything through toUserFacingError.
 */
export function showUserError(error: unknown): void {
	if (!browser) return;
	const { title, message, intent, toastBodyOnly } = toUserFacingError(error);
	const duration = intent === "account_plans" ? 10_000 : intent === "sign_in" ? 8000 : 8000;
	const action =
		intent === "account_plans"
			? {
					label: "Ver planos",
					onClick: () => {
						void goto("/account#planos");
					},
				}
			: intent === "sign_in"
				? {
						label: "Abrir conta",
						onClick: () => {
							void goto("/account");
						},
					}
				: undefined;
	const base = { duration, ...(action ? { action } : {}) };
	if (toastBodyOnly || !message.trim()) {
		toast.error(title, base);
	} else {
		toast.error(title, { ...base, description: message });
	}
}

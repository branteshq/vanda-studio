export const INSTAGRAM_CALLBACK_PATH = "/api/integrations/instagram/callback";

export function getInstagramRedirectUri() {
	const configured =
		import.meta.env.VITE_INSTAGRAM_REDIRECT_URI ??
		import.meta.env.PUBLIC_INSTAGRAM_REDIRECT_URI;
	if (configured) return configured;

	return `${window.location.origin}${INSTAGRAM_CALLBACK_PATH}`;
}

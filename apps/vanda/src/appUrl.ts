const configuredAppOrigin =
	import.meta.env.VITE_APP_ORIGIN ?? import.meta.env.PUBLIC_APP_ORIGIN;

export function getAppUrl(path = "/app") {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	if (configuredAppOrigin) return `${configuredAppOrigin}${normalizedPath}`;

	if (typeof window !== "undefined" && window.location.hostname === "vandastudio.app") {
		return `${window.location.protocol}//app.vandastudio.app${normalizedPath}`;
	}

	return normalizedPath;
}

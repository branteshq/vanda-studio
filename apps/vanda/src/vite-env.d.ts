/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly PUBLIC_CONVEX_URL?: string;
	readonly VITE_CONVEX_URL?: string;
	readonly PUBLIC_APP_ORIGIN?: string;
	readonly VITE_APP_ORIGIN?: string;
	readonly PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
	readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

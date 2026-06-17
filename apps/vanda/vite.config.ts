import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig({
	envDir: "../..",
	envPrefix: ["VITE_", "PUBLIC_"],
	server: {
		port: 3000,
		allowedHosts: [".trycloudflare.com"],
	},
	plugins: [tanstackStart(), nitro(), viteReact()],
});

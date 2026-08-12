import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

const rootEnvDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, rootEnvDir, "");
  for (const [key, value] of Object.entries(rootEnv)) {
    process.env[key] ??= value;
  }

  return {
    envDir: rootEnvDir,
    envPrefix: ["VITE_", "PUBLIC_"],
    server: {
      port: 3000,
      allowedHosts: [".trycloudflare.com"],
    },
    // React must live INSIDE the server bundle: when the bundler externalizes
    // it, the deployed Vercel function has no node_modules to resolve it from
    // and every SSR request 500s (externalization proved platform-dependent —
    // linux CI builds externalized what macOS builds inlined).
    ssr: { noExternal: ["react", "react-dom", "scheduler"] },
    // ...and it must live there exactly ONCE: linux builds resolved a second
    // react copy into the SSR chunk, so Clerk's hooks ran against a different
    // instance than the renderer's (null dispatcher → "reading 'useRef'").
    resolve: { dedupe: ["react", "react-dom", "scheduler"] },
    plugins: [
      tailwindcss(),
      tanstackStart(),
      nitro({ noExternals: ["react", "react-dom", "scheduler"] }),
      viteReact(),
    ],
  };
});

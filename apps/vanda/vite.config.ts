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
    // React singleton discipline. Two failure modes bracket this config:
    // fully external (the fresh-build default) leaves a bare require('react')
    // in a Vercel function with no node_modules → MODULE_NOT_FOUND on every
    // request; inlining react in BOTH the ssr service pre-bundle and nitro's
    // function bundle (ssr.noExternal + nitro noExternals) ships two react
    // instances → Clerk's hooks hit a null dispatcher. The working shape:
    // the ssr service keeps react EXTERNAL (no ssr.noExternal here) and
    // nitro bundles the single shared copy at the function level.
    // The use-sync-external-store shim is CJS-only; inlined into a service
    // asset its require('react') survives as a runtime call nitro cannot
    // rewire — aliased to local ESM re-implementations (react 19 has the
    // hook natively) so the package never enters the graph.
    resolve: {
      dedupe: ["react", "react-dom", "scheduler"],
      alias: [
        {
          find: /^use-sync-external-store\/shim\/with-selector(\.js)?$/,
          replacement: fileURLToPath(
            new URL("./src/shims/use-sync-external-store-with-selector.ts", import.meta.url),
          ),
        },
        {
          find: /^use-sync-external-store\/shim(\/index\.js)?$/,
          replacement: fileURLToPath(
            new URL("./src/shims/use-sync-external-store.ts", import.meta.url),
          ),
        },
      ],
    },
    plugins: [
      tailwindcss(),
      tanstackStart(),
      nitro({ noExternals: true }),
      viteReact(),
    ],
  };
});

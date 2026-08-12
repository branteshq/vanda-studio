/**
 * ESM stand-ins for the `use-sync-external-store` shim package, aliased in
 * vite.config.ts. React 19 ships useSyncExternalStore natively, but the shim
 * package only publishes CJS — and its `require("react")`, once inlined into
 * a nitro SSR service asset, survives as a runtime require the Vercel
 * function cannot resolve (no node_modules) or, worse, resolves to a second
 * react instance. Re-exporting from react keeps the graph ESM and singular.
 */
export { useSyncExternalStore } from "react";

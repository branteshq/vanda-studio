import { loadEnvConfig } from "@next/env";
import path from "node:path";

let loaded = false;

export function loadRootEnv() {
  if (loaded) return;
  loaded = true;

  // This sidecar POC lives one directory below the real Vanda app.
  // Loading the parent env keeps OPENROUTER_API_KEY usable without duplicating secrets.
  loadEnvConfig(path.resolve(process.cwd(), ".."));
}

#!/usr/bin/env node
// Register only the sandbox number's webhook. Never creates a paid number or sends a message.
const required = [
  "KAPSO_API_KEY",
  "KAPSO_PHONE_NUMBER_ID",
  "KAPSO_WEBHOOK_SECRET",
  "KAPSO_WEBHOOK_URL",
];

for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);

const url = new URL(process.env.KAPSO_WEBHOOK_URL);

if (url.protocol !== "https:" || url.pathname !== "/webhooks/kapso")
  throw new Error("Use the HTTPS Convex site URL ending in /webhooks/kapso");

if (!process.argv.includes("--apply")) {
  console.log(
    "Dry run. This registers a number-scoped Kapso webhook with a 3-second inbound buffer.",
  );
  console.log(
    "Verify KAPSO_PHONE_NUMBER_ID is your Sandbox WhatsApp configuration, then run with --apply.",
  );
  process.exit(0);
}

if (process.env.KAPSO_SANDBOX_CONFIRMED !== "true")
  throw new Error("Set KAPSO_SANDBOX_CONFIRMED=true after checking the number is the sandbox");

const response = await fetch(
  `https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/${encodeURIComponent(process.env.KAPSO_PHONE_NUMBER_ID)}/webhooks`,
  {
    method: "POST",
    headers: { "X-API-Key": process.env.KAPSO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      whatsapp_webhook: {
        url: url.href,
        secret_key: process.env.KAPSO_WEBHOOK_SECRET,
        active: true,
        events: [
          "whatsapp.message.received",
          "whatsapp.message.sent",
          "whatsapp.message.delivered",
          "whatsapp.message.read",
          "whatsapp.message.failed",
        ],
        buffer_enabled: true,
        buffer_window_seconds: 3,
        max_buffer_size: 20,
        buffer_events: ["whatsapp.message.received"],
      },
    }),
  },
);

if (!response.ok)
  throw new Error(
    `Kapso registration failed: HTTP ${response.status}. Check the dashboard; no automatic retry was attempted.`,
  );

console.log(
  "Webhook registered. Do not rerun --apply: manage or replace it from Kapso → Sandbox WhatsApp → Manage Webhooks.",
);
// The response can contain the signing secret. Do not log it.

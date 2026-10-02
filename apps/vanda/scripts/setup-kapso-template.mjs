#!/usr/bin/env node
// Submit Caetano's update template to Meta for review. Never sends a message.
// Once approved, set KAPSO_UPDATE_TEMPLATE (and optionally KAPSO_TEMPLATE_LANGUAGE)
// on the Convex deployment so notifications outside the 24-hour window use it.
const required = ["KAPSO_API_KEY", "KAPSO_WABA_ID"];

for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);

const name = process.env.KAPSO_UPDATE_TEMPLATE || "caetano_atualizacao";

const language = process.env.KAPSO_TEMPLATE_LANGUAGE || "pt_BR";

// Meta rejects a variable at the very start or end of the body.
const template = {
  name,
  language,
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text: "Caetano aqui, com uma atualização do Vanda Studio: {{1}}\n\nResponda esta mensagem para continuar a conversa.",
      example: { body_text: [["sua publicação foi ao ar no Instagram."]] },
    },
  ],
};

if (!process.argv.includes("--apply")) {
  console.log("Dry run. This submits the following template for Meta review:");
  console.log(JSON.stringify(template, null, 2));
  console.log("Run with --apply to submit it.");
  process.exit(0);
}

const response = await fetch(
  `https://api.kapso.ai/meta/whatsapp/v24.0/${encodeURIComponent(process.env.KAPSO_WABA_ID)}/message_templates`,
  {
    method: "POST",
    headers: { "X-API-Key": process.env.KAPSO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(template),
  },
);

const body = await response.text();

if (!response.ok) throw new Error(`Template submission failed: HTTP ${response.status} ${body}`);

console.log(body);

console.log(
  `Submitted "${name}" (${language}). After Meta approves it, set KAPSO_UPDATE_TEMPLATE=${name} on Convex.`,
);

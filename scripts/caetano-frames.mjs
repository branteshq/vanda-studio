#!/usr/bin/env node
// Caetano's animation frames: every frame is an edit of one base image, so all of
// them share the canvas, scale and feet position and a frame swap never moves him.
//
//   node scripts/caetano-frames.mjs            # regenerate every frame
//   node scripts/caetano-frames.mjs wave2 cheer # only these (their bases must exist)
//
// Generates with gpt-image-2 through your ChatGPT login (~/.codex/auth.json), writes the
// 1254px master to frames/masters/<name>.webp and the 480px app frame to frames/<name>.webp.
// Needs `cwebp` (brew install webp). Check new frames by overlaying them on their base
// (CSS mix-blend-mode: difference): only the part the prompt changes may differ.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const assets = path.join(root, "packages/ui/src/assets/caetano");

const framesDir = path.join(assets, "frames");

const mastersDir = path.join(framesDir, "masters");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "caetano-frames-"));

const KEEP =
  "Edit this exact image. Keep the same character, the same canvas framing, the same scale and the same position on the canvas, the same feet placement, the same illustration style, line work, fur texture and colors, transparent background, no shadow, no text, no motion lines, no effects. Change only:";

const BLINK =
  "his eyes are closed in a quick blink (eyelids down, relaxed). Everything else pixel-identical.";

/** name → the frame it edits (or the old standing pose for the base) and what changes. */
const FRAMES = {
  idle: {
    from: path.join(assets, "caetano-pose-standing.png"),
    prompt:
      "Character test: the same monkey mascot from the reference image (black baseball cap, small gold hoop earring, magenta-pink hoodie, black and pink sneakers, curly tail). Full body, standing, friendly half smile, centered, plenty of margin, transparent background, no shadow, no text.",
  },
  blink: {
    from: "idle",
    prompt: `${KEEP} his eyes are gently closed in a relaxed blink (curved closed eyelids). Everything else pixel-identical.`,
  },
  wave1: {
    from: "idle",
    prompt: `${KEEP} his right arm (on the viewer's left side) is raised beside his head, open palm facing the viewer, waving hello, fingers spread. The other hand stays in the hoodie pocket. Bigger, happier smile.`,
  },
  wave2: {
    from: "wave1",
    prompt: `${KEEP} the waving hand and forearm are tilted further outward to the viewer's left, about 30 degrees, as the other end of the waving motion. Everything else identical.`,
  },
  read: {
    from: "idle",
    prompt: `${KEEP} he holds a smartphone with both hands at chest height and looks down at its screen, focused, curious little smile, eyes looking down at the phone.`,
  },
  read2: {
    from: "read",
    prompt: `${KEEP} his eyes look at the upper part of the phone screen and his thumb is raised slightly as if scrolling, small amused smile. Everything else identical.`,
  },
  "read-blink": { from: "read", prompt: `${KEEP} ${BLINK}` },
  think: {
    from: "idle",
    prompt: `${KEEP} one hand touches his chin in a thinking gesture, eyes looking up and to the side, mouth a small thoughtful line. The other hand stays in the hoodie pocket.`,
  },
  "think-blink": { from: "think", prompt: `${KEEP} ${BLINK}` },
  cheer: {
    from: "idle",
    prompt: `${KEEP} both arms are thrown up in the air in celebration, fists up, mouth open in a joyful laugh, eyes squinting with happiness. Feet stay in the same place.`,
  },
  sleepy: {
    from: "idle",
    prompt: `${KEEP} he is sleepy: eyes half-closed heavy lids, a small yawn with one hand rubbing an eye, slight slouch. The other hand stays in the pocket. Feet stay in the same place.`,
  },
};

const cwebp = (args) => execFileSync("cwebp", ["-quiet", ...args]);

const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".codex/auth.json"), "utf8"));

/** A frame's master as PNG: freshly generated this run, else decoded from the stored master. */
const sourceOf = (name) => {
  const fresh = path.join(work, `${name}.png`);

  if (fs.existsSync(fresh)) return fresh;

  if (path.isAbsolute(name)) return name;

  execFileSync("dwebp", ["-quiet", path.join(mastersDir, `${name}.webp`), "-o", fresh]);

  return fresh;
};

async function generate(name) {
  const { from, prompt } = FRAMES[name];
  const ref = sourceOf(from);
  const image = `data:image/png;base64,${fs.readFileSync(ref).toString("base64")}`;

  const response = await fetch("https://chatgpt.com/backend-api/codex/images/edits", {
    method: "POST",
    headers: {
      "chatgpt-account-id": auth.tokens.account_id,
      originator: "vanda",
      Authorization: `Bearer ${auth.tokens.access_token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      quality: "high",
      size: "1024x1024",
      background: "transparent",
      prompt,
      images: [{ image_url: image }],
    }),
  });

  const text = await response.text();

  if (!response.ok) throw new Error(`${name}: ${response.status} ${text.slice(0, 300)}`);

  const png = path.join(work, `${name}.png`);
  fs.writeFileSync(png, Buffer.from(JSON.parse(text).data[0].b64_json, "base64"));

  cwebp([
    "-q",
    "95",
    "-alpha_q",
    "100",
    "-m",
    "6",
    "-exact",
    png,
    "-o",
    path.join(mastersDir, `${name}.webp`),
  ]);
  cwebp([
    "-resize",
    "480",
    "480",
    "-q",
    "82",
    "-alpha_q",
    "90",
    png,
    "-o",
    path.join(framesDir, `${name}.webp`),
  ]);
  console.log("ok", name);
}

const wanted = process.argv.slice(2);

const names = wanted.length > 0 ? wanted : Object.keys(FRAMES);

for (const name of names) {
  if (!(name in FRAMES))
    throw new Error(`unknown frame ${name}: ${Object.keys(FRAMES).join(", ")}`);
}

// Bases first: a frame waits for the frame it edits when both are regenerated.
const done = new Map();

const run = (name) => {
  if (!done.has(name)) {
    const base = FRAMES[name].from;
    const before = names.includes(base) ? run(base) : Promise.resolve();
    done.set(
      name,
      before.then(() => generate(name)),
    );
  }

  return done.get(name);
};

await Promise.all(names.map(run));

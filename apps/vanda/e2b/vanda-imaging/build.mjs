// Builds and deploys the vanda-imaging E2B template (v2 cloud build — no local
// Docker). Run from this directory:
//
//   E2B_API_KEY=... node build.mjs
//
// The template is what the run_code tool boots: code-interpreter base (Jupyter
// kernel for runCode) + Pillow/numpy + a font pack for deterministic text.
// /home/user/fonts/manifest.json is the lookup table scripts read for paths.
import { Template, defaultBuildLogger, waitForPort } from "e2b";

const apiKey = process.env.E2B_API_KEY;
if (!apiKey) throw new Error("E2B_API_KEY is required");

const FONTS_BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl";
const FONTS = [
  ["Poppins-Regular.ttf", "poppins/Poppins-Regular.ttf"],
  ["Poppins-Medium.ttf", "poppins/Poppins-Medium.ttf"],
  ["Poppins-SemiBold.ttf", "poppins/Poppins-SemiBold.ttf"],
  ["Poppins-Bold.ttf", "poppins/Poppins-Bold.ttf"],
  ["Inter.ttf", "inter/Inter%5Bopsz%2Cwght%5D.ttf"],
  ["Montserrat.ttf", "montserrat/Montserrat%5Bwght%5D.ttf"],
  ["Lora.ttf", "lora/Lora%5Bwght%5D.ttf"],
  ["PlayfairDisplay.ttf", "playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf"],
  ["Roboto.ttf", "roboto/Roboto%5Bwdth%2Cwght%5D.ttf"],
];

const template = Template()
  .fromImage("e2bdev/code-interpreter:latest")
  .runCmd("pip install --no-cache-dir pillow numpy")
  .runCmd("mkdir -p /home/user/fonts")
  .runCmd(
    FONTS.map(
      ([file, path]) => `curl -fsSLo /home/user/fonts/${file} "${FONTS_BASE}/${path}"`,
    ),
  )
  .copy("manifest.json", "/home/user/fonts/manifest.json")
  .runCmd("chmod -R a+r /home/user/fonts")
  // The base image's runCode server (Jupyter kernel + gateway on 49999) does
  // not start by itself in v2 builds — boot it explicitly.
  .setStartCmd("sudo /root/.jupyter/start-up.sh", waitForPort(49999));

const info = await Template.build(template, "vanda-imaging", {
  apiKey,
  cpuCount: 2,
  memoryMB: 2048,
  onBuildLogs: defaultBuildLogger(),
});
console.log("built:", info);

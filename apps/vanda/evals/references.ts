import { Resvg } from "@resvg/resvg-js";
import type { EvalBrand } from "./fixtures";

/** Deliberately synthetic, deterministic reference art: never a claimed customer photo. */
export function referenceImage(caseId: string): Uint8Array {
  let background: string;
  let title: string;
  let art: string;

  switch (caseId) {
    case "orvalho-product-identity-revision":
      background = "#B96F57";
      title = "Cuidado que cabe no dia";
      art = `<rect x="442" y="300" width="140" height="110" rx="12" fill="#222"/>
        <rect x="380" y="390" width="264" height="480" rx="48" fill="#744218"/>
        <rect x="397" y="540" width="230" height="225" fill="#E9E1D3"/>
        <g fill="#315C4B" font-size="25"><text x="512" y="590">ORVALHO</text>
        <text x="512" y="645">Óleo Facial</text><text x="512" y="685">Sereno</text>
        <text x="512" y="733">30 ml</text></g>`;
      break;
    case "pimba-kit-revision":
      background = "#5B2EFF";
      title = "Cor sem pedir licença";
      art =
        ["#FF4F8B", "#5B2EFF", "#C7FF3D"]
          .map(
            (color, i) => `<g transform="translate(${310 + i * 150},350)">
          <rect width="75" height="440" rx="25" fill="${color}" stroke="white" stroke-width="7"/>
          <path d="M8 440 L37 520 L67 440Z" fill="${color}" stroke="white" stroke-width="7"/>
          <rect x="22" y="30" width="12" height="90" fill="white"/></g>`,
          )
          .join("") + `<text x="512" y="990" font-size="64" fill="white">R$ 32</text>`;
      break;
    case "caju-background-revision":
      background = "#7A3E2D";
      title = "Manhã sem pressa";
      art = `<ellipse cx="400" cy="690" rx="240" ry="45" fill="#F4E7D3"/>
        <ellipse cx="605" cy="500" rx="85" ry="105" fill="none" stroke="#2877A7" stroke-width="35"/>
        <path d="M200 420H590V570Q590 690 395 690Q200 690 200 570Z" fill="#2877A7"/>
        <ellipse cx="395" cy="420" rx="195" ry="48" fill="#41281F"/>
        <g fill="#DCA45C" stroke="#A57238" stroke-width="5">
        <circle cx="300" cy="880" r="62"/><circle cx="480" cy="870" r="62"/>
        <circle cx="660" cy="890" r="62"/></g>`;
      break;
    default:
      throw new Error(`No reference fixture for ${caseId}`);
  }

  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280">
    <rect width="1024" height="1280" fill="${background}"/>
    <g text-anchor="middle" font-family="DejaVu Sans">
    <text x="512" y="180" font-size="60" font-weight="bold" fill="white">${title}</text>
    ${art}</g></svg>`)
    .render()
    .asPng();
}

type FeedPost = NonNullable<EvalBrand["feed"]>[number];

const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * One already-published post of a fictional brand's feed. Every post shares the
 * layout the feed-fit case judges against: a mustard quarter circle top right, a
 * numbered pill top left, a white caps title over a mustard rule, a subtitle and
 * the handle at the foot. Synthetic and deterministic: never a customer's post.
 */
export function feedImage(brand: EvalBrand, post: FeedPost): Uint8Array {
  if (brand.feedStyle === "weak") return weakFeedImage(brand, post);
  const [ink, mustard, paper] = brand.design.colors.map((color) => color.hex);
  const owner = brand.owner ? person(800, 440, 0.75) : "";

  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280">
    <rect width="1024" height="1280" fill="${ink}"/>
    <circle cx="1024" cy="0" r="330" fill="${mustard}"/>
    <g font-family="DejaVu Sans" font-weight="bold">
    <rect x="80" y="96" width="236" height="68" rx="34" fill="${mustard}"/>
    <text x="198" y="143" font-size="34" text-anchor="middle" fill="${ink}">${escapeXml(post.tag)}</text>
    <text x="80" y="860" font-size="104" fill="white">${escapeXml(post.title)}</text></g>
    <rect x="80" y="900" width="180" height="12" fill="${mustard}"/>
    <g font-family="DejaVu Sans">
    <text x="80" y="985" font-size="42" fill="${paper}">${escapeXml(post.subtitle)}</text>
    <text x="80" y="1200" font-size="30" fill="white">${escapeXml(brand.handle)}</text></g>
    ${owner}</svg>`)
    .render()
    .asPng();
}

/**
 * The brand's owner, drawn the same way in every feed post and in her face photo:
 * red curly hair, round green glasses, a yellow blouse. Synthetic, so the reviewer
 * can tell whether the painted post kept her likeness without a real face.
 */
function person(cx: number, cy: number, scale: number): string {
  const curls = [
    [-120, -150],
    [-60, -195],
    [0, -210],
    [60, -195],
    [120, -150],
    [-150, -80],
    [150, -80],
    [-160, 0],
    [160, 0],
    [-140, 70],
    [140, 70],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="62" fill="#B3471D"/>`)
    .join("");

  return `<g transform="translate(${cx},${cy}) scale(${scale})">
    ${curls}
    <path d="M-230 420 Q-220 210 0 200 Q220 210 230 420Z" fill="#F2C14E"/>
    <rect x="-45" y="110" width="90" height="110" fill="#D99A6C"/>
    <ellipse cx="0" cy="0" rx="120" ry="150" fill="#E8AE80"/>
    <g fill="none" stroke="#2E8B57" stroke-width="10">
      <circle cx="-50" cy="-15" r="38"/><circle cx="50" cy="-15" r="38"/>
      <path d="M-12 -15 H12"/></g>
    <circle cx="-50" cy="-15" r="9" fill="#3B2A20"/><circle cx="50" cy="-15" r="9" fill="#3B2A20"/>
    <path d="M-50 70 Q0 115 50 70" fill="none" stroke="#8C3B2E" stroke-width="10" stroke-linecap="round"/>
  </g>`;
}

/** A plain face photo of the brand's owner, the kind she sends for her `face` reference. */
export function ownerFaceImage(): Uint8Array {
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
    <rect width="800" height="1000" fill="#E9E4DC"/>
    ${person(400, 520, 1.5)}</svg>`)
    .render()
    .asPng();
}

/**
 * One post of a feed with a clear identity and dated execution, like many small
 * shops' feeds: turquoise square, thin double white frame, a crammed black serif
 * title with a hard shadow, an orange starburst, a clip-art headphone and the
 * signature in a black footer band. Synthetic and deterministic.
 */
function weakFeedImage(brand: EvalBrand, post: FeedPost): Uint8Array {
  const [turquoise, black, white, orange] = brand.design.colors.map((color) => color.hex);
  const site = brand.facts.find((fact) => fact.startsWith("Site: "))?.slice(6, -1) ?? "";

  const star = Array.from({ length: 24 }, (_, i) => {
    const angle = (Math.PI * i) / 12;
    const radius = i % 2 === 0 ? 150 : 110;

    return `${Math.round(Math.cos(angle) * radius)},${Math.round(Math.sin(angle) * radius)}`;
  }).join(" ");

  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="1024" height="1024" fill="${turquoise}"/>
    <rect x="22" y="22" width="980" height="980" fill="none" stroke="${white}" stroke-width="5"/>
    <rect x="38" y="38" width="948" height="948" fill="none" stroke="${white}" stroke-width="2"/>
    <g font-family="DejaVu Serif" font-weight="bold" font-size="86" text-anchor="middle">
    <text x="518" y="176" fill="#5A5A5A">${escapeXml(post.title)}</text>
    <text x="512" y="170" fill="${black}">${escapeXml(post.title)}</text></g>
    <g transform="translate(470,560)">
      <path d="M-170 40 Q-170 -190 0 -190 Q170 -190 170 40" fill="none" stroke="${black}" stroke-width="34"/>
      <rect x="-215" y="10" width="90" height="170" rx="40" fill="${black}"/>
      <rect x="125" y="10" width="90" height="170" rx="40" fill="${black}"/>
      <ellipse cx="-185" cy="60" rx="14" ry="38" fill="${white}" opacity="0.8"/>
      <ellipse cx="155" cy="60" rx="14" ry="38" fill="${white}" opacity="0.8"/>
    </g>
    <g transform="translate(800,330) rotate(-14)">
      <polygon points="${star}" fill="${orange}" stroke="${black}" stroke-width="4"/>
      <text y="14" font-family="DejaVu Sans" font-weight="bold" font-size="40" text-anchor="middle" fill="${white}">${escapeXml(post.tag)}</text>
    </g>
    <text x="512" y="850" font-family="DejaVu Sans Mono" font-size="40" text-anchor="middle" fill="${white}">${escapeXml(post.subtitle)}</text>
    <rect x="38" y="900" width="948" height="86" fill="${black}"/>
    <text x="512" y="956" font-family="DejaVu Sans" font-size="34" text-anchor="middle" fill="${white}">${escapeXml(`${brand.handle} · ${site}`)}</text>
  </svg>`)
    .render()
    .asPng();
}

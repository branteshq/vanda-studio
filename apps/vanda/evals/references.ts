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
  const [ink, mustard, paper] = brand.design.colors.map((color) => color.hex);

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
    </svg>`)
    .render()
    .asPng();
}

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type scale's own sizes (globals.css `--text-*`). Without them tailwind-merge
// reads `text-body` as a color and drops the real color next to it, so a
// `subtle` button at size `sm` lost its muted `text-text-3`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["tiny", "micro", "fine", "note", "caption", "body-sm", "body", "card-title"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

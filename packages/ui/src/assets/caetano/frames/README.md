# Caetano frames

Caetano's animation frames, used by `apps/vanda/src/components/caetano.tsx`.

Every frame is an edit of the same base image (`idle`), so all of them share the canvas, the scale and the feet position. Swapping frames never moves his body; only the part that changes (eyes, an arm, the phone) differs. The motion on top (breathing, sway, pop, jump) is a CSS transform on the whole figure.

| Frame | Edits | Used for |
| --- | --- | --- |
| `idle` | the old standing pose | resting |
| `blink` | idle | random blink while resting |
| `wave1`, `wave2` | idle, wave1 | the wave (alternated) |
| `read`, `read2` | idle, read | reading the Instagram (alternated, like scrolling) |
| `read-blink` | read | blink while reading |
| `think`, `think-blink` | idle, think | thinking, and its blink |
| `cheer` | idle | the guide is done (with a jump) |
| `sleepy` | idle | easter egg: hovering "Terminar depois" |

- `*.webp`: 480px, what the app loads (about 33 KB each).
- `masters/*.webp`: the 1254px originals at quality 95, for new crops and sizes.

Regenerate or add frames with `node scripts/caetano-frames.mjs [name…]` (gpt-image-2 through your ChatGPT login; the prompts live in the script). A new frame must be an edit of an existing one, never a fresh drawing, or it will not line up. Check it by overlaying it on its base with `mix-blend-mode: difference`.

The older art in this folder (`caetano-pose-*`, `caetano-expression-*`, `work/`) was drawn pose by pose and does not line up between images; `work/` still drives Caetano in Posts automáticos.

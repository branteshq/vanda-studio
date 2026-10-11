import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * Full GitHub-flavored markdown for assistant/chat content. Element typography
 * (headings, lists, tables, code, rules, spacing) is owned entirely by Typeset
 * (`.typeset` + a density preset) — see packages/ui/src/styles/typeset.css. This
 * component only renders plain HTML and picks the preset; the single element
 * override below is behavioral (open links safely), not stylistic.
 *
 * Memoized on `children` so token-by-token streaming re-renders stay cheap.
 */

const baseComponents: Components = {
  a: (props) => <a target="_blank" rel="noreferrer" {...props} />,
};

function MarkdownImpl({
  children,
  className,
  variant = "chat",
  components: overrides,
}: {
  children: string;
  className?: string;
  variant?: "chat" | "reading";
  /** Per-element renderers layered over the defaults (e.g. a swatch for hex codes). */
  components?: Components;
}) {
  return (
    <div
      className={cn(
        "typeset text-text-2",
        variant === "reading" ? "typeset-reading" : "typeset-chat",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...baseComponents, ...overrides }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);

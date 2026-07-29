import { memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * Full GitHub-flavored markdown for assistant/chat content, styled with the
 * app's dark-theme tokens (no @tailwindcss/typography — element renderers keep
 * the output on-brand and readable at chat density). Memoized on `children` so
 * streaming re-renders stay cheap.
 */

const components: Components = {
  p: ({ className, ...props }) => (
    <p className={cn("leading-relaxed [&:not(:first-child)]:mt-3", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold text-text", className)} {...props} />
  ),
  em: ({ className, ...props }) => <em className={cn("italic", className)} {...props} />,
  del: ({ className, ...props }) => (
    <del className={cn("text-text-4 line-through", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "font-medium text-brand-accent underline decoration-brand-accent/40 underline-offset-2 hover:decoration-brand-accent",
        className,
      )}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn("my-3 ml-1 list-disc space-y-1 pl-4 marker:text-text-5", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn("my-3 ml-1 list-decimal space-y-1 pl-4 marker:text-text-5", className)}
      {...props}
    />
  ),
  li: ({ className, ...props }) => <li className={cn("pl-0.5", className)} {...props} />,
  h1: ({ className, ...props }) => (
    <h1
      className={cn("mt-4 mb-2 text-base font-semibold text-text first:mt-0", className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn("mt-4 mb-2 text-[15px] font-semibold text-text first:mt-0", className)}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn("mt-3 mb-1.5 text-sm font-semibold text-text first:mt-0", className)}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn("mt-3 mb-1.5 text-sm font-medium text-text first:mt-0", className)}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "my-3 border-l-2 border-border-strong pl-3 text-text-3 italic",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("my-4 border-border", className)} {...props} />
  ),
  code: ({ className, ...props }: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return <code className={cn("font-mono text-[0.85em]", className)} {...props} />;
    }
    return (
      <code
        className={cn(
          "rounded border border-border bg-inset px-1 py-0.5 font-mono text-[0.85em] text-text-2",
          className,
        )}
        {...props}
      />
    );
  },
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-3 overflow-x-auto rounded-lg border border-border bg-inset p-3 text-[0.85em] leading-relaxed text-text-2",
        className,
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-[0.9em]", className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "border border-border bg-surface px-2.5 py-1.5 font-semibold text-text",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border border-border px-2.5 py-1.5 align-top", className)} {...props} />
  ),
  img: ({ className, ...props }) => (
    <img className={cn("my-2 max-w-full rounded-lg border border-border", className)} {...props} />
  ),
};

function MarkdownImpl({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("min-w-0 wrap-break-word", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);

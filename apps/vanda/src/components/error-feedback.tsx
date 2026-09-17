import { toast } from "sonner";
import { errorCode, errorCopy, type ErrorCode } from "../errors";

/** The only error-to-toast bridge. Exception text is never used as UI copy. */
export function showErrorToast(error: unknown) {
  const copy = errorCopy[errorCode(error)];
  toast.error(copy.title, {
    description: copy.message,
    ...("action" in copy
      ? {
          action: { label: copy.action, onClick: () => window.location.assign(copy.href) },
        }
      : {}),
  });
}

export function ErrorNotice({ error, code }: { error?: unknown; code?: ErrorCode }) {
  const copy = errorCopy[code ?? errorCode(error)];
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive"
    >
      {copy.message}
      {"action" in copy ? (
        <a className="ml-2 font-medium underline underline-offset-4" href={copy.href}>
          {copy.action}
        </a>
      ) : null}
    </p>
  );
}

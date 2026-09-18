import { toast } from "sonner";
import { errorCode, errorCopy, type ErrorCode } from "../errors";

/** The only error-to-toast bridge. Exception text is never used as UI copy. */
export function createErrorToast(cause: unknown) {
  const copy = errorCopy[errorCode(cause)];
  const options: Parameters<typeof toast.error>[1] = { description: copy.message };

  if ("action" in copy) {
    options.action = { label: copy.action, onClick: () => window.location.assign(copy.href) };
  }

  return { title: copy.title, options };
}

export function showErrorToast(cause: unknown) {
  const notification = createErrorToast(cause);
  toast.error(notification.title, notification.options);
}

export function ErrorNotice({ error: cause, code }: { error?: unknown; code?: ErrorCode }) {
  const copy = errorCopy[code ?? errorCode(cause)];

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

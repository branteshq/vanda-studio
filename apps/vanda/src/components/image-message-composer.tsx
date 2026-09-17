import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@vanda-studio/ui/components/attachment";
import { Button } from "@vanda-studio/ui/components/button";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const MAX_COMPOSER_HEIGHT = 224;

export interface ReadyImageAttachment {
  imageId: Id<"images">;
  url: string;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
}

interface ComposerAttachment {
  clientId: string;
  fileName: string;
  previewUrl: string;
  mimeType: string;
  width: number;
  height: number;
  state: "uploading" | "error" | "done";
  imageId?: Id<"images">;
  url?: string;
  error?: string;
}

const imageDimensions = async (file: File): Promise<{ width: number; height: number }> => {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
};

const readyAttachment = (attachment: ComposerAttachment): ReadyImageAttachment | undefined =>
  attachment.state === "done" && attachment.imageId && attachment.url
    ? {
        imageId: attachment.imageId,
        url: attachment.url,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        width: attachment.width,
        height: attachment.height,
      }
    : undefined;

export function MessageImageAttachments({
  attachments,
}: {
  attachments: ReadonlyArray<Pick<ReadyImageAttachment, "url" | "fileName">>;
}) {
  if (attachments.length === 0) return null;
  return (
    <AttachmentGroup className="justify-end">
      {attachments.map((attachment) => (
        <Attachment key={attachment.url} orientation="vertical" size="sm" className="w-28">
          <AttachmentMedia variant="image" className="w-full">
            <img src={attachment.url} alt={attachment.fileName} loading="lazy" />
          </AttachmentMedia>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

export function ImageMessageComposer({
  accountId,
  draft,
  onDraftChange,
  onSend,
  placeholder,
  ariaLabel,
  agentName,
  disabled,
  autoFocus,
  working,
  onStop,
  error,
  hint,
}: {
  accountId: Id<"accounts"> | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string, attachments: ReadyImageAttachment[]) => Promise<void>;
  placeholder: string;
  ariaLabel: string;
  agentName: string;
  disabled?: boolean;
  autoFocus?: boolean;
  working?: boolean;
  onStop?: () => void;
  error?: string | null;
  hint?: string;
}) {
  const generateUploadUrl = useMutation(api.imageUploads.generateUploadUrl);
  const addImage = useMutation(api.imageUploads.addImage);
  const removeImage = useMutation(api.imageUploads.removeImage);
  const usage = useQuery(api.usage.summary);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
    element.style.overflowY = element.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const cancelledUploads = useRef(new Set<string>());
  const uploadControllers = useRef(new Map<string, AbortController>());

  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
        cancelledUploads.current.add(attachment.clientId);
      }
      for (const controller of uploadControllers.current.values()) controller.abort();
    },
    [],
  );

  const updateAttachment = (clientId: string, patch: Partial<ComposerAttachment>) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.clientId === clientId ? { ...attachment, ...patch } : attachment,
      ),
    );
  };

  const uploadFile = async (file: File) => {
    if (!accountId) return;
    const clientId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    const initial: ComposerAttachment = {
      clientId,
      fileName: file.name,
      previewUrl,
      mimeType: file.type || "image/jpeg",
      width: 1,
      height: 1,
      state: "uploading",
    };
    setAttachments((current) => [...current, initial]);

    if (!file.type.startsWith("image/")) {
      updateAttachment(clientId, { state: "error", error: "Formato não suportado" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      updateAttachment(clientId, { state: "error", error: "Máximo de 10 MB" });
      return;
    }

    const controller = new AbortController();
    uploadControllers.current.set(clientId, controller);
    try {
      const dimensions = await imageDimensions(file);
      updateAttachment(clientId, dimensions);
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`upload HTTP ${response.status}`);
      const payload = (await response.json()) as { storageId?: Id<"_storage"> };
      if (!payload.storageId) throw new Error("upload returned no storageId");
      const stored = await addImage({
        accountId,
        storageId: payload.storageId,
        mimeType: file.type,
        ...dimensions,
      });
      if (cancelledUploads.current.has(clientId)) {
        await removeImage({ accountId, imageId: stored.imageId });
        return;
      }
      updateAttachment(clientId, {
        state: "done",
        imageId: stored.imageId,
        url: stored.url,
        ...dimensions,
      });
    } catch (cause) {
      if (!cancelledUploads.current.has(clientId)) {
        updateAttachment(clientId, {
          state: "error",
          error: cause instanceof Error ? cause.message : "Falha no envio",
        });
      }
    } finally {
      uploadControllers.current.delete(clientId);
    }
  };

  const selectFiles = (files: Iterable<File> | null) => {
    if (!files) return;
    const remaining = Math.max(0, 4 - attachments.length);
    for (const file of Array.from(files).slice(0, remaining)) void uploadFile(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    const images =
      clipboardFiles.length > 0
        ? clipboardFiles
        : Array.from(event.clipboardData.items).flatMap((item) => {
            if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
            const file = item.getAsFile();
            return file ? [file] : [];
          });
    if (images.length === 0) return;
    event.preventDefault();
    selectFiles(images);
  };

  const removeAttachment = (attachment: ComposerAttachment) => {
    cancelledUploads.current.add(attachment.clientId);
    uploadControllers.current.get(attachment.clientId)?.abort();
    URL.revokeObjectURL(attachment.previewUrl);
    setAttachments((current) =>
      current.filter((candidate) => candidate.clientId !== attachment.clientId),
    );
    if (accountId && attachment.imageId) {
      void removeImage({ accountId, imageId: attachment.imageId });
    }
  };

  const readyAttachments = attachments
    .map(readyAttachment)
    .filter((attachment): attachment is ReadyImageAttachment => attachment !== undefined);
  const attachmentsSettled = attachments.every((attachment) => attachment.state === "done");
  const canSend =
    !disabled &&
    !working &&
    !submitting &&
    attachmentsSettled &&
    (draft.trim().length > 0 || readyAttachments.length > 0);

  const submit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    try {
      await onSend(draft, readyAttachments);
      for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl);
      setAttachments([]);
    } catch {
      // The parent restores text; uploaded images remain available for retry.
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  if (usage?.chatLimited) {
    return (
      <footer className="shrink-0 bg-app px-4 py-3 md:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="min-w-0">
              <p className="text-body font-medium text-text">Limite de uso do plano atingido</p>
              <p className="mt-0.5 text-body-sm leading-relaxed text-text-3">
                {agentName} pausa por aqui até a renovação — ou faça upgrade para continuar agora.
              </p>
            </div>
            <Button size="sm" onClick={() => void navigate({ to: "/perfil" })}>
              Ver planos
            </Button>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="shrink-0 bg-app px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-2 focus-within:border-border-strong"
        >
          {attachments.length > 0 ? (
            <AttachmentGroup className="w-full">
              {attachments.map((attachment) => (
                <Attachment
                  key={attachment.clientId}
                  orientation="vertical"
                  size="sm"
                  state={attachment.state}
                  className="w-24"
                >
                  <AttachmentMedia variant="image" className="w-full">
                    <img src={attachment.previewUrl} alt={attachment.fileName} />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{attachment.fileName}</AttachmentTitle>
                    <AttachmentDescription>
                      {attachment.state === "uploading"
                        ? "Enviando…"
                        : attachment.state === "error"
                          ? (attachment.error ?? "Falha no envio")
                          : `${attachment.width}×${attachment.height}`}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      type="button"
                      aria-label={`Remover ${attachment.fileName}`}
                      disabled={submitting}
                      onClick={() => removeAttachment(attachment)}
                      className="bg-surface/90 shadow-sm"
                    >
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          ) : null}

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            aria-label={ariaLabel}
            rows={1}
            autoFocus={autoFocus}
            className="min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-5"
          />

          <div className="flex items-center justify-between">
            <ActionTooltip label="Adicionar imagens" side="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Adicionar imagens"
                disabled={!accountId || disabled || submitting || attachments.length >= 4}
                onClick={() => inputRef.current?.click()}
                className="text-text-4 hover:text-text"
              >
                <Paperclip />
              </Button>
            </ActionTooltip>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => selectFiles(event.target.files)}
            />
            {working && onStop ? (
              <ActionTooltip label="Parar" side="top">
                <Button type="button" size="icon-sm" aria-label="Parar geração" onClick={onStop}>
                  <Square className="size-3 fill-current" />
                </Button>
              </ActionTooltip>
            ) : (
              <ActionTooltip label="Enviar" side="top">
                <span className="inline-flex">
                  <Button type="submit" size="icon-sm" aria-label="Enviar" disabled={!canSend}>
                    <ArrowUp />
                  </Button>
                </span>
              </ActionTooltip>
            )}
          </div>
        </form>
        {error ? <p className="mt-2 px-2 text-xs text-danger">{error}</p> : null}
        {hint ? <p className="mt-2 text-center text-[11px] text-text-3">{hint}</p> : null}
      </div>
    </footer>
  );
}

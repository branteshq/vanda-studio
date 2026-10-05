import { useState } from "react";
import { useMutation } from "convex/react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vanda-studio/ui/components/dialog";
import { Input } from "@vanda-studio/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vanda-studio/ui/components/select";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CadenceEntry } from "../../convex/autopilotModel";
import { showErrorToast } from "../error-feedback";
import { WEEKDAY_NAMES } from "./week-strip";

/**
 * The weekly cadence template: which days, at what time, image or carousel
 * and how many slides. Saving makes it the owner's; the agent then only plans
 * the content of each post.
 */

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

const MAX_ROWS = 7;

type Row = CadenceEntry & { key: string };

export function CadenceEditor({
  accountId,
  cadence,
  source,
  open,
  onClose,
}: {
  accountId: Id<"accounts">;
  cadence: readonly CadenceEntry[];
  source: "agent" | "owner";
  open: boolean;
  onClose: () => void;
}) {
  const updateCadence = useMutation(api.autopilot.updateCadence);
  const resetCadence = useMutation(api.autopilot.resetCadence);

  const [rows, setRows] = useState<Row[]>(() =>
    cadence.map((entry) => ({ ...entry, key: crypto.randomUUID() })),
  );

  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);

    try {
      await action();
      onClose();
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(false);
    }
  };

  const update = (index: number, patch: Partial<CadenceEntry>) =>
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;

        const next = { ...row, ...patch };

        if (next.type === "image") next.slideCount = 1;
        else next.slideCount = Math.min(10, Math.max(2, next.slideCount));

        return next;
      }),
    );

  const valid = rows.length > 0 && rows.every((row) => /^\d{2}:\d{2}$/.test(row.time));

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-dvh max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cadência da semana</DialogTitle>
          <DialogDescription>
            Os dias e horários em que o piloto publica, no horário de Brasília. Ao salvar, a
            cadência passa a ser sua e a Vanda planeja só o conteúdo de cada post.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {rows.map((row, index) => (
            <div key={row.key} className="flex items-center gap-2">
              <Select
                value={String(row.weekday)}
                onValueChange={(value) => update(index, { weekday: Number(value) })}
              >
                <SelectTrigger className="w-32" aria-label="Dia">
                  <SelectValue>{(value) => WEEKDAY_NAMES[Number(value)]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONDAY_FIRST.map((weekday) => (
                    <SelectItem key={weekday} value={String(weekday)}>
                      {WEEKDAY_NAMES[weekday]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="time"
                className="w-24"
                aria-label="Horário"
                value={row.time}
                onChange={(event) => update(index, { time: event.target.value })}
              />
              <Select
                value={row.type}
                onValueChange={(value) =>
                  update(index, { type: value === "carousel" ? "carousel" : "image" })
                }
              >
                <SelectTrigger className="w-32" aria-label="Formato">
                  <SelectValue>
                    {(value) => (value === "carousel" ? "Carrossel" : "Imagem")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="carousel">Carrossel</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                className="w-16"
                aria-label="Slides"
                min={1}
                max={10}
                value={row.slideCount}
                disabled={row.type === "image"}
                onChange={(event) => update(index, { slideCount: Number(event.target.value) || 2 })}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remover"
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {rows.length < MAX_ROWS ? (
            <Button
              variant="subtle"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  {
                    weekday: 3,
                    time: "18:00",
                    type: "image",
                    slideCount: 1,
                    key: crypto.randomUUID(),
                  },
                ])
              }
            >
              <Plus /> Adicionar dia
            </Button>
          ) : null}
        </div>

        <DialogFooter>
          {source === "owner" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await resetCadence({ accountId });
                })
              }
            >
              <Sparkles /> Voltar à sugestão da Vanda
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={!valid || busy}
            onClick={() =>
              void run(async () => {
                await updateCadence({
                  accountId,
                  cadence: rows.map(({ key: _key, ...entry }) => entry),
                });
              })
            }
          >
            Salvar cadência
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

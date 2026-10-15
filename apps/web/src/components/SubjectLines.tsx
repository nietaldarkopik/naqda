"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import type { Subject } from "@/lib/inventory";

export interface SubjectLine extends Subject {
  quantity: string;
  unitCost: string;
  /** Saldo sistem saat dipilih (hanya untuk penyesuaian). */
  system?: number;
}

/** Pencarian objek stok (item terlacak atau bahan) dengan hasil yang bisa diklik. */
export function SubjectPicker({ onPick, exclude, label }: { onPick: (s: Subject) => void; exclude: Set<string>; label: string }) {
  const t = useTranslations("inventory");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Subject[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      api<{ items: Subject[] }>(`/inventory/subjects?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.items))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(id);
  }, [q, open]);

  return (
    <div className="relative">
      <Input aria-label={label} placeholder={label} value={q} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} />
      {open ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-lg" role="listbox">
          {results.filter((r) => !exclude.has(`${r.subjectType}:${r.subjectId}`)).map((r) => (
            <button
              key={`${r.subjectType}:${r.subjectId}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onPick(r);
                setQ("");
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-surface-2"
            >
              <span>{r.name}</span>
              <span className="text-xs text-muted">{r.unit} · {t(`kind.${r.subjectType}`)}</span>
            </button>
          ))}
          {results.length === 0 ? <div className="px-3 py-2 text-sm text-muted">{t("noSubjects")}</div> : null}
          <button type="button" onClick={() => setOpen(false)} className="w-full border-t border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-2">
            {t("closeList")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Baris-baris objek + jumlah (+ biaya) untuk PO, transfer, dan penyesuaian. */
export function SubjectLines({
  lines,
  onChange,
  quantityLabel,
  costLabel,
  showSystem,
  error,
}: {
  lines: SubjectLine[];
  onChange: (next: SubjectLine[]) => void;
  quantityLabel: string;
  costLabel?: string | undefined;
  showSystem?: boolean;
  error?: string | undefined;
}) {
  const t = useTranslations("inventory");
  const set = (i: number, patch: Partial<SubjectLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <SubjectPicker
        label={t("addSubject")}
        exclude={new Set(lines.map((l) => `${l.subjectType}:${l.subjectId}`))}
        onPick={(s) => onChange([...lines, { ...s, quantity: "", unitCost: "" }])}
      />
      {lines.length === 0 ? <p className="text-sm text-muted">{t("noLines")}</p> : null}
      {lines.map((l, i) => (
        <div key={`${l.subjectType}:${l.subjectId}`} className="grid items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
          <div className="min-w-0">
            <div className="truncate font-medium">{l.name}</div>
            <div className="text-xs text-muted">
              {l.unit}
              {showSystem && l.system !== undefined ? ` · ${t("system")}: ${l.system}` : ""}
            </div>
          </div>
          <label className="text-xs text-muted">
            {quantityLabel}
            <Input aria-label={`${quantityLabel} ${l.name}`} inputMode="decimal" dir="ltr" className="mt-0.5 text-start" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
          </label>
          {costLabel ? (
            <label className="text-xs text-muted">
              {costLabel}
              <Input aria-label={`${costLabel} ${l.name}`} inputMode="decimal" dir="ltr" className="mt-0.5 text-start" value={l.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} />
            </label>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`${t("remove")} ${l.name}`}>
            <Trash2 size={15} className="text-danger" aria-hidden />
          </Button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

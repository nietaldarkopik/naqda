"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, CheckList, Input } from "@/components/ui";
import { api, type Paged } from "@/lib/api";
import { presets, type Filters, type Preset } from "@/lib/reports";

interface Props {
  filters: Filters;
  onPreset: (p: Preset) => void;
  onRange: (from: string, to: string) => void;
  onOutlets: (ids: string[]) => void;
  onExport?: (() => void) | undefined;
  exporting?: boolean;
  extra?: React.ReactNode;
}

/** Bilah filter bersama semua laporan: pilihan rentang cepat, tanggal bebas, outlet, dan ekspor CSV. */
export function ReportFilters({ filters, onPreset, onRange, onOutlets, onExport, exporting, extra }: Props) {
  const t = useTranslations("reports");
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api<Paged<{ id: string; name: string }>>("/outlets?pageSize=100").then((r) => setOutlets(r.items)).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3" data-testid="report-filters">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("period")}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPreset(p)}
            aria-pressed={filters.preset === p}
            className={`h-8 rounded-full border px-3 text-sm ${filters.preset === p ? "border-brand bg-brand text-white" : "border-line hover:bg-surface-2"}`}
          >
            {t(`presets.${p}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("from")}</span>
          <Input type="date" dir="ltr" className="w-40 text-start" value={filters.from} max={filters.to} onChange={(e) => e.target.value && onRange(e.target.value, filters.to)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t("to")}</span>
          <Input type="date" dir="ltr" className="w-40 text-start" value={filters.to} min={filters.from} onChange={(e) => e.target.value && onRange(filters.from, e.target.value)} />
        </label>
        <details className="relative text-sm">
          <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-line bg-surface px-3">
            {filters.outletIds.length === 0 ? t("allOutlets") : t("outletsSelected", { count: filters.outletIds.length })}
          </summary>
          <div className="absolute z-20 mt-1 w-64 rounded-md border border-line bg-surface p-2 shadow-lg">
            <CheckList options={outlets.map((o) => ({ value: o.id, label: o.name }))} value={filters.outletIds} onChange={onOutlets} />
            {filters.outletIds.length ? (
              <Button variant="ghost" className="mt-1 w-full" onClick={() => onOutlets([])}>
                {t("allOutlets")}
              </Button>
            ) : null}
          </div>
        </details>
        {extra}
        {onExport ? (
          <Button variant="secondary" className="ms-auto" onClick={onExport} disabled={exporting} data-testid="export-csv">
            <Download size={15} aria-hidden /> {t("exportCsv")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

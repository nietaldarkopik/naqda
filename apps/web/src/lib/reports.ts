import { useCallback, useMemo, useState } from "react";

export type ColType = "text" | "int" | "qty" | "money" | "percent" | "datetime" | "minutes";
export interface Col {
  key: string;
  type: ColType;
}
export type Cell = string | number | null;

export interface ReportTable {
  range: { from: string; to: string };
  outlets: { id: string; name: string; timezone?: string }[];
  columns: Col[];
  rows: Record<string, Cell>[];
  totals?: Record<string, Cell>;
  total?: number;
  page?: number;
  pageSize?: number;
  [extra: string]: unknown;
}

export const isoDate = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

export const presets = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"] as const;
export type Preset = (typeof presets)[number];

export const presetRange = (p: Preset, now = new Date()): { from: string; to: string } => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (p) {
    case "today":
      return { from: isoDate(today), to: isoDate(today) };
    case "yesterday":
      return { from: isoDate(shift(today, -1)), to: isoDate(shift(today, -1)) };
    case "last7":
      return { from: isoDate(shift(today, -6)), to: isoDate(today) };
    case "last30":
      return { from: isoDate(shift(today, -29)), to: isoDate(today) };
    case "thisMonth":
      return { from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) };
    case "lastMonth":
      return { from: isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: isoDate(new Date(today.getFullYear(), today.getMonth(), 0)) };
  }
};

export interface Filters {
  from: string;
  to: string;
  outletIds: string[];
  preset: Preset | "custom";
}

/** Status filter laporan (rentang tanggal + outlet). Bawaan 7 hari terakhir, semua outlet. */
export function useReportFilters() {
  const [filters, setFilters] = useState<Filters>(() => ({ ...presetRange("last7"), outletIds: [], preset: "last7" }));
  const query = useMemo(() => {
    const p = new URLSearchParams({ from: filters.from, to: filters.to });
    if (filters.outletIds.length) p.set("outletIds", filters.outletIds.join(","));
    return p.toString();
  }, [filters]);
  const setPreset = useCallback((preset: Preset) => setFilters((f) => ({ ...f, ...presetRange(preset), preset })), []);
  const setRange = useCallback((from: string, to: string) => setFilters((f) => ({ ...f, from, to, preset: "custom" })), []);
  const setOutlets = useCallback((outletIds: string[]) => setFilters((f) => ({ ...f, outletIds })), []);
  return { filters, query, setPreset, setRange, setOutlets };
}

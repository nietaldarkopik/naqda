"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui";
import { api, ApiError, type Paged } from "./api";

/** Daftar berhalaman dengan pencarian (ditunda 300 ms) dan filter tambahan. */
/** `enabled = false` menahan pemanggilan API (mis. pengguna tidak berhak), tanpa galat dan tanpa toast. */
export function useList<T>(path: string, pageSize = 10, extra: Record<string, string | undefined> = {}, enabled = true) {
  const toast = useToast();
  const t = useTranslations("errors");
  const [data, setData] = useState<Paged<T> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const extraKey = JSON.stringify(extra);
  const extraRef = useRef(extra);
  extraRef.current = extra;

  const load = useCallback(async () => {
    if (!enabled) return;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), q: query });
    for (const [k, v] of Object.entries(extraRef.current)) if (v) params.set(k, v);
    try {
      setData(await api<Paged<T>>(`${path}?${params.toString()}`));
    } catch (e) {
      toast(e instanceof ApiError && e.code !== "network" ? e.message : t("network"), "error");
    }
    // extraKey menggantikan objek extra agar efek hanya berjalan saat isinya berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, page, pageSize, query, extraKey, enabled, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setQuery(q);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  // Pindah ke halaman 1 saat filter berubah.
  useEffect(() => {
    setPage(1);
  }, [extraKey]);

  return { data, page, setPage, q, setQ, reload: load, pageSize };
}

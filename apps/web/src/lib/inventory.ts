import { useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { api, type Paged } from "./api";

export interface OutletLite {
  id: string;
  name: string;
}

/** Daftar outlet milik bisnis dan outlet terpilih (yang pertama bila belum dipilih). */
export function useOutletChoice() {
  const [outlets, setOutlets] = useState<OutletLite[]>([]);
  const [outletId, setOutletId] = useState("");
  useEffect(() => {
    api<Paged<OutletLite>>("/outlets?pageSize=100")
      .then((r) => {
        setOutlets(r.items);
        setOutletId((cur) => cur || r.items[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);
  return { outlets, outletId, setOutletId };
}

/** Jumlah stok: sampai 3 desimal, digit Latin. */
export const useQtyFormat = (locale: Locale) =>
  useMemo(() => {
    const f = new Intl.NumberFormat(intlTags[locale], { maximumFractionDigits: 3 });
    return (v: number) => f.format(v);
  }, [locale]);

/** Teks desimal pengguna ("2,5" atau "2.5") menjadi angka; null bila tidak valid atau lebih dari 3 desimal. */
export const parseDecimal = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(t)) return null;
  return Number(t);
};

export interface Subject {
  subjectType: "variant" | "ingredient";
  subjectId: string;
  name: string;
  unit: string;
}

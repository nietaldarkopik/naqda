import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { ReceiptSettings } from "@/components/ReceiptView";

export interface PaymentMethodRow {
  id: string;
  key: string;
  name: string | null;
  isSystem: boolean;
  enabled: boolean;
  position: number;
  outletIds: string[];
}

export interface AllSettings {
  checkout: { taxEnabled: boolean; gratuityEnabled: boolean; allowSplitPayment: boolean };
  receipt: ReceiptSettings;
  notifications: { dailySummary: boolean; lowStock: boolean; recipients: string[] };
  account: { employeeSlots: number | null };
  paymentMethods: PaymentMethodRow[];
}

/** Memuat semua pengaturan akun dan menyimpan satu bagian. Galat per bidang dikembalikan agar form bisa menampilkannya. */
export function useSettings() {
  const [data, setData] = useState<AllSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api<AllSettings>("/settings"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "network");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (section: "checkout" | "receipt" | "notifications" | "account", body: unknown): Promise<{ ok: true } | { ok: false; fields: Record<string, string>; message: string }> => {
      try {
        await api(`/settings/${section}`, { method: "PUT", json: body });
        await reload();
        return { ok: true };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, fields: e.fields ?? {}, message: e.message };
        return { ok: false, fields: {}, message: "network" };
      }
    },
    [reload],
  );

  return { data, error, reload, save };
}

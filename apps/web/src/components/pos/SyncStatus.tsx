"use client";

import { AlertTriangle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge, Button, Modal } from "@/components/ui";
import type { OfflineStatus } from "@/lib/offline/engine";
import type { Ctx } from "./PosApp";

/** Tombol di header kasir: status koneksi dan jumlah penjualan yang menunggu sinkron. */
export function SyncBadge({ status, onOpen }: { status: OfflineStatus; onOpen: () => void }) {
  const t = useTranslations("offline");
  const label = !status.online ? t("offline") : status.failed > 0 ? t("failedCount", { count: status.failed }) : status.pending > 0 ? t("pending", { count: status.pending }) : t("online");
  const warn = !status.online || status.failed > 0;
  const Icon = status.failed > 0 ? AlertTriangle : !status.online ? WifiOff : status.syncing ? RefreshCw : Wifi;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="sync-badge"
      data-online={status.online}
      data-pending={status.pending}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium ${warn ? "border-line bg-warn-soft text-ink" : "border-line bg-surface hover:bg-surface-2"}`}
    >
      <Icon size={15} className={status.syncing ? "animate-spin" : undefined} aria-hidden />
      <span>{label}</span>
      {!status.online && status.pending > 0 ? <span className="tabular-nums text-muted">· {status.pending}</span> : null}
    </button>
  );
}

export function SyncDialog({ ctx, status, onClose }: { ctx: Ctx; status: OfflineStatus; onClose: () => void }) {
  const t = useTranslations("offline");
  const tc = useTranslations("common");
  const locale = useLocale();
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const reason = (code: string | undefined, raw: string | undefined) => (code && t.has(`codes.${code}`) ? t(`codes.${code}`) : (raw ?? ""));
  const waiting = status.entries.filter((e) => e.state === "pending");
  const failed = status.entries.filter((e) => e.state === "failed");

  return (
    <Modal
      open
      title={t("dialogTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => void status.flush()} disabled={!status.online || status.syncing || status.pending === 0} data-testid="sync-now">
            <RefreshCw size={15} className={status.syncing ? "animate-spin" : undefined} aria-hidden /> {status.syncing ? t("syncing") : t("syncNow")}
          </Button>
          <Button onClick={onClose}>{tc("close")}</Button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Badge tone={status.online ? "good" : "warn"}>{status.online ? t("online") : t("offline")}</Badge>
        {status.pending === 0 && status.failed === 0 ? <span className="text-sm text-muted">{t("allSynced")}</span> : null}
      </div>
      {!status.persistent ? <p className="rounded-lg bg-warn-soft p-3 text-sm">{t("notPersistent")}</p> : null}

      {failed.length > 0 ? (
        <section className="space-y-2" aria-label={t("failedTitle")}>
          <h3 className="text-sm font-semibold">{t("failedTitle")}</h3>
          <ul className="divide-y divide-line rounded-lg border border-danger/40">
            {failed.map((e) => (
              <li key={e.op.clientId} className="space-y-1 p-3 text-sm" data-testid="sync-failed">
                <div className="flex justify-between gap-2">
                  <span className="font-medium" dir="ltr">{e.op.clientRef}</span>
                  <span className="tabular-nums">{ctx.fmt(e.op.total)}</span>
                </div>
                <p className="text-danger">{reason(e.code, e.lastError)}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => void status.retry(e.op.clientId)}>
                    {t("retry")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-danger"
                    onClick={() => {
                      if (window.confirm(t("discardConfirm"))) void status.discard(e.op.clientId);
                    }}
                  >
                    {t("discard")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2" aria-label={t("queueTitle")}>
        <h3 className="text-sm font-semibold">{t("queueTitle")}</h3>
        {waiting.length === 0 ? <p className="text-sm text-muted">{t("queueEmpty")}</p> : null}
        <ul className="divide-y divide-line rounded-lg border border-line empty:hidden">
          {waiting.map((e) => (
            <li key={e.op.clientId} className="flex items-start justify-between gap-2 p-3 text-sm" data-testid="sync-pending">
              <div className="min-w-0">
                <div className="font-medium" dir="ltr">{e.op.clientRef}</div>
                <div className="text-xs text-muted">
                  {time(e.op.createdAt)}
                  {e.lastError ? ` · ${reason(e.code, e.lastError)}` : ""}
                </div>
              </div>
              <span className="tabular-nums">{ctx.fmt(e.op.total)}</span>
            </li>
          ))}
        </ul>
      </section>

      {status.synced.length > 0 ? (
        <section className="space-y-2" aria-label={t("syncedTitle")}>
          <h3 className="text-sm font-semibold">{t("syncedTitle")}</h3>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {status.synced.slice(0, 10).map((r) => (
              <li key={r.clientId} className="flex items-start justify-between gap-2 p-3 text-sm" data-testid="sync-done">
                <div className="min-w-0">
                  <div dir="ltr">
                    <span className="text-muted">{r.clientRef}</span> → <span className="font-medium">#{r.receiptNumber ?? "?"}</span>
                  </div>
                  {r.flags.length > 0 ? <div className="text-xs text-muted">{r.flags.map((f) => (t.has(`flags.${f}`) ? t(`flags.${f}`) : f)).join(" · ")}</div> : null}
                </div>
                <span className="text-xs text-muted">{time(r.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Modal>
  );
}

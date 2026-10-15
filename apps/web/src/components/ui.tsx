"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong disabled:opacity-60",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2 disabled:opacity-60",
  danger: "bg-danger text-white hover:opacity-90 disabled:opacity-60",
  ghost: "text-ink hover:bg-surface-2 disabled:opacity-60",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
    />
  );
}

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputBase =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-brand disabled:opacity-60";

export function Input({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || undefined} className={cx(inputBase, invalid && "border-danger", className)} />;
}

export function Select({ invalid, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select {...props} aria-invalid={invalid || undefined} className={cx(inputBase, invalid && "border-danger", className)} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "bad" | "warn"; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-2 text-muted border border-line",
    good: "bg-brand-soft text-brand-strong",
    bad: "bg-danger-soft text-danger",
    warn: "bg-warn-soft text-ink",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Formulir besar (mis. item dengan banyak varian). */
  wide?: boolean;
}) {
  const t = useTranslations("common");
  const ref = useRef<HTMLDivElement>(null);
  // `onClose` biasanya fungsi baru di setiap render induk. Disimpan di ref agar efek di bawah TIDAK berjalan ulang tiap
  // ketikan (yang dulu memindahkan fokus ke tombol X dan mengganggu pengetikan).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // Fokus awal hanya saat dialog dibuka: kolom isian pertama di badan dialog (bukan tombol X di header).
  useEffect(() => {
    if (!open) return;
    const body = ref.current?.querySelector<HTMLElement>("[data-modal-body]");
    (body?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea") ?? body?.querySelector<HTMLElement>("button") ?? ref.current?.querySelector<HTMLElement>("button"))?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx("w-full rounded-xl border border-line bg-surface shadow-xl", wide ? "max-w-4xl" : "max-w-lg")}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("cancel")} className="rounded p-1 text-muted hover:bg-surface-2">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4" data-modal-body>
          {children}
        </div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>
  );
}

interface ToastItem {
  id: number;
  text: string;
  tone: "ok" | "error";
}
const ToastContext = createContext<(text: string, tone?: "ok" | "error") => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { id, text, tone }]);
    setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), 3500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 end-4 z-[60] space-y-2">
        {items.map((i) => (
          <div
            key={i.id}
            className={cx(
              "pointer-events-auto rounded-md px-4 py-2.5 text-sm font-medium text-white shadow-lg",
              i.tone === "ok" ? "bg-brand-strong" : "bg-danger",
            )}
          >
            {i.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const t = useTranslations("common");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
      <span>{t("page", { page, total: pages })}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("previous")}
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t("next")}
        </Button>
      </div>
    </div>
  );
}

/** Daftar kotak centang (banyak pilihan), mis. outlet, modifier, hari. */
export function CheckList({
  options,
  value,
  onChange,
  maxHeight = "10rem",
}: {
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  maxHeight?: string;
}) {
  return (
    <div className="space-y-1 overflow-y-auto rounded-md border border-line p-2" style={{ maxHeight }}>
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-2">
          <input
            type="checkbox"
            checked={value.includes(o.value)}
            onChange={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export interface Column<R> {
  key: string;
  header: string;
  cell: (row: R) => ReactNode;
  align?: "start" | "end";
}

/** Tabel data dengan keadaan memuat, kosong, dan kolom aksi opsional. */
export function DataTable<R extends { id: string }>({
  columns,
  rows,
  actions,
  emptyText,
  loadingText,
}: {
  columns: Column<R>[];
  rows: R[] | null;
  actions?: (row: R) => ReactNode;
  emptyText: string;
  loadingText: string;
}) {
  const t = useTranslations("common");
  const span = columns.length + (actions ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-2.5 font-medium ${c.align === "end" ? "text-end" : "text-start"}`}>
                {c.header}
              </th>
            ))}
            {actions ? <th className="px-4 py-2.5 text-end font-medium">{t("actions")}</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows?.map((row) => (
            <tr key={row.id} className="hover:bg-surface-2/60">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 ${c.align === "end" ? "text-end" : "text-start"}`}>
                  {c.cell(row)}
                </td>
              ))}
              {actions ? (
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">{actions(row)}</div>
                </td>
              ) : null}
            </tr>
          ))}
          {rows && rows.length === 0 ? (
            <tr>
              <td colSpan={span} className="px-4 py-10 text-center text-muted">
                {emptyText}
              </td>
            </tr>
          ) : null}
          {!rows ? (
            <tr>
              <td colSpan={span} className="px-4 py-10 text-center text-muted">
                {loadingText}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string | undefined; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("min-h-20 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand", props.className)} />;
}

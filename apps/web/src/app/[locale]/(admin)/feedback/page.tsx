"use client";

import { Frown, Smile } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { intlTags, type Locale } from "@naqdi/i18n";
import { Badge, Button, Card, Input, PageHeader, Pager, Select, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row {
  id: string;
  rating: "good" | "bad";
  comment: string | null;
  reply: string | null;
  repliedBy: string | null;
  repliedAt: string | null;
  customer: string | null;
  outlet: string;
  receipt: number | null;
  at: string;
}
interface Listing {
  items: Row[];
  total: number;
  summary: { good: number; bad: number };
}

const pageSize = 15;

export default function FeedbackPage() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("customers.manage");
  const [data, setData] = useState<Listing | null>(null);
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState("");
  const [outletId, setOutletId] = useState("");
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const num = useMemo(() => new Intl.NumberFormat(intlTags[locale]), [locale]);
  const when = useMemo(() => new Intl.DateTimeFormat(intlTags[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);
  const failed = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : t("errors.network"), "error"), [toast, t]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (rating) p.set("rating", rating);
    if (outletId) p.set("outletId", outletId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    try {
      setData(await api<Listing>(`/feedback?${p}`));
    } catch (e) {
      failed(e);
    }
  }, [page, rating, outletId, from, to, failed]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<{ items: { id: string; name: string }[] }>("/outlets?pageSize=100").then((r) => setOutlets(r.items)).catch(() => undefined);
  }, []);

  const reply = async (id: string) => {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    try {
      await api(`/feedback/${id}/reply`, { method: "POST", json: { reply: text } });
      setDrafts((d) => ({ ...d, [id]: "" }));
      toast(t("common.saved"));
      await load();
    } catch (e) {
      failed(e);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("feedback.title")} subtitle={t("feedback.subtitle")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="flex items-center gap-3 p-4">
          <Smile className="text-brand" aria-hidden />
          <div>
            <div className="text-sm text-muted">{t("feedback.good")}</div>
            <div className="text-2xl font-semibold tabular-nums" data-testid="fb-good">{data ? num.format(data.summary.good) : "-"}</div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <Frown className="text-danger" aria-hidden />
          <div>
            <div className="text-sm text-muted">{t("feedback.bad")}</div>
            <div className="text-2xl font-semibold tabular-nums" data-testid="fb-bad">{data ? num.format(data.summary.bad) : "-"}</div>
          </div>
        </Card>
      </div>
      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <Select aria-label={t("devices.outlet")} value={outletId} onChange={(e) => { setOutletId(e.target.value); setPage(1); }} className="max-w-56">
            <option value="">{t("common.allOutlets")}</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
          <Select aria-label={t("feedback.rating")} value={rating} onChange={(e) => { setRating(e.target.value); setPage(1); }} className="max-w-40">
            <option value="">{t("feedback.allRatings")}</option>
            <option value="good">{t("feedback.good")}</option>
            <option value="bad">{t("feedback.bad")}</option>
          </Select>
          <label className="text-sm"><span className="mb-1 block text-muted">{t("reports.from")}</span><Input type="date" dir="ltr" className="w-40 text-start" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
          <label className="text-sm"><span className="mb-1 block text-muted">{t("reports.to")}</span><Input type="date" dir="ltr" className="w-40 text-start" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        </div>
        <ul className="divide-y divide-line" data-testid="feedback-list">
          {data?.items.map((r) => (
            <li key={r.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.rating === "good" ? "good" : "bad"}>{r.rating === "good" ? t("feedback.good") : t("feedback.bad")}</Badge>
                <span className="font-medium">{r.customer ?? t("feedback.anonymous")}</span>
                <span className="text-xs text-muted">{r.outlet}{r.receipt ? ` · #${r.receipt}` : ""} · <span className="ltr-text">{when.format(new Date(r.at))}</span></span>
              </div>
              {r.comment ? <p className="text-sm">{r.comment}</p> : <p className="text-sm text-muted">{t("feedback.noComment")}</p>}
              {r.reply ? (
                <div className="rounded-lg bg-surface-2 p-3 text-sm">
                  <div className="text-xs text-muted">{t("feedback.repliedBy", { name: r.repliedBy ?? "-" })}</div>
                  {r.reply}
                </div>
              ) : manage ? (
                <div className="flex gap-2">
                  <Input aria-label={t("feedback.replyPlaceholder")} placeholder={t("feedback.replyPlaceholder")} value={drafts[r.id] ?? ""} maxLength={1000} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} />
                  <Button variant="secondary" onClick={() => void reply(r.id)} disabled={!(drafts[r.id] ?? "").trim()}>{t("feedback.reply")}</Button>
                </div>
              ) : null}
            </li>
          ))}
          {data && data.items.length === 0 ? <li className="p-10 text-center text-muted">{t("common.noData")}</li> : null}
        </ul>
        {data ? <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>
    </div>
  );
}

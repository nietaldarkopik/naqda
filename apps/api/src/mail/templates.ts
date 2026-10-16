import { exponentOf, formatMoney } from "@naqdi/domain";
import { intlTags, type Locale } from "@naqdi/i18n";

export type MailLocale = Locale;

/** Isi email per jenis. Semua nilai sudah berupa teks; jumlah uang diformat saat render dari `amount` + `currency`. */
export interface MailData {
  test: { to: string };
  welcome: { name: string; business: string; trialDays: number; loginUrl: string };
  invoice_issued: { name: string; business: string; number: string; plan: string; interval: "monthly" | "yearly"; amount: number; currency: string; dueDate: string; billingUrl: string; bankInfo?: string | null };
  proof_received: { business: string; number: string; amount: number; currency: string; reviewUrl: string };
  payment_approved: { name: string; business: string; number: string; periodEnd: string; billingUrl: string };
  payment_rejected: { name: string; business: string; number: string; reason: string; billingUrl: string };
}
export type MailKind = keyof MailData;

interface Body {
  subject: string;
  /** Satu paragraf per elemen. */
  lines: string[];
  cta?: { label: string; url: string };
}

const money = (amount: number, currency: string, locale: Locale) => formatMoney(amount, exponentOf(currency), currency, intlTags[locale]);
const cycle: Record<Locale, Record<"monthly" | "yearly", string>> = {
  id: { monthly: "bulanan", yearly: "tahunan" },
  en: { monthly: "monthly", yearly: "yearly" },
  ar: { monthly: "شهري", yearly: "سنوي" },
};

const bodies: { [K in MailKind]: Record<Locale, (d: MailData[K]) => Body> } = {
  test: {
    id: () => ({ subject: "Uji pengiriman email Naqdi", lines: ["Email ini dikirim untuk menguji pengaturan SMTP Naqdi. Jika Anda membacanya, pengiriman berjalan."] }),
    en: () => ({ subject: "Naqdi email delivery test", lines: ["This message tests Naqdi's SMTP settings. If you can read it, delivery works."] }),
    ar: () => ({ subject: "اختبار إرسال البريد من نقدي", lines: ["هذه الرسالة لاختبار إعدادات SMTP في نقدي. إذا قرأتها فالإرسال يعمل."] }),
  },
  welcome: {
    id: (d) => ({ subject: `Selamat datang di Naqdi, ${d.business}`, lines: [`Halo ${d.name},`, `Akun ${d.business} sudah dibuat. Anda punya ${d.trialDays} hari uji coba gratis, tanpa kartu kredit.`, "Masuk, atur outlet dan menu Anda, lalu coba kasirnya."], cta: { label: "Masuk ke Naqdi", url: d.loginUrl } }),
    en: (d) => ({ subject: `Welcome to Naqdi, ${d.business}`, lines: [`Hello ${d.name},`, `The account for ${d.business} is ready. You have a free ${d.trialDays}-day trial, no credit card needed.`, "Sign in, set up your outlet and menu, then try the register."], cta: { label: "Sign in to Naqdi", url: d.loginUrl } }),
    ar: (d) => ({ subject: `مرحبًا بك في نقدي، ${d.business}`, lines: [`مرحبًا ${d.name}،`, `تم إنشاء حساب ${d.business}. لديك تجربة مجانية لمدة ${d.trialDays} يومًا دون بطاقة ائتمان.`, "سجّل الدخول وجهّز فرعك وقائمتك ثم جرّب الكاشير."], cta: { label: "الدخول إلى نقدي", url: d.loginUrl } }),
  },
  invoice_issued: {
    id: (d) => ({ subject: `Faktur ${d.number} untuk ${d.business}`, lines: [`Halo ${d.name},`, `Faktur ${d.number}: paket ${d.plan} (${cycle.id[d.interval]}) sebesar ${money(d.amount, d.currency, "id")}, jatuh tempo ${d.dueDate}.`, ...(d.bankInfo ? ["Transfer ke:", d.bankInfo] : ["Hubungi pengelola Naqdi untuk rekening pembayaran."]), "Setelah transfer, kirim bukti di halaman Langganan agar kami verifikasi."], cta: { label: "Kirim bukti transfer", url: d.billingUrl } }),
    en: (d) => ({ subject: `Invoice ${d.number} for ${d.business}`, lines: [`Hello ${d.name},`, `Invoice ${d.number}: ${d.plan} plan (${cycle.en[d.interval]}) for ${money(d.amount, d.currency, "en")}, due ${d.dueDate}.`, ...(d.bankInfo ? ["Transfer to:", d.bankInfo] : ["Contact the Naqdi operator for the payment account."]), "After transferring, send the proof on the Subscription page so we can verify it."], cta: { label: "Send transfer proof", url: d.billingUrl } }),
    ar: (d) => ({ subject: `الفاتورة ${d.number} لـ ${d.business}`, lines: [`مرحبًا ${d.name}،`, `الفاتورة ${d.number}: باقة ${d.plan} (${cycle.ar[d.interval]}) بمبلغ ${money(d.amount, d.currency, "ar")}، تستحق في ${d.dueDate}.`, ...(d.bankInfo ? ["حوّل إلى:", d.bankInfo] : ["تواصل مع مشغّل نقدي للحصول على حساب الدفع."]), "بعد التحويل أرسل الإثبات في صفحة الاشتراك لنتحقق منه."], cta: { label: "إرسال إثبات التحويل", url: d.billingUrl } }),
  },
  proof_received: {
    id: (d) => ({ subject: `Bukti transfer masuk: ${d.business} (${d.number})`, lines: [`${d.business} mengirim bukti untuk faktur ${d.number} sebesar ${money(d.amount, d.currency, "id")}.`, "Periksa dan setujui atau tolak di panel pengelola."], cta: { label: "Buka antrean pembayaran", url: d.reviewUrl } }),
    en: (d) => ({ subject: `Transfer proof received: ${d.business} (${d.number})`, lines: [`${d.business} sent proof for invoice ${d.number} of ${money(d.amount, d.currency, "en")}.`, "Review it and approve or reject in the operator panel."], cta: { label: "Open payment queue", url: d.reviewUrl } }),
    ar: (d) => ({ subject: `وصل إثبات تحويل: ${d.business} (${d.number})`, lines: [`أرسل ${d.business} إثباتًا للفاتورة ${d.number} بمبلغ ${money(d.amount, d.currency, "ar")}.`, "راجعه ووافق أو ارفض في لوحة المشغّل."], cta: { label: "فتح قائمة المدفوعات", url: d.reviewUrl } }),
  },
  payment_approved: {
    id: (d) => ({ subject: `Pembayaran diterima: ${d.number}`, lines: [`Halo ${d.name},`, `Pembayaran faktur ${d.number} untuk ${d.business} sudah kami terima. Langganan Anda aktif sampai ${d.periodEnd}.`, "Terima kasih telah memakai Naqdi."], cta: { label: "Lihat langganan", url: d.billingUrl } }),
    en: (d) => ({ subject: `Payment received: ${d.number}`, lines: [`Hello ${d.name},`, `We received the payment for invoice ${d.number} of ${d.business}. Your subscription is active until ${d.periodEnd}.`, "Thank you for using Naqdi."], cta: { label: "View subscription", url: d.billingUrl } }),
    ar: (d) => ({ subject: `تم استلام الدفع: ${d.number}`, lines: [`مرحبًا ${d.name}،`, `استلمنا دفع الفاتورة ${d.number} لـ ${d.business}. اشتراكك فعّال حتى ${d.periodEnd}.`, "شكرًا لاستخدامك نقدي."], cta: { label: "عرض الاشتراك", url: d.billingUrl } }),
  },
  payment_rejected: {
    id: (d) => ({ subject: `Bukti transfer perlu diperbaiki: ${d.number}`, lines: [`Halo ${d.name},`, `Bukti untuk faktur ${d.number} (${d.business}) belum bisa kami terima: ${d.reason}`, "Silakan kirim ulang bukti yang benar."], cta: { label: "Kirim ulang bukti", url: d.billingUrl } }),
    en: (d) => ({ subject: `Transfer proof needs attention: ${d.number}`, lines: [`Hello ${d.name},`, `We could not accept the proof for invoice ${d.number} (${d.business}): ${d.reason}`, "Please send the correct proof again."], cta: { label: "Resend proof", url: d.billingUrl } }),
    ar: (d) => ({ subject: `إثبات التحويل يحتاج إلى تصحيح: ${d.number}`, lines: [`مرحبًا ${d.name}،`, `تعذّر قبول إثبات الفاتورة ${d.number} (${d.business}): ${d.reason}`, "يرجى إرسال الإثبات الصحيح مرة أخرى."], cta: { label: "إعادة إرسال الإثبات", url: d.billingUrl } }),
  },
};

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Mencegah tautan bukan-http (mis. javascript:) masuk ke atribut href. */
const safeUrl = (u: string): string => (/^https?:\/\//i.test(u) ? u : "#");

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

/** Merender email jadi teks biasa dan HTML sederhana (tabel satu kolom, gaya sebaris; aman untuk klien email). Arab memakai arah kanan-ke-kiri. */
export const renderMail = <K extends MailKind>(kind: K, locale: Locale, data: MailData[K]): Rendered => {
  const body = (bodies[kind][locale] as (d: MailData[K]) => Body)(data);
  const text = [...body.lines, ...(body.cta ? [`${body.cta.label}: ${body.cta.url}`] : []), "", "Naqdi"].join("\n\n").replace(/\n\n\n/g, "\n\n");
  const dir = locale === "ar" ? "rtl" : "ltr";
  const paragraphs = body.lines.map((l) => `<p style="margin:0 0 14px;line-height:1.55;white-space:pre-line">${escapeHtml(l)}</p>`).join("");
  const button = body.cta ? `<p style="margin:22px 0"><a href="${escapeHtml(safeUrl(body.cta.url))}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(body.cta.label)}</a></p>` : "";
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933"><table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px"><tr><td style="padding:28px" dir="${dir}"><div style="font-size:20px;font-weight:700;color:#0f766e;margin-bottom:18px">Naqdi</div>${paragraphs}${button}</td></tr></table></body></html>`;
  return { subject: body.subject, text, html };
};

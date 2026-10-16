import nodemailer from "nodemailer";
import type { Config } from "../config";
import { logLine } from "../logging";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** `sent` = diserahkan ke server SMTP; `logged` = driver "log" (hanya dicatat, tidak keluar dari mesin ini). */
export type SendOutcome = "sent" | "logged";

export interface MailTransport {
  readonly driver: "smtp" | "log" | "memory";
  send(mail: OutgoingMail): Promise<SendOutcome>;
  /** Memeriksa koneksi dan login SMTP tanpa mengirim email. */
  verify(): Promise<void>;
}

/** Pengirim SMTP lewat nodemailer. Batas waktu pendek agar server SMTP yang macet tidak menahan pekerja. */
export const smtpTransport = (config: Config["mail"]): MailTransport => {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.pass } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    driver: "smtp",
    async send(mail) {
      await transporter.sendMail({ from: config.from, ...(config.replyTo ? { replyTo: config.replyTo } : {}), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      return "sent";
    },
    async verify() {
      await transporter.verify();
    },
  };
};

/** Tanpa SMTP: pesan dicatat di log (tanpa isi, supaya data pribadi tidak masuk berkas log) dan ditandai "logged". */
export const logTransport = (): MailTransport => ({
  driver: "log",
  async send(mail) {
    logLine("info", "mail.logged", { to: mail.to, subject: mail.subject });
    return "logged";
  },
  async verify() {
    /* tidak ada koneksi untuk diperiksa */
  },
});

/** Untuk tes: menyimpan pesan di memori dan bisa dipaksa gagal. */
export const memoryTransport = (): MailTransport & { sent: OutgoingMail[]; failNext: (n: number, message?: string) => void } => {
  let failures = 0;
  let failMessage = "gagal uji";
  const sent: OutgoingMail[] = [];
  return {
    driver: "memory",
    sent,
    failNext(n, message = "gagal uji") {
      failures = n;
      failMessage = message;
    },
    async send(mail) {
      if (failures > 0) {
        failures--;
        throw new Error(failMessage);
      }
      sent.push(mail);
      return "sent";
    },
    async verify() {
      if (failures > 0) throw new Error(failMessage);
    },
  };
};

export const createTransport = (config: Config): MailTransport => (config.mail.driver === "smtp" ? smtpTransport(config.mail) : logTransport());

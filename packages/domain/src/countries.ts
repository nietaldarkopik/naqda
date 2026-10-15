/**
 * Negara yang ditawarkan di pendaftaran beserta bawaan yang masuk akal (mata uang, zona waktu, bahasa antarmuka).
 * Hanya SARAN untuk mengisi formulir; semuanya bisa diubah pendaftar. Negara lain bisa ditambahkan tanpa mengubah logika.
 * Mata uang harus ada di `supportedCurrencies` dan zona waktu harus zona IANA yang sah (dijaga oleh tes).
 */
export interface CountryInfo {
  code: string;
  currency: string;
  timezone: string;
  locale: "id" | "en" | "ar";
}

export const countries: readonly CountryInfo[] = [
  { code: "ID", currency: "IDR", timezone: "Asia/Jakarta", locale: "id" },
  { code: "SG", currency: "SGD", timezone: "Asia/Singapore", locale: "en" },
  { code: "MY", currency: "MYR", timezone: "Asia/Kuala_Lumpur", locale: "en" },
  { code: "BN", currency: "BND", timezone: "Asia/Brunei", locale: "en" },
  { code: "TH", currency: "THB", timezone: "Asia/Bangkok", locale: "en" },
  { code: "PH", currency: "PHP", timezone: "Asia/Manila", locale: "en" },
  { code: "VN", currency: "VND", timezone: "Asia/Ho_Chi_Minh", locale: "en" },
  { code: "IN", currency: "INR", timezone: "Asia/Kolkata", locale: "en" },
  { code: "CN", currency: "CNY", timezone: "Asia/Shanghai", locale: "en" },
  { code: "HK", currency: "HKD", timezone: "Asia/Hong_Kong", locale: "en" },
  { code: "JP", currency: "JPY", timezone: "Asia/Tokyo", locale: "en" },
  { code: "KR", currency: "KRW", timezone: "Asia/Seoul", locale: "en" },
  { code: "AU", currency: "AUD", timezone: "Australia/Sydney", locale: "en" },
  { code: "NZ", currency: "NZD", timezone: "Pacific/Auckland", locale: "en" },
  { code: "US", currency: "USD", timezone: "America/New_York", locale: "en" },
  { code: "CA", currency: "CAD", timezone: "America/Toronto", locale: "en" },
  { code: "GB", currency: "GBP", timezone: "Europe/London", locale: "en" },
  { code: "DE", currency: "EUR", timezone: "Europe/Berlin", locale: "en" },
  { code: "FR", currency: "EUR", timezone: "Europe/Paris", locale: "en" },
  { code: "NL", currency: "EUR", timezone: "Europe/Amsterdam", locale: "en" },
  { code: "ES", currency: "EUR", timezone: "Europe/Madrid", locale: "en" },
  { code: "IT", currency: "EUR", timezone: "Europe/Rome", locale: "en" },
  { code: "CH", currency: "CHF", timezone: "Europe/Zurich", locale: "en" },
  { code: "TR", currency: "TRY", timezone: "Europe/Istanbul", locale: "en" },
  { code: "SA", currency: "SAR", timezone: "Asia/Riyadh", locale: "ar" },
  { code: "AE", currency: "AED", timezone: "Asia/Dubai", locale: "ar" },
  { code: "QA", currency: "QAR", timezone: "Asia/Qatar", locale: "ar" },
  { code: "KW", currency: "KWD", timezone: "Asia/Kuwait", locale: "ar" },
  { code: "BH", currency: "BHD", timezone: "Asia/Bahrain", locale: "ar" },
  { code: "OM", currency: "OMR", timezone: "Asia/Muscat", locale: "ar" },
  { code: "JO", currency: "JOD", timezone: "Asia/Amman", locale: "ar" },
  { code: "EG", currency: "EGP", timezone: "Africa/Cairo", locale: "ar" },
];

export const countryInfo = (code: string): CountryInfo | undefined => countries.find((c) => c.code === code.toUpperCase());

/** Negara yang zona waktunya sama dengan zona waktu peramban (tebakan awal formulir); null bila tidak ada yang cocok. */
export const guessCountry = (browserTimezone: string): CountryInfo | null => countries.find((c) => c.timezone === browserTimezone) ?? null;

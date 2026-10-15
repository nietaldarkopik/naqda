/** Kebijakan PIN kasir. Murni. */

export const PIN_MIN = 4;
export const PIN_MAX = 6;

export const isValidPinFormat = (pin: string): boolean => new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);

/** PIN yang mudah ditebak: semua angka sama (0000), berurutan naik/turun (1234, 4321), atau pola berulang (1212). */
export const isWeakPin = (pin: string): boolean => {
  if (!isValidPinFormat(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  if (pin.length % 2 === 0 && pin.slice(0, pin.length / 2) === pin.slice(pin.length / 2)) return true;
  return false;
};

/**
 * Lama penguncian (detik) setelah `failures` kesalahan beruntun: bebas sampai 4 kali, lalu 30 detik, berlipat dua
 * setiap kesalahan berikutnya, maksimal 30 menit. PIN hanya 4-6 digit, jadi pembatasan ini wajib.
 */
export const lockoutSeconds = (failures: number): number => {
  if (!Number.isInteger(failures) || failures < 0) throw new RangeError("failures harus integer >= 0");
  if (failures < 5) return 0;
  return Math.min(30 * 2 ** (failures - 5), 1800);
};

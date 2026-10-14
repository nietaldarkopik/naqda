/**
 * CSV minimal sesuai RFC 4180 untuk impor/ekspor item. Tanpa dependensi.
 * - Mengenali pemisah koma atau titik koma (Excel berbahasa Indonesia memakai titik koma).
 * - Mengabaikan BOM UTF-8, menerima CRLF atau LF, mendukung kutip ganda dan baris baru di dalam sel.
 */

export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export const detectDelimiter = (text: string): "," | ";" | "\t" => {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  const best = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [","])[0] as "," | ";" | "\t";
  return (counts[best] ?? 0) > 0 ? best : ",";
};

export class CsvError extends Error {}

export const parseCsv = (input: string, delimiter?: string): string[][] => {
  const text = stripBom(input);
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let sawAny = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    sawAny = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      if (cell !== "") throw new CsvError("Tanda kutip muncul di tengah sel tanpa dikutip");
      inQuotes = true;
    } else if (ch === d) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (inQuotes) throw new CsvError("Tanda kutip tidak ditutup");
  if (sawAny && (cell !== "" || row.length > 0)) endRow();
  return rows;
};

/** Menulis CSV. Sel yang berisi pemisah, kutip, atau baris baru dikutip. Awalan = + - @ dinetralkan (injeksi rumus). */
export const toCsv = (rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>, delimiter = ","): string =>
  rows
    .map((row) =>
      row
        .map((value) => {
          let s = value === null || value === undefined ? "" : String(value);
          if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
          return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(delimiter),
    )
    .join("\r\n");

/** Baris pertama sebagai header; mengembalikan objek per baris dengan nomor baris asli (mulai 2). */
export const parseCsvTable = (input: string): Array<{ line: number; values: Record<string, string> }> => {
  const rows = parseCsv(input);
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((cells, index) => ({
    line: index + 2,
    values: Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? "").trim()])),
  }));
};

"use client";

import { useId } from "react";

/** Grafik SVG ringan tanpa pustaka: area (garis dengan isian) dan batang. Sumbu waktu selalu LTR. */

interface Point {
  label: string;
  value: number;
}

const niceMax = (v: number): number => {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
};

const W = 640;
const H = 200;
const PAD = { l: 12, r: 22, t: 10, b: 24 };

export function AreaChart({ data, format, ariaLabel }: { data: Point[]; format: (v: number) => string; ariaLabel: string }) {
  const id = useId();
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const step = data.length > 1 ? (W - PAD.l - PAD.r) / (data.length - 1) : 0;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const pts = data.map((d, i) => [PAD.l + i * step, y(d.value)] as const);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1]![0].toFixed(1)},${H - PAD.b} L${PAD.l},${H - PAD.b} Z` : "";
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel} style={{ direction: "ltr" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeDasharray="3 3" />
        </g>
      ))}
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" />
      {pts.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r="3" fill="var(--brand)">
          <title>{`${data[i]!.label}: ${format(data[i]!.value)}`}</title>
        </circle>
      ))}
      {data.map((d, i) =>
        i % every === 0 ? (
          <text key={i} x={PAD.l + i * step} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">
            {d.label}
          </text>
        ) : null,
      )}
      <text x={W - PAD.r} y={PAD.t + 2} fontSize="10" textAnchor="end" fill="var(--muted)">
        {format(max)}
      </text>
    </svg>
  );
}

export function BarChart({ data, format, ariaLabel }: { data: Point[]; format: (v: number) => string; ariaLabel: string }) {
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const slot = (W - PAD.l - PAD.r) / Math.max(1, data.length);
  const bw = Math.max(2, slot * 0.7);
  const every = Math.max(1, Math.ceil(data.length / 12));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel} style={{ direction: "ltr" }}>
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--border)" />
      {data.map((d, i) => {
        const h = (H - PAD.t - PAD.b) * (d.value / max);
        const x = PAD.l + i * slot + (slot - bw) / 2;
        return (
          <g key={i}>
            <rect x={x} y={H - PAD.b - h} width={bw} height={Math.max(0, h)} rx="2" fill="var(--brand)" opacity={d.value > 0 ? 1 : 0.15}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            {i % every === 0 ? (
              <text x={x + bw / 2} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--muted)">
                {d.label}
              </text>
            ) : null}
          </g>
        );
      })}
      <text x={W - PAD.r} y={PAD.t + 2} fontSize="10" textAnchor="end" fill="var(--muted)">
        {format(max)}
      </text>
    </svg>
  );
}

/** Batang horizontal berlabel (untuk porsi kategori). */
export function ShareBars({ rows }: { rows: { label: string; value: number; text: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-sm">
            <span className="truncate">{r.label}</span>
            <span className="tabular-nums text-muted">{r.text}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-2">
            <div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

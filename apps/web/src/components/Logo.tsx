/**
 * Logo Naqdi (public/logo.png, 96x96 transparan). Lencana putih di belakangnya menjaga huruf biru tua tetap terbaca di latar gelap
 * (sidebar). Berkas kecil, jadi tampilkan paling besar sekitar 64 px agar tetap tajam di layar retina.
 */
export function Logo({ size = 40, framed = false, className = "" }: { size?: number; framed?: boolean; className?: string }) {
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png" width={size} height={size} alt="Naqdi" decoding="async" className="block select-none" draggable={false} />
  );
  if (!framed) return <span className={`inline-flex shrink-0 ${className}`}>{image}</span>;
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm ${className}`}>{image}</span>;
}

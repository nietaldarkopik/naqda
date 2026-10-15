import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PlatformShell } from "@/components/platform/PlatformShell";

// Panel pengelola tidak untuk diindeks mesin pencari.
export const metadata: Metadata = { title: "Naqdi Platform", robots: { index: false, follow: false } };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}

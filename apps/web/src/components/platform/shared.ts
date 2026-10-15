export interface BizRow {
  id: string;
  name: string;
  country: string | null;
  currency: string;
  locale?: string;
  plan: string;
  status: string;
  access: { level: "full" | "grace" | "locked"; reason: string; daysLeft: number | null; graceDaysLeft: number | null };
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  billingInterval?: "monthly" | "yearly" | null;
  suspendedAt?: string | null;
  suspendReason?: string | null;
  termsAcceptedAt?: string | null;
  termsVersion?: string | null;
  limitsOverride?: Record<string, number> | null;
  owner?: { name: string; email: string } | null;
  usage?: { outlets: number; devices: number; employees: number };
  limits: { maxOutlets: number; maxDevices: number; maxEmployees: number };
  orders30d?: number;
  lastOrderAt?: string | null;
  createdAt: string;
}

export const levelTone = (l: string): "good" | "warn" | "bad" => (l === "locked" ? "bad" : l === "grace" ? "warn" : "good");
export const fmtLimit = (n: number): string => (n >= Number.MAX_SAFE_INTEGER ? "∞" : String(n));

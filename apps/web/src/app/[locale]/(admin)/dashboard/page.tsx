"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { api, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function DashboardPage() {
  const t = useTranslations();
  const { user, can } = useAuth();
  const [outlets, setOutlets] = useState<number | null>(null);
  const [employees, setEmployees] = useState<number | null>(null);

  useEffect(() => {
    api<Paged<unknown>>("/outlets?pageSize=1").then((r) => setOutlets(r.total)).catch(() => undefined);
    if (can("employees.manage")) api<Paged<unknown>>("/employees?pageSize=1").then((r) => setEmployees(r.total)).catch(() => undefined);
  }, [can]);

  const stat = (label: string, value: number | null) => (
    <Card className="p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value ?? "-"}</div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
        <p className="mt-1 text-muted">{t("dashboard.welcome", { name: user?.name ?? "" })}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stat(t("nav.outlets"), outlets)}
        {can("employees.manage") ? stat(t("nav.employees"), employees) : null}
      </div>
      <Card className="bg-warn-soft p-5 text-sm">{t("dashboard.phase0")}</Card>
    </div>
  );
}

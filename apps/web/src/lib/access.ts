/**
 * Hak yang dibutuhkan untuk membuka halaman Back Office (cukup salah satu). API tetap yang menegakkan; ini hanya agar
 * pengguna tidak melihat menu dan halaman yang pasti ditolak. Urutan penting: awalan yang lebih spesifik lebih dulu.
 */
const rules: [prefix: string, anyOf: string[]][] = [
  ["/reports", ["reports.view"]],
  ["/activities", ["reports.view"]],
  ["/employees", ["employees.manage"]],
  ["/roles", ["employees.manage"]],
  ["/tables", ["tables.manage"]],
  ["/devices", ["settings.manage"]],
  ["/audit", ["settings.manage"]],
  ["/settings", ["settings.manage"]],
  ["/ingredients", ["inventory.manage", "reports.view"]],
  ["/recipes", ["inventory.manage", "reports.view"]],
  ["/inventory", ["inventory.manage", "reports.view"]],
  ["/suppliers", ["inventory.manage", "reports.view"]],
  ["/customers", ["customers.manage", "reports.view"]],
  ["/loyalty", ["customers.manage", "reports.view"]],
  ["/feedback", ["customers.manage", "reports.view"]],
];

export const requiredPrivileges = (pathname: string): string[] => {
  for (const [prefix, anyOf] of rules) if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return anyOf;
  return ["backoffice.view"];
};

export const canOpen = (pathname: string, can: (p: string) => boolean): boolean => {
  // Dasbor ramah untuk semua pengguna Back Office (kartunya sendiri butuh reports.view).
  if (pathname === "/dashboard") return true;
  return requiredPrivileges(pathname).some(can);
};

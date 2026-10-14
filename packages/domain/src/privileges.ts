/**
 * Daftar hak akses (privilege) dan peran bawaan.
 * Aturan murni: tanpa dependensi ke web, database, atau React (doc 02, bagian 1a).
 */

export const privileges = [
  "backoffice.view",
  "reports.view",
  "library.manage",
  "inventory.manage",
  "customers.manage",
  "employees.manage",
  "outlets.manage",
  "settings.manage",
  "tables.manage",
  "pos.sell",
  "pos.discount",
  "pos.refund",
  "pos.void",
  "shift.manage",
] as const;

export type Privilege = (typeof privileges)[number];

export const isPrivilege = (value: unknown): value is Privilege =>
  typeof value === "string" && (privileges as readonly string[]).includes(value);

export const accessTypes = ["app_only", "backoffice_only", "app_and_backoffice"] as const;
export type AccessType = (typeof accessTypes)[number];

export const hasBackofficeAccess = (access: AccessType): boolean => access !== "app_only";
export const hasAppAccess = (access: AccessType): boolean => access !== "backoffice_only";

export interface SystemRole {
  /** Kunci tetap; nama tampilan diambil dari katalog i18n (`roles.<key>`). */
  key: "administrator" | "cashier" | "headBarKitchen" | "investor" | "regionalManager";
  accessType: AccessType;
  privileges: readonly Privilege[];
}

export const systemRoles: readonly SystemRole[] = [
  { key: "administrator", accessType: "app_and_backoffice", privileges },
  {
    key: "cashier",
    accessType: "app_only",
    privileges: ["pos.sell", "shift.manage"],
  },
  {
    key: "headBarKitchen",
    accessType: "app_and_backoffice",
    privileges: ["backoffice.view", "reports.view", "inventory.manage", "pos.sell", "pos.void", "shift.manage"],
  },
  {
    key: "investor",
    accessType: "backoffice_only",
    privileges: ["backoffice.view", "reports.view"],
  },
  {
    key: "regionalManager",
    accessType: "backoffice_only",
    privileges: [
      "backoffice.view",
      "reports.view",
      "library.manage",
      "inventory.manage",
      "customers.manage",
      "employees.manage",
      "outlets.manage",
      "tables.manage",
    ],
  },
];

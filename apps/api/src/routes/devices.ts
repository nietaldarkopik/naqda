import { randomInt } from "node:crypto";
import { assertWithinLimit } from "../billing/access";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { devices, newId, outlets, type DbHandle } from "@naqdi/db";
import { AppError, duplicateKey } from "../errors";
import { iso, requirePrivilege, validate, type AppEnv } from "../http";
import { sha256 } from "../pos/context";
import { writeAudit } from "../repo/audit";

type Db = DbHandle["db"];

const idParam = z.object({ id: z.string().uuid() });
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I agar tidak salah baca
const CODE_TTL_MS = 15 * 60_000;

const makeCode = (): string => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
const display = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

type DeviceRow = typeof devices.$inferSelect;

const status = (d: DeviceRow, now = Date.now()): "revoked" | "active" | "expired" | "pending" => {
  if (d.revokedAt) return "revoked";
  if (d.activatedAt) return "active";
  if (d.activationExpiresAt && d.activationExpiresAt.getTime() < now) return "expired";
  return "pending";
};

const present = (d: DeviceRow, outletName: string | null) => ({
  id: d.id,
  name: d.name,
  outletId: d.outletId,
  outletName,
  status: status(d),
  activatedAt: iso(d.activatedAt),
  lastSeenAt: iso(d.lastSeenAt),
  createdAt: iso(d.createdAt),
});

/** Pendaftaran perangkat kasir dari Back Office. Hak: settings.manage. */
export const deviceRoutes = () => {
  const app = new Hono<AppEnv>();
  app.use("*", requirePrivilege("settings.manage"));

  const issueCode = async (db: Db, id: string, businessId: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        await db
          .update(devices)
          .set({ activationCodeHash: sha256(code), activationExpiresAt: new Date(Date.now() + CODE_TTL_MS), tokenHash: null, activatedAt: null })
          .where(and(eq(devices.id, id), eq(devices.businessId, businessId), isNull(devices.revokedAt)));
        return code;
      } catch (error) {
        if (!duplicateKey(error)) throw error;
      }
    }
    throw new AppError("server");
  };

  app.get("/", async (c) => {
    const rows = await c
      .get("db")
      .select({ device: devices, outletName: outlets.name })
      .from(devices)
      .innerJoin(outlets, eq(devices.outletId, outlets.id))
      .where(eq(devices.businessId, c.get("auth").businessId))
      .orderBy(asc(outlets.name), asc(devices.name));
    return c.json({ items: rows.map((r) => present(r.device, r.outletName)) });
  });

  app.post("/", validate("json", z.object({ outletId: z.string().uuid(), name: z.string().trim().min(1).max(120) })), async (c) => {
    const { outletId, name } = c.req.valid("json");
    const auth = c.get("auth");
    const db = c.get("db");
    const outlet = await c.get("repo").outlets.get(outletId);
    if (!outlet) throw new AppError("validation", { fields: { outletId: "errors.notFound" } });
    await assertWithinLimit(db, auth.businessId, "devices");
    const id = newId();
    let code = "";
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      await t.insert(devices).values({ id, businessId: auth.businessId, outletId, name, createdBy: auth.userId });
      code = await issueCode(t, id, auth.businessId);
      await writeAudit(t, auth, { entityType: "device", entityId: id, action: "create", summary: `${name} @ ${outlet.name}`, changes: { outletId } });
    });
    const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
    return c.json({ device: present(row!, outlet.name), activationCode: display(code), expiresInSeconds: CODE_TTL_MS / 1000 }, 201);
  });

  // Kode baru: untuk perangkat yang belum aktif, atau memasangkan ulang (token lama langsung tidak berlaku).
  app.post("/:id/code", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const [row] = await db.select().from(devices).where(and(eq(devices.id, id), eq(devices.businessId, auth.businessId))).limit(1);
    if (!row || row.revokedAt) throw new AppError("not_found");
    let code = "";
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      code = await issueCode(t, id, auth.businessId);
      await writeAudit(t, auth, { entityType: "device", entityId: id, action: "update", summary: row.name, changes: { repaired: true } });
    });
    return c.json({ activationCode: display(code), expiresInSeconds: CODE_TTL_MS / 1000 });
  });

  app.delete("/:id", validate("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const db = c.get("db");
    const [row] = await db.select().from(devices).where(and(eq(devices.id, id), eq(devices.businessId, auth.businessId))).limit(1);
    if (!row || row.revokedAt) throw new AppError("not_found");
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      await t
        .update(devices)
        .set({ revokedAt: new Date(), tokenHash: null, activationCodeHash: null, activationExpiresAt: null })
        .where(and(eq(devices.id, id), eq(devices.businessId, auth.businessId)));
      await writeAudit(t, auth, { entityType: "device", entityId: id, action: "delete", summary: row.name, changes: { revoked: true } });
    });
    return c.body(null, 204);
  });

  return app;
};

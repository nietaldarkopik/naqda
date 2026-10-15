import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
});
afterAll(async () => {
  await fx.handle.close();
});

const auditOf = async (id: string) => (await call(fx.app, "GET", `/audit?entityType=user&pageSize=50`, { token: A })).json.items.filter((r: any) => r.entityId === id);

describe("jejak audit karyawan", () => {
  it("buat, ubah peran, dan hapus tercatat; kata sandi tidak pernah dicatat", async () => {
    const created = await call(fx.app, "POST", "/employees", {
      token: A,
      body: { name: "Budi", email: `budi${fx.a.emailSuffix}`, roleId: fx.a.roleIds.cashier, outletIds: [fx.a.outletIds[0]], password: "RahasiaBaru123!" },
    });
    expect(created.status).toBe(201);
    const id = created.json.id as string;

    const upd = await call(fx.app, "PATCH", `/employees/${id}`, { token: A, body: { roleId: fx.a.roleIds.investor, password: "LainLagi456!" } });
    expect(upd.status).toBe(200);
    expect((await call(fx.app, "DELETE", `/employees/${id}`, { token: A })).status).toBe(204);

    const rows = await auditOf(id);
    expect(rows.map((r: any) => r.action).sort()).toEqual(["create", "delete", "update"]);
    const update = rows.find((r: any) => r.action === "update");
    expect(update.changes.before.roleId).toBe(fx.a.roleIds.cashier);
    expect(update.changes.after.roleId).toBe(fx.a.roleIds.investor);
    expect(update.changes.passwordChanged).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/RahasiaBaru123|LainLagi456|passwordHash|\$2[aby]\$/);
  });
});

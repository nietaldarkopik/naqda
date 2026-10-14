import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, login, PASSWORD, setupFixture, type Fixture } from "./helpers";

/**
 * Regresi: `z.partial()` tetap menerapkan nilai bawaan, sehingga PATCH {name} pernah mengembalikan
 * status, daftar outlet, mode pajak, modifier, dst. ke bawaan. Setiap entitas dibuat dengan nilai
 * NON-bawaan, diubah satu bidang saja, lalu semua bidang lain harus sama persis.
 */

let fx: Fixture;
let A: string;

beforeAll(async () => {
  fx = await setupFixture();
});
afterAll(async () => {
  await fx.handle.close();
});
beforeEach(async () => {
  fx.limiter.reset();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
});

/** Mengambil objek, mengubah satu bidang lewat PATCH, dan mengembalikan perbedaan sisanya. */
const patchOnly = async (path: string, id: string, change: Record<string, unknown>) => {
  const before = (await call(fx.app, "GET", `${path}/${id}`, { token: A })).json;
  const res = await call(fx.app, "PATCH", `${path}/${id}`, { token: A, body: change });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  const after = (await call(fx.app, "GET", `${path}/${id}`, { token: A })).json;
  const changedKeys = Object.keys(change);
  const strip = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !changedKeys.includes(k) && k !== "updatedAt"));
  return { before, after, untouchedBefore: strip(before), untouchedAfter: strip(after) };
};

const subsetOutlet = () => [fx.a.outletIds[0]!];

describe("PATCH satu bidang tidak menyentuh bidang lain", () => {
  it("outlet: mode pajak, status, zona waktu", async () => {
    const o = await call(fx.app, "POST", "/outlets", {
      token: A,
      body: { name: "Patch Outlet", pricesIncludeTax: true, status: "inactive", timezone: "Asia/Makassar", assignCatalog: false },
    });
    const r = await patchOnly("/outlets", o.json.id, { phone: "08123" });
    expect(r.untouchedAfter).toEqual(r.untouchedBefore);
    expect(r.after.pricesIncludeTax).toBe(true);
    expect(r.after.status).toBe("inactive");
    expect(r.after.phone).toBe("08123");
  });

  it("karyawan: status nonaktif, bahasa, dan penugasan outlet tetap", async () => {
    const e = await call(fx.app, "POST", "/employees", {
      token: A,
      body: { name: "Patch Karyawan", email: `patch-${fx.a.emailSuffix}`, roleId: fx.a.roleIds.headBarKitchen, outletIds: subsetOutlet(), locale: "ar", status: "inactive", password: PASSWORD },
    });
    expect(e.status).toBe(201);
    const r = await patchOnly("/employees", e.json.id, { name: "Nama Baru" });
    expect(r.untouchedAfter).toEqual(r.untouchedBefore);
    expect(r.after.status).toBe("inactive");
    expect(r.after.outletIds).toEqual(subsetOutlet());
    expect(r.after.locale).toBe("ar");
  });

  it("tipe penjualan: status dan gratuity", async () => {
    const g = await call(fx.app, "POST", "/gratuities", { token: A, body: { name: "G Patch", rateBp: 500 } });
    const s = await call(fx.app, "POST", "/sales-types", { token: A, body: { name: "ST Patch", status: "inactive", gratuityIds: [g.json.id] } });
    const r = await patchOnly("/sales-types", s.json.id, { name: "ST Patch 2" });
    expect(r.untouchedAfter).toEqual(r.untouchedBefore);
    expect(r.after.gratuityIds).toEqual([g.json.id]);
    expect(r.after.status).toBe("inactive");
  });

  it("pajak dan gratuity: tarif dan outlet terbatas", async () => {
    for (const [path, name] of [["/taxes", "Pajak Patch"], ["/gratuities", "Gratuity Patch"]] as const) {
      const t = await call(fx.app, "POST", path, { token: A, body: { name, rateBp: 1100, outletIds: subsetOutlet() } });
      const r = await patchOnly(path, t.json.id, { name: `${name} 2` });
      expect(r.untouchedAfter, path).toEqual(r.untouchedBefore);
      expect(r.after.outletIds, path).toEqual(subsetOutlet());
      expect(r.after.rateBp, path).toBe(1100);
    }
  });

  it("diskon: jenis, nilai, bisa-diubah-kasir, status, outlet", async () => {
    const d = await call(fx.app, "POST", "/discounts", {
      token: A,
      body: { name: "Diskon Patch", kind: "amount", value: 7500, customizable: true, status: "inactive", outletIds: subsetOutlet() },
    });
    const r = await patchOnly("/discounts", d.json.id, { name: "Diskon Patch 2" });
    expect(r.untouchedAfter).toEqual(r.untouchedBefore);
    expect(r.after).toMatchObject({ kind: "amount", value: 7500, customizable: true, status: "inactive", outletIds: subsetOutlet() });
  });

  it("item: lacak stok, status, modifier, outlet, dan harga per tipe penjualan", async () => {
    const mod = await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "Mod Patch", options: [{ name: "x", price: 0 }] } });
    const item = await call(fx.app, "POST", "/items", {
      token: A,
      body: {
        name: "Item Patch", trackStock: true, status: "inactive", modifierSetIds: [mod.json.id], outletIds: subsetOutlet(),
        variants: [{ name: "R", basePrice: 10000, cost: 4000, sku: "PS-1", prices: [{ salesTypeId: fx.a.salesTypeIds["Take Away"], price: 12000 }] }],
      },
    });
    expect(item.status).toBe(201);
    const r = await patchOnly("/items", item.json.id, { description: "Deskripsi baru" });
    expect(r.untouchedAfter).toEqual(r.untouchedBefore);
    expect(r.after).toMatchObject({ trackStock: true, status: "inactive", modifierSetIds: [mod.json.id], outletIds: subsetOutlet() });
    expect(r.after.variants[0]).toMatchObject({ basePrice: 10000, cost: 4000, prices: [{ price: 12000 }] });
  });

  it("modifier: batas pilihan min/maks", async () => {
    const m = await call(fx.app, "POST", "/modifiers", {
      token: A,
      body: { name: "Mod Batas", minSelect: 1, maxSelect: 2, options: [{ name: "a", price: 100 }, { name: "b", price: 200 }] },
    });
    const r = await patchOnly("/modifiers", m.json.id, { name: "Mod Batas 2" });
    expect(r.untouchedAfter).toEqual(r.untouchedBefore);
    expect(r.after).toMatchObject({ minSelect: 1, maxSelect: 2 });
    expect(r.after.options).toHaveLength(2);
  });

  it("bundle: status, harga per tipe penjualan, dan outlet", async () => {
    const item = await call(fx.app, "POST", "/items", { token: A, body: { name: "Item Bundle Patch", variants: [{ name: "R", basePrice: 100, sku: "PS-B" }] } });
    const b = await call(fx.app, "POST", "/bundles", {
      token: A,
      body: {
        name: "Bundle Patch", price: 500, status: "inactive", outletIds: subsetOutlet(),
        items: [{ variantId: item.json.variants[0].id, quantity: 3 }],
        prices: [{ salesTypeId: fx.a.salesTypeIds["Dine In"], price: 600 }],
      },
    });
    const r = await patchOnly("/bundles", b.json.id, { price: 700 });
    expect(r.untouchedAfter).toEqual(r.untouchedBefore);
    expect(r.after).toMatchObject({ status: "inactive", outletIds: subsetOutlet() });
    expect(r.after.items[0].quantity).toBe(3);
    expect(r.after.prices).toHaveLength(1);
  });

  it("promo: kelipatan, status, outlet, tipe penjualan, jadwal", async () => {
    const item = await call(fx.app, "POST", "/items", { token: A, body: { name: "Item Promo Patch", variants: [{ name: "R", basePrice: 100, sku: "PS-P" }] } });
    const p = await call(fx.app, "POST", "/promos", {
      token: A,
      body: {
        name: "Promo Patch", type: "item_discount", requirementScope: "item", requirementItemId: item.json.id, requirementQuantity: 3,
        rewardKind: "percent", rewardValue: 1500, multiple: true, status: "inactive", outletIds: subsetOutlet(),
        salesTypeIds: [fx.a.salesTypeIds["Dine In"]], weekdays: [1, 2], hours: { from: "09:00", to: "12:00" },
      },
    });
    expect(p.status, JSON.stringify(p.json)).toBe(201);
    const r = await patchOnly("/promos", p.json.id, { name: "Promo Patch 2" });
    expect(r.untouchedAfter).toEqual(r.untouchedBefore);
    expect(r.after).toMatchObject({ multiple: true, status: "inactive", requirementQuantity: 3, rewardValue: 1500, weekdays: [1, 2], hours: { from: "09:00", to: "12:00" } });
    expect(r.after.outletIds).toEqual(subsetOutlet());
  });
});

describe("PATCH tetap bisa mengubah bidang ke nilai bawaan secara eksplisit", () => {
  it("mengirim nilai bawaan secara sengaja tetap berlaku", async () => {
    const o = await call(fx.app, "POST", "/outlets", { token: A, body: { name: "Eksplisit", pricesIncludeTax: true, assignCatalog: false } });
    const res = await call(fx.app, "PATCH", `/outlets/${o.json.id}`, { token: A, body: { pricesIncludeTax: false } });
    expect(res.json.pricesIncludeTax).toBe(false);
  });
});

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, businesses } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string; // token admin bisnis A
let B: string; // token admin bisnis B

beforeAll(async () => {
  fx = await setupFixture();
});
afterAll(async () => {
  await fx.handle.close();
});
beforeEach(async () => {
  fx.limiter.reset();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
});

const dine = () => fx.a.salesTypeIds["Dine In"]!;
const take = () => fx.a.salesTypeIds["Take Away"]!;

const mkCategory = async (name: string, token = A) => (await call(fx.app, "POST", "/categories", { token, body: { name } })).json.id as string;

const itemBody = (over: Record<string, unknown> = {}) => ({
  name: "Kopi Susu",
  variants: [{ name: "Reguler", basePrice: 20000, cost: 8000, sku: "KOPI-1", prices: [{ salesTypeId: take(), price: 22000 }] }],
  ...over,
});

const auditFor = async (entityType: string, entityId: string) =>
  fx.handle.db.select().from(auditLogs).where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)));

describe("entitas sederhana (kategori, brand, ...)", () => {
  it("CRUD kategori; nama ganda ditolak; nama bisa dipakai lagi setelah dihapus", async () => {
    const created = await call(fx.app, "POST", "/categories", { token: A, body: { name: "Minuman" } });
    expect(created.status).toBe(201);
    const id = created.json.id as string;

    const dup = await call(fx.app, "POST", "/categories", { token: A, body: { name: "Minuman" } });
    expect(dup.status).toBe(409);
    expect(dup.json.fields.name).toBe("Nama sudah dipakai");

    expect((await call(fx.app, "PATCH", `/categories/${id}`, { token: A, body: { name: "Minuman Dingin" } })).json.name).toBe("Minuman Dingin");
    expect((await call(fx.app, "DELETE", `/categories/${id}`, { token: A })).status).toBe(204);
    expect((await call(fx.app, "GET", `/categories/${id}`, { token: A })).status).toBe(404);
    expect((await call(fx.app, "POST", "/categories", { token: A, body: { name: "Minuman Dingin" } })).status).toBe(201);
  });

  it("nama kosong ditolak dengan galat per kolom", async () => {
    const res = await call(fx.app, "POST", "/brands", { token: A, body: { name: "  " } });
    expect(res.status).toBe(422);
    expect(res.json.fields.name).toBeTruthy();
  });

  it("bisnis B tidak melihat atau mengubah kategori bisnis A", async () => {
    const id = await mkCategory("Rahasia A");
    expect((await call(fx.app, "GET", `/categories/${id}`, { token: B })).status).toBe(404);
    expect((await call(fx.app, "PATCH", `/categories/${id}`, { token: B, body: { name: "Bajak" } })).status).toBe(404);
    expect((await call(fx.app, "DELETE", `/categories/${id}`, { token: B })).status).toBe(404);
    const list = await call(fx.app, "GET", "/categories?pageSize=100", { token: B });
    expect((list.json.items as Array<{ id: string }>).some((c) => c.id === id)).toBe(false);
    // Nama yang sama boleh dipakai bisnis lain.
    expect((await call(fx.app, "POST", "/categories", { token: B, body: { name: "Rahasia A" } })).status).toBe(201);
  });

  it("investor boleh melihat tetapi tidak boleh mengubah katalog", async () => {
    const inv = (await login(fx.app, fx.a.investorEmail)).token!;
    expect((await call(fx.app, "GET", "/categories", { token: inv })).status).toBe(200);
    expect((await call(fx.app, "POST", "/categories", { token: inv, body: { name: "Tidak boleh" } })).status).toBe(403);
    expect((await call(fx.app, "POST", "/items", { token: inv, body: itemBody({ name: "X" }) })).status).toBe(403);
  });

  it("bisnis baru memiliki sales type bawaan Dine In dan Take Away", async () => {
    const res = await call(fx.app, "GET", "/sales-types", { token: A });
    expect((res.json.items as Array<{ name: string }>).map((s) => s.name).sort()).toEqual(["Dine In", "Take Away"]);
  });
});

describe("pajak, gratuity, diskon", () => {
  it("pajak: tarif dibatasi 0-100% dan outlet harus milik bisnis sendiri", async () => {
    expect((await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 10001 } })).status).toBe(422);
    expect((await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: -1 } })).status).toBe(422);
    const foreign = await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, outletIds: [fx.b.outletIds[0]] } });
    expect(foreign.status).toBe(422);
    expect(foreign.json.fields.outletIds).toBeTruthy();

    const ok = await call(fx.app, "POST", "/taxes", { token: A, body: { name: "PPN", rateBp: 1100, allOutlets: true } });
    expect(ok.status).toBe(201);
    expect(ok.json.rateBp).toBe(1100);
    expect([...ok.json.outletIds].sort()).toEqual([...fx.a.outletIds].sort());
  });

  it("gratuity ditautkan ke sales type", async () => {
    const g = await call(fx.app, "POST", "/gratuities", { token: A, body: { name: "Service", rateBp: 500 } });
    expect(g.status).toBe(201);
    const patched = await call(fx.app, "PATCH", `/sales-types/${dine()}`, { token: A, body: { gratuityIds: [g.json.id] } });
    expect(patched.status).toBe(200);
    expect(patched.json.gratuityIds).toEqual([g.json.id]);
    // gratuity bisnis lain tidak boleh ditautkan
    const gb = await call(fx.app, "POST", "/gratuities", { token: B, body: { name: "Service B", rateBp: 500 } });
    expect((await call(fx.app, "PATCH", `/sales-types/${dine()}`, { token: A, body: { gratuityIds: [gb.json.id] } })).status).toBe(422);
  });

  it("diskon persen tidak boleh lebih dari 100%, juga saat mengubah jenis", async () => {
    expect((await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Gila", kind: "percent", value: 10001 } })).status).toBe(422);
    const amount = await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Potong 50rb", kind: "amount", value: 50000 } });
    expect(amount.status).toBe(201);
    // 50000 sebagai nominal valid, tetapi sebagai basis point (500%) tidak.
    const flip = await call(fx.app, "PATCH", `/discounts/${amount.json.id}`, { token: A, body: { kind: "percent" } });
    expect(flip.status).toBe(422);
    expect(flip.json.fields.value).toBeTruthy();
    const ok = await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Karyawan 20%", kind: "percent", value: 2000, customizable: true } });
    expect(ok.status).toBe(201);
    expect(ok.json.customizable).toBe(true);
  });
});

describe("item", () => {
  it("membuat item dengan varian, harga per sales type, modifier, dan outlet bawaan semua outlet", async () => {
    const category = await mkCategory("Kopi");
    const mod = await call(fx.app, "POST", "/modifiers", {
      token: A,
      body: { name: "Topping", minSelect: 0, maxSelect: 2, options: [{ name: "Boba", price: 3000 }, { name: "Jelly", price: 2500 }] },
    });
    expect(mod.status).toBe(201);

    const res = await call(fx.app, "POST", "/items", {
      token: A,
      body: itemBody({ name: "Latte", categoryId: category, modifierSetIds: [mod.json.id], trackStock: true }),
    });
    expect(res.status).toBe(201);
    const item = res.json;
    expect(item.variants).toHaveLength(1);
    expect(item.variants[0].basePrice).toBe(20000);
    expect(item.variants[0].prices).toEqual([{ salesTypeId: take(), price: 22000 }]);
    expect(item.modifierSetIds).toEqual([mod.json.id]);
    expect([...item.outletIds].sort()).toEqual([...fx.a.outletIds].sort());
    expect(item.trackStock).toBe(true);

    const list = await call(fx.app, "GET", "/items?q=Latte", { token: A });
    expect(list.json.total).toBe(1);
    expect(list.json.items[0]).toMatchObject({ name: "Latte", categoryName: "Kopi", variantCount: 1, minPrice: 20000, maxPrice: 20000 });
  });

  it("validasi: harga negatif, nol varian, nama varian ganda, SKU ganda dalam satu item", async () => {
    const neg = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ variants: [{ name: "R", basePrice: -1 }] }) });
    expect(neg.status).toBe(422);
    expect((await call(fx.app, "POST", "/items", { token: A, body: itemBody({ variants: [] }) })).status).toBe(422);
    const sameName = await call(fx.app, "POST", "/items", {
      token: A,
      body: itemBody({ variants: [{ name: "Kecil", basePrice: 1 }, { name: "kecil", basePrice: 2 }] }),
    });
    expect(sameName.status).toBe(422);
    const sameSku = await call(fx.app, "POST", "/items", {
      token: A,
      body: itemBody({ variants: [{ name: "S", basePrice: 1, sku: "Z" }, { name: "M", basePrice: 2, sku: "Z" }] }),
    });
    expect(sameSku.status).toBe(422);
  });

  it("SKU unik per bisnis, tetapi boleh sama antar bisnis dan bisa dipakai lagi setelah item dihapus", async () => {
    const first = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Satu", variants: [{ name: "R", basePrice: 1000, sku: "UNIK-1" }] }) });
    expect(first.status).toBe(201);
    const dup = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Dua", variants: [{ name: "R", basePrice: 1000, sku: "UNIK-1" }] }) });
    expect(dup.status).toBe(422);
    expect(dup.json.fields["variants.0.sku"]).toBe("SKU sudah dipakai produk lain");
    expect((await call(fx.app, "POST", "/items", { token: B, body: { name: "Satu", variants: [{ name: "R", basePrice: 1000, sku: "UNIK-1" }] } })).status).toBe(201);

    await call(fx.app, "DELETE", `/items/${first.json.id}`, { token: A });
    expect((await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Dua", variants: [{ name: "R", basePrice: 1000, sku: "UNIK-1" }] }) })).status).toBe(201);
  });

  it("rujukan ke kategori, sales type, modifier, atau outlet bisnis lain ditolak", async () => {
    const catB = await mkCategory("Milik B", B);
    expect((await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "T1", categoryId: catB }) })).json.fields.categoryId).toBeTruthy();

    const foreignSales = await call(fx.app, "POST", "/items", {
      token: A,
      body: itemBody({ name: "T2", variants: [{ name: "R", basePrice: 1, prices: [{ salesTypeId: fx.b.salesTypeIds["Dine In"], price: 1 }] }] }),
    });
    expect(foreignSales.json.fields["variants.0.prices"]).toBeTruthy();

    const modB = await call(fx.app, "POST", "/modifiers", { token: B, body: { name: "M B", options: [{ name: "x", price: 0 }] } });
    expect((await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "T3", modifierSetIds: [modB.json.id] }) })).json.fields.modifierSetIds).toBeTruthy();
    expect((await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "T4", outletIds: [fx.b.outletIds[0]] }) })).json.fields.outletIds).toBeTruthy();
  });

  it("memperbarui: ubah, tambah, dan hapus varian; harga tercatat di audit", async () => {
    const created = await call(fx.app, "POST", "/items", {
      token: A,
      body: itemBody({ name: "Teh", variants: [{ name: "Kecil", basePrice: 8000, sku: "TEH-S" }, { name: "Besar", basePrice: 12000, sku: "TEH-L" }] }),
    });
    const id = created.json.id as string;
    const [small, large] = created.json.variants as Array<{ id: string }>;

    const upd = await call(fx.app, "PATCH", `/items/${id}`, {
      token: A,
      body: {
        variants: [
          { id: small!.id, name: "Kecil", basePrice: 9000, sku: "TEH-S", prices: [{ salesTypeId: dine(), price: 9500 }] },
          { name: "Jumbo", basePrice: 15000, sku: "TEH-XL" },
        ],
      },
    });
    expect(upd.status).toBe(200);
    const names = (upd.json.variants as Array<{ name: string; basePrice: number }>).map((v) => `${v.name}:${v.basePrice}`);
    expect(names).toEqual(["Kecil:9000", "Jumbo:15000"]);
    expect(upd.json.variants.find((v: { id: string }) => v.id === large!.id)).toBeUndefined();

    // SKU varian yang dihapus bisa dipakai item lain.
    expect((await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Teh Lain", variants: [{ name: "R", basePrice: 1, sku: "TEH-L" }] }) })).status).toBe(201);

    const logs = await auditFor("item", id);
    expect(logs.map((l) => l.action).sort()).toEqual(["create", "update"]);
    const update = logs.find((l) => l.action === "update")!;
    expect((update.changes as { priceChanged: boolean }).priceChanged).toBe(true);
    expect(update.userId).not.toBeNull();
  });

  it("perubahan non-harga tidak ditandai priceChanged", async () => {
    const created = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Roti", variants: [{ name: "R", basePrice: 5000, sku: "ROTI-1" }] }) });
    const id = created.json.id as string;
    await call(fx.app, "PATCH", `/items/${id}`, { token: A, body: { description: "Hangat" } });
    const update = (await auditFor("item", id)).find((l) => l.action === "update")!;
    expect((update.changes as { priceChanged: boolean }).priceChanged).toBe(false);
  });

  it("tidak bisa mengubah varian milik item lain", async () => {
    const one = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Item 1", variants: [{ name: "R", basePrice: 1, sku: "I1" }] }) });
    const two = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Item 2", variants: [{ name: "R", basePrice: 2, sku: "I2" }] }) });
    const stolen = one.json.variants[0].id as string;
    const res = await call(fx.app, "PATCH", `/items/${two.json.id}`, { token: A, body: { variants: [{ id: stolen, name: "R", basePrice: 999 }] } });
    expect(res.status).toBe(422);
    expect(res.json.fields["variants.0.id"]).toBeTruthy();
    expect((await call(fx.app, "GET", `/items/${one.json.id}`, { token: A })).json.variants[0].basePrice).toBe(1);
  });

  it("mengatur outlet: hanya outlet terpilih; filter daftar per outlet", async () => {
    const [o1, o2] = fx.a.outletIds as [string, string];
    const res = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Hanya O1", variants: [{ name: "R", basePrice: 1, sku: "O1" }], outletIds: [o1] }) });
    expect(res.json.outletIds).toEqual([o1]);
    const inO1 = await call(fx.app, "GET", `/items?outletId=${o1}&q=Hanya`, { token: A });
    const inO2 = await call(fx.app, "GET", `/items?outletId=${o2}&q=Hanya`, { token: A });
    expect(inO1.json.total).toBe(1);
    expect(inO2.json.total).toBe(0);
  });

  it("bisnis B tidak bisa melihat, mengubah, atau menghapus item bisnis A", async () => {
    const res = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Milik A", variants: [{ name: "R", basePrice: 7, sku: "MA-1" }] }) });
    const id = res.json.id as string;
    expect((await call(fx.app, "GET", `/items/${id}`, { token: B })).status).toBe(404);
    expect((await call(fx.app, "PATCH", `/items/${id}`, { token: B, body: { name: "Bajak" } })).status).toBe(404);
    expect((await call(fx.app, "DELETE", `/items/${id}`, { token: B })).status).toBe(404);
    const listB = await call(fx.app, "GET", "/items?pageSize=100", { token: B });
    expect((listB.json.items as Array<{ id: string }>).some((i) => i.id === id)).toBe(false);
    expect((await call(fx.app, "GET", `/items/${id}`, { token: A })).json.name).toBe("Milik A");
  });
});

describe("modifier", () => {
  it("validasi rentang pilihan dan nama opsi ganda", async () => {
    const opts = [{ name: "A", price: 0 }, { name: "B", price: 0 }];
    expect((await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "M1", minSelect: 3, options: opts } })).status).toBe(422);
    expect((await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "M2", minSelect: 2, maxSelect: 1, options: opts } })).status).toBe(422);
    expect((await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "M3", options: [{ name: "A", price: 0 }, { name: "a", price: 0 }] } })).status).toBe(422);
  });

  it("mengubah opsi dan menghapus set melepasnya dari item", async () => {
    const mod = await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "Gula", options: [{ name: "Normal", price: 0 }, { name: "Less", price: 0 }] } });
    const item = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Es Teh", variants: [{ name: "R", basePrice: 5000, sku: "ET-1" }], modifierSetIds: [mod.json.id] }) });
    expect(item.json.modifierSetIds).toEqual([mod.json.id]);

    const [normal] = mod.json.options as Array<{ id: string }>;
    const upd = await call(fx.app, "PATCH", `/modifiers/${mod.json.id}`, {
      token: A,
      body: { options: [{ id: normal!.id, name: "Normal", price: 500 }, { name: "Extra", price: 1000 }] },
    });
    expect(upd.json.options.map((o: { name: string; price: number }) => `${o.name}:${o.price}`)).toEqual(["Normal:500", "Extra:1000"]);
    expect(upd.json.itemCount).toBe(1);

    expect((await call(fx.app, "DELETE", `/modifiers/${mod.json.id}`, { token: A })).status).toBe(204);
    expect((await call(fx.app, "GET", `/items/${item.json.id}`, { token: A })).json.modifierSetIds).toEqual([]);
  });
});

describe("bundle", () => {
  it("membuat bundle dari varian, menolak varian bisnis lain, dan mencatat perubahan harga", async () => {
    const a = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Burger", variants: [{ name: "R", basePrice: 30000, sku: "BG-1" }] }) });
    const b = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Fries", variants: [{ name: "R", basePrice: 15000, sku: "FR-1" }] }) });
    const va = a.json.variants[0].id as string;
    const vb = b.json.variants[0].id as string;

    const res = await call(fx.app, "POST", "/bundles", {
      token: A,
      body: { name: "Paket Hemat", price: 40000, items: [{ variantId: va, quantity: 1 }, { variantId: vb, quantity: 2 }], prices: [{ salesTypeId: take(), price: 42000 }] },
    });
    expect(res.status).toBe(201);
    expect(res.json.items.map((i: { itemName: string; quantity: number }) => `${i.itemName}x${i.quantity}`).sort()).toEqual(["Burgerx1", "Friesx2"]);
    expect([...res.json.outletIds].sort()).toEqual([...fx.a.outletIds].sort());

    const foreign = await call(fx.app, "POST", "/bundles", { token: B, body: { name: "Curang", price: 1, items: [{ variantId: va, quantity: 1 }] } });
    expect(foreign.status).toBe(422);

    const upd = await call(fx.app, "PATCH", `/bundles/${res.json.id}`, { token: A, body: { price: 38000 } });
    expect(upd.json.price).toBe(38000);
    const log = (await auditFor("bundle", res.json.id)).find((l) => l.action === "update")!;
    expect((log.changes as { priceChanged: boolean }).priceChanged).toBe(true);
  });
});

describe("promo", () => {
  it("aturan: persen 1-100%, beli-gratis butuh item hadiah, periode harus berurutan", async () => {
    const item = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Promo Item", variants: [{ name: "R", basePrice: 10000, sku: "PR-1" }] }) });
    const base = { requirementScope: "item", requirementItemId: item.json.id, requirementQuantity: 2 };

    expect((await call(fx.app, "POST", "/promos", { token: A, body: { ...base, name: "P0", type: "item_discount", rewardKind: "percent", rewardValue: 0 } })).status).toBe(422);
    expect((await call(fx.app, "POST", "/promos", { token: A, body: { ...base, name: "P1", type: "item_discount", rewardKind: "percent", rewardValue: 10001 } })).status).toBe(422);
    expect((await call(fx.app, "POST", "/promos", { token: A, body: { ...base, name: "P2", type: "free_item", rewardKind: "free_item" } })).json.fields.rewardItemId).toBeTruthy();
    expect((await call(fx.app, "POST", "/promos", { token: A, body: { ...base, name: "P3", type: "item_discount", rewardKind: "percent", rewardValue: 1000, startsAt: "2026-05-02T00:00:00Z", endsAt: "2026-05-01T00:00:00Z" } })).status).toBe(422);
    expect((await call(fx.app, "POST", "/promos", { token: A, body: { name: "P4", type: "item_discount", requirementScope: "category", rewardKind: "percent", rewardValue: 1000 } })).json.fields.requirementCategoryId).toBeTruthy();

    const ok = await call(fx.app, "POST", "/promos", {
      token: A,
      body: { ...base, name: "Diskon 10%", type: "item_discount", rewardKind: "percent", rewardValue: 1000, hours: { from: "10:00", to: "14:00" }, weekdays: [1, 2, 3], salesTypeIds: [dine()] },
    });
    expect(ok.status).toBe(201);
    expect(ok.json.hours).toEqual({ from: "10:00", to: "14:00" });
    expect(ok.json.weekdays).toEqual([1, 2, 3]);
    expect(ok.json.salesTypeIds).toEqual([dine()]);
    expect([...ok.json.outletIds].sort()).toEqual([...fx.a.outletIds].sort());
  });

  it("beli X gratis Y dan penolakan item bisnis lain", async () => {
    const buy = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Beli", variants: [{ name: "R", basePrice: 10000, sku: "BY-1" }] }) });
    const free = await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Gratis", variants: [{ name: "R", basePrice: 5000, sku: "FY-1" }] }) });
    const body = { name: "Beli 2 Gratis 1", type: "free_item", requirementScope: "item", requirementItemId: buy.json.id, requirementQuantity: 2, rewardKind: "free_item", rewardItemId: free.json.id, rewardQuantity: 1, multiple: true };
    const res = await call(fx.app, "POST", "/promos", { token: A, body });
    expect(res.status).toBe(201);
    expect(res.json.multiple).toBe(true);
    expect((await call(fx.app, "POST", "/promos", { token: B, body: { ...body, name: "Curang" } })).status).toBe(422);
    expect((await call(fx.app, "GET", `/promos/${res.json.id}`, { token: B })).status).toBe(404);
  });
});

describe("impor dan ekspor CSV", () => {
  const dineName = "Dine In";

  it("ekspor memuat header, kolom harga per sales type, BOM, dan baris per varian", async () => {
    await call(fx.app, "POST", "/items", { token: A, body: itemBody({ name: "Ekspor Uji", variants: [{ name: "S", basePrice: 1000, sku: "EX-S", prices: [{ salesTypeId: dine(), price: 1100 }] }, { name: "L", basePrice: 2000, sku: "EX-L" }] }) });
    const res = await fx.app.request("/api/v1/items/export", { headers: { authorization: `Bearer ${A}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 agar Excel membaca huruf dengan benar
    const lines = (await res.text()).split("\r\n"); // text() membuang BOM
    expect(lines[0]).toBe(`name,category,brand,variant,sku,barcode,price,cost,status,description,modifiers,track_stock,price:${dineName},price:Take Away`);
    expect(lines.filter((l) => l.startsWith("Ekspor Uji"))).toHaveLength(2);
    expect(lines.find((l) => l.includes("EX-S"))).toContain(",1100,");
  });

  it("dry-run tidak menyimpan apa pun", async () => {
    const csv = "name,category,variant,sku,price\nDry Item,Dry Cat,Reguler,DRY-1,5000";
    const res = await call(fx.app, "POST", "/items/import", { token: A, body: { csv, dryRun: true } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ dryRun: true, applied: false, created: 1, categoriesCreated: 1, errors: [] });
    expect((await call(fx.app, "GET", "/items?q=Dry%20Item", { token: A })).json.total).toBe(0);
    const cats = await call(fx.app, "GET", "/categories?q=Dry%20Cat", { token: A });
    expect(cats.json.total).toBe(0);
  });

  it("impor membuat item, kategori, varian ganda, dan harga per sales type; mencatat audit", async () => {
    const csv = [
      `name;category;brand;variant;sku;price;cost;status;description;price:${dineName}`,
      "Nasi Goreng;Makanan;Dapur Naqdi;Biasa;NG-1;25000;10000;active;Pedas;27000",
      "Nasi Goreng;Makanan;Dapur Naqdi;Spesial;NG-2;32000;14000;active;Pedas;",
      "Es Jeruk;Minuman;;;EJ-1;8000;;;;",
    ].join("\n");
    const res = await call(fx.app, "POST", "/items/import", { token: A, body: { csv } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ applied: true, created: 2, updated: 0, categoriesCreated: 2, brandsCreated: 1, errors: [] });

    const list = await call(fx.app, "GET", "/items?q=Nasi%20Goreng", { token: A });
    const item = (await call(fx.app, "GET", `/items/${list.json.items[0].id}`, { token: A })).json;
    expect(item.variants.map((v: { name: string; basePrice: number }) => `${v.name}:${v.basePrice}`)).toEqual(["Biasa:25000", "Spesial:32000"]);
    expect(item.variants[0].prices).toEqual([{ salesTypeId: dine(), price: 27000 }]);
    expect(item.description).toBe("Pedas");

    const log = await fx.handle.db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "item"), eq(auditLogs.entityId, item.id)));
    expect(log.map((l) => l.action)).toContain("import");
  });

  it("mengimpor ulang memperbarui item yang ada tanpa menggandakannya", async () => {
    await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price\nKentang,Reguler,KT-1,10000" } });
    const again = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price\nKentang,Reguler,KT-1,12000" } });
    expect(again.json).toMatchObject({ created: 0, updated: 1, errors: [] });
    const list = await call(fx.app, "GET", "/items?q=Kentang", { token: A });
    expect(list.json.total).toBe(1);
    expect(list.json.items[0].minPrice).toBe(12000);
  });

  it("satu baris bermasalah membatalkan seluruh impor", async () => {
    const csv = ["name,variant,sku,price", "Valid 1,R,V-1,1000", ",R,V-2,1000", "Valid 3,R,V-3,abc", "Valid 4,R,V-1,5"].join("\n");
    const res = await call(fx.app, "POST", "/items/import", { token: A, body: { csv } });
    expect(res.status).toBe(422);
    expect(res.json.applied).toBe(false);
    expect(res.json.errors.map((e: { line: number; code: string }) => `${e.line}:${e.code}`)).toEqual(["3:name_required", "4:price_invalid", "5:sku_duplicate_in_file"]);
    expect((await call(fx.app, "GET", "/items?q=Valid", { token: A })).json.total).toBe(0);
  });

  it("menolak kolom wajib hilang dan sales type tak dikenal", async () => {
    const noPrice = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant\nX,R" } });
    expect(noPrice.json.errors[0]).toMatchObject({ code: "missing_column", field: "price" });
    const badSales = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,price,price:GoFood\nX,1,2" } });
    expect(badSales.json.errors[0]).toMatchObject({ code: "unknown_sales_type" });
  });

  it("SKU yang dimiliki item lain di bisnis yang sama menggabung ke item itu, bukan membuat duplikat", async () => {
    await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price\nPemilik,R,SKU-OWN,100" } });
    const res = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price\nNama Lain,R,SKU-OWN,200" } });
    expect(res.json).toMatchObject({ created: 0, updated: 1 });
    expect((await call(fx.app, "GET", "/items?q=SKU-OWN", { token: A })).json.total).toBe(1);
  });

  it("impor dilakukan per bisnis: bisnis B tidak ikut berubah", async () => {
    const before = (await call(fx.app, "GET", "/items?pageSize=100", { token: B })).json.total;
    await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price\nHanya A,R,HA-1,100" } });
    expect((await call(fx.app, "GET", "/items?pageSize=100", { token: B })).json.total).toBe(before);
  });

  it("investor tidak boleh mengimpor, tetapi boleh mengekspor", async () => {
    const inv = (await login(fx.app, fx.a.investorEmail)).token!;
    expect((await call(fx.app, "POST", "/items/import", { token: inv, body: { csv: "name,price\nX,1" } })).status).toBe(403);
    const res = await fx.app.request("/api/v1/items/export", { headers: { authorization: `Bearer ${inv}` } });
    expect(res.status).toBe(200);
  });

  it("ekspor lalu impor ulang tanpa perubahan tidak menghasilkan galat (round-trip)", async () => {
    const exported = await (await fx.app.request("/api/v1/items/export", { headers: { authorization: `Bearer ${A}` } })).text();
    const res = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: exported, dryRun: true } });
    expect(res.json.errors).toEqual([]);
    expect(res.json.created).toBe(0);
    expect(res.json.updated).toBeGreaterThan(0);
  });
});

describe("audit", () => {
  it("setiap perubahan katalog menghasilkan jejak milik bisnis yang benar", async () => {
    const id = await mkCategory("Dilacak");
    const logs = await auditFor("category", id);
    expect(logs).toHaveLength(1);
    const [business] = await fx.handle.db.select().from(businesses).where(eq(businesses.id, fx.a.businessId));
    expect(logs[0]!.businessId).toBe(business!.id);
    expect(logs[0]!.action).toBe("create");
  });
});

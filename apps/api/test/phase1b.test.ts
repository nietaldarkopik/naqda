import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;
let INV: string;

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
  INV = (await login(fx.app, fx.a.investorEmail)).token!;
});

const auditFor = async (entityType: string, entityId: string) =>
  fx.handle.db.select().from(auditLogs).where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)));

const mkItem = async (token: string, name: string, sku: string, extra: Record<string, unknown> = {}) =>
  call(fx.app, "POST", "/items", { token, body: { name, variants: [{ name: "R", basePrice: 10000, sku }], ...extra } });

// PNG minimal: tanda tangan 8 byte + isi acak. Jenis dikenali dari byte awal.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

const upload = async (token: string | undefined, bytes: Uint8Array, filename = "foto.png", type = "image/png") => {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(bytes)], filename, { type }));
  const res = await fx.app.request("/api/v1/uploads/image", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: fd });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

describe("harga termasuk pajak per outlet", () => {
  it("bawaan false; bisa diatur saat membuat dan diubah kemudian; tiap outlet berbeda", async () => {
    const plain = await call(fx.app, "POST", "/outlets", { token: A, body: { name: "Toko Eksklusif" } });
    expect(plain.status).toBe(201);
    expect(plain.json.pricesIncludeTax).toBe(false);

    const inclusive = await call(fx.app, "POST", "/outlets", { token: A, body: { name: "Toko Inklusif", pricesIncludeTax: true } });
    expect(inclusive.json.pricesIncludeTax).toBe(true);

    const list = await call(fx.app, "GET", "/outlets?pageSize=100", { token: A });
    const byName = Object.fromEntries((list.json.items as Array<{ name: string; pricesIncludeTax: boolean }>).map((o) => [o.name, o.pricesIncludeTax]));
    expect(byName["Toko Eksklusif"]).toBe(false);
    expect(byName["Toko Inklusif"]).toBe(true);

    const flipped = await call(fx.app, "PATCH", `/outlets/${plain.json.id}`, { token: A, body: { pricesIncludeTax: true } });
    expect(flipped.json.pricesIncludeTax).toBe(true);
    // outlet lain tidak ikut berubah
    expect((await call(fx.app, "GET", `/outlets/${inclusive.json.id}`, { token: A })).json.pricesIncludeTax).toBe(true);
    expect((await call(fx.app, "GET", `/outlets/${fx.a.outletIds[0]}`, { token: A })).json.pricesIncludeTax).toBe(false);
  });

  it("perubahan mode pajak tercatat di audit dan ditandai", async () => {
    const o = await call(fx.app, "POST", "/outlets", { token: A, body: { name: "Audit Pajak" } });
    await call(fx.app, "PATCH", `/outlets/${o.json.id}`, { token: A, body: { pricesIncludeTax: true } });
    await call(fx.app, "PATCH", `/outlets/${o.json.id}`, { token: A, body: { phone: "0811" } });
    const updates = (await auditFor("outlet", o.json.id)).filter((l) => l.action === "update");
    expect(updates).toHaveLength(2);
    const flags = updates.map((u) => (u.changes as { taxModeChanged: boolean }).taxModeChanged).sort();
    expect(flags).toEqual([false, true]);
  });

  it("hanya yang berhak mengubah; bisnis lain tidak bisa", async () => {
    const id = fx.a.outletIds[1]!;
    expect((await call(fx.app, "PATCH", `/outlets/${id}`, { token: INV, body: { pricesIncludeTax: true } })).status).toBe(403);
    expect((await call(fx.app, "PATCH", `/outlets/${id}`, { token: B, body: { pricesIncludeTax: true } })).status).toBe(404);
    expect((await call(fx.app, "GET", `/outlets/${id}`, { token: A })).json.pricesIncludeTax).toBe(false);
  });
});

describe("outlet baru memperoleh katalog", () => {
  it("secara bawaan item, bundle, promo, pajak, gratuity, dan diskon tersedia di outlet baru", async () => {
    const item = await mkItem(A, "Katalog Tersedia", "KT-1");
    const tax = await call(fx.app, "POST", "/taxes", { token: A, body: { name: "Pajak KT", rateBp: 1000, allOutlets: true } });
    const grat = await call(fx.app, "POST", "/gratuities", { token: A, body: { name: "Service KT", rateBp: 500, allOutlets: true } });
    const disc = await call(fx.app, "POST", "/discounts", { token: A, body: { name: "Diskon KT", kind: "percent", value: 1000, allOutlets: true } });
    const bundle = await call(fx.app, "POST", "/bundles", { token: A, body: { name: "Bundle KT", price: 1, items: [{ variantId: item.json.variants[0].id, quantity: 1 }] } });
    const promo = await call(fx.app, "POST", "/promos", {
      token: A,
      body: { name: "Promo KT", type: "item_discount", requirementScope: "item", requirementItemId: item.json.id, rewardKind: "percent", rewardValue: 1000 },
    });

    const o = await call(fx.app, "POST", "/outlets", { token: A, body: { name: "Cabang Katalog" } });
    expect(o.status).toBe(201);
    expect(o.json.assignedCatalog.items).toBeGreaterThanOrEqual(1);

    const get = async (path: string) => (await call(fx.app, "GET", path, { token: A })).json;
    expect((await get(`/items/${item.json.id}`)).outletIds).toContain(o.json.id);
    expect((await get(`/taxes/${tax.json.id}`)).outletIds).toContain(o.json.id);
    expect((await get(`/gratuities/${grat.json.id}`)).outletIds).toContain(o.json.id);
    expect((await get(`/discounts/${disc.json.id}`)).outletIds).toContain(o.json.id);
    expect((await get(`/bundles/${bundle.json.id}`)).outletIds).toContain(o.json.id);
    expect((await get(`/promos/${promo.json.id}`)).outletIds).toContain(o.json.id);
  });

  it("assignCatalog=false membiarkan outlet baru kosong, dan tidak memengaruhi bisnis lain", async () => {
    const item = await mkItem(A, "Tanpa Katalog", "TK-1");
    const o = await call(fx.app, "POST", "/outlets", { token: A, body: { name: "Cabang Kosong", assignCatalog: false } });
    expect(o.json.assignedCatalog).toBeNull();
    expect((await call(fx.app, "GET", `/items/${item.json.id}`, { token: A })).json.outletIds).not.toContain(o.json.id);

    const before = (await call(fx.app, "GET", "/items?pageSize=100", { token: B })).json.total;
    await call(fx.app, "POST", "/outlets", { token: A, body: { name: "Cabang Lain A" } });
    expect((await call(fx.app, "GET", "/items?pageSize=100", { token: B })).json.total).toBe(before);
  });
});

describe("unggah gambar", () => {
  it("menerima PNG, menyajikannya tanpa login dengan header aman, dan dipakai pada item", async () => {
    const up = await upload(A, PNG);
    expect(up.status).toBe(201);
    expect(up.json.url).toMatch(new RegExp(`^/api/v1/files/${fx.a.businessId}/[0-9a-f-]{36}\\.png$`));

    const img = await fx.app.request(up.json.url);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await img.arrayBuffer())]).toEqual([...PNG]);

    const item = await mkItem(A, "Dengan Gambar", "IMG-1", { imageUrl: up.json.url });
    expect(item.status).toBe(201);
    expect((await call(fx.app, "GET", `/items/${item.json.id}`, { token: A })).json.imageUrl).toBe(up.json.url);
  });

  it("jenis ditentukan dari isi berkas, bukan nama atau header klien", async () => {
    const fake = await upload(A, new TextEncoder().encode("<script>alert(1)</script>"), "evil.png", "image/png");
    expect(fake.status).toBe(422);
    expect(fake.json.fields.file).toBe("Hanya gambar PNG, JPEG, atau WebP hasil unggahan yang diterima");
    const svg = await upload(A, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), "x.svg", "image/svg+xml");
    expect(svg.status).toBe(422);
  });

  it("menolak berkas lebih dari 2 MB", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 10);
    big.set(PNG);
    const res = await upload(A, big);
    expect(res.status).toBe(422);
    expect(res.json.fields.file).toBe("Gambar terlalu besar (maksimal 2 MB)");
  });

  it("perlu login dan hak library.manage", async () => {
    expect((await upload(undefined, PNG)).status).toBe(401);
    expect((await upload(INV, PNG)).status).toBe(403);
  });

  it("tidak bisa membaca berkas di luar folder atau yang tidak ada", async () => {
    expect((await fx.app.request(`/api/v1/files/${fx.a.businessId}/..%2F..%2Fpackage.json`)).status).toBe(404);
    expect((await fx.app.request(`/api/v1/files/${fx.a.businessId}/00000000-0000-0000-0000-000000000000.png`)).status).toBe(404);
    expect((await fx.app.request("/api/v1/files/..%2F../x.png")).status).toBe(404);
  });

  it("item hanya boleh memakai gambar bisnisnya sendiri, bukan URL luar atau gambar bisnis lain", async () => {
    const mine = await upload(A, PNG);
    const theirs = await upload(B, PNG);
    expect((await mkItem(A, "Gambar Luar", "IMG-2", { imageUrl: "https://tracker.example.com/pixel.png" })).status).toBe(422);
    expect((await mkItem(A, "Gambar B", "IMG-3", { imageUrl: theirs.json.url })).status).toBe(422);
    const ok = await mkItem(A, "Gambar Sendiri", "IMG-4", { imageUrl: mine.json.url });
    expect(ok.status).toBe(201);
    expect((await call(fx.app, "PATCH", `/items/${ok.json.id}`, { token: A, body: { imageUrl: "javascript:alert(1)" } })).status).toBe(422);
    expect((await call(fx.app, "PATCH", `/items/${ok.json.id}`, { token: A, body: { imageUrl: null } })).json.imageUrl).toBeNull();
  });
});

describe("terjemahan nama", () => {
  it("menyimpan, membaca, memperbarui, dan menghapus terjemahan per bahasa", async () => {
    const item = await mkItem(A, "Kopi Hitam", "TR-1");
    const id = item.json.id as string;

    const put = await call(fx.app, "PUT", `/translations/item/${id}`, {
      token: A,
      body: { translations: { en: { name: "Black Coffee", description: "Strong" }, ar: { name: "قهوة سوداء" } } },
    });
    expect(put.status).toBe(200);
    expect(put.json.translations).toEqual({ en: { name: "Black Coffee", description: "Strong" }, ar: { name: "قهوة سوداء" } });

    await call(fx.app, "PUT", `/translations/item/${id}`, { token: A, body: { translations: { en: { name: "Americano" }, ar: { description: "" } } } });
    const got = await call(fx.app, "GET", `/translations/item/${id}`, { token: A });
    expect(got.json.translations.en.name).toBe("Americano");
    expect(got.json.translations.ar.name).toBe("قهوة سوداء");

    await call(fx.app, "PUT", `/translations/item/${id}`, { token: A, body: { translations: { ar: { name: "" } } } });
    expect((await call(fx.app, "GET", `/translations/item/${id}`, { token: A })).json.translations.ar).toBeUndefined();

    const bulk = await call(fx.app, "GET", "/translations?entityType=item&locale=en", { token: A });
    expect(bulk.json.items.some((r: { entityId: string; value: string }) => r.entityId === id && r.value === "Americano")).toBe(true);
    expect((await auditFor("translation", id)).length).toBeGreaterThanOrEqual(3);
  });

  it("bidang yang tidak diizinkan dan bahasa tak dikenal ditolak", async () => {
    const cat = await call(fx.app, "POST", "/categories", { token: A, body: { name: "Kategori Terjemah" } });
    const badField = await call(fx.app, "PUT", `/translations/category/${cat.json.id}`, { token: A, body: { translations: { en: { description: "x" } } } });
    expect(badField.status).toBe(422);
    expect(badField.json.fields["en.description"]).toBeTruthy();
    expect((await call(fx.app, "PUT", `/translations/category/${cat.json.id}`, { token: A, body: { translations: { fr: { name: "x" } } } })).status).toBe(422);
    expect((await call(fx.app, "PUT", `/translations/gadget/${cat.json.id}`, { token: A, body: { translations: {} } })).status).toBe(422);
  });

  it("tidak bisa menerjemahkan data bisnis lain; investor hanya membaca", async () => {
    const item = await mkItem(A, "Milik A Terjemah", "TR-2");
    const id = item.json.id as string;
    expect((await call(fx.app, "PUT", `/translations/item/${id}`, { token: B, body: { translations: { en: { name: "Hack" } } } })).status).toBe(404);
    expect((await call(fx.app, "GET", `/translations/item/${id}`, { token: B })).status).toBe(404);
    expect((await call(fx.app, "PUT", `/translations/item/${id}`, { token: INV, body: { translations: { en: { name: "Hack" } } } })).status).toBe(403);
    expect((await call(fx.app, "GET", `/translations/item/${id}`, { token: INV })).status).toBe(200);

    const bulkB = await call(fx.app, "GET", "/translations?entityType=item&locale=en", { token: B });
    expect(bulkB.json.items.some((r: { entityId: string }) => r.entityId === id)).toBe(false);
  });
});

describe("penampil audit", () => {
  it("admin melihat jejak dengan nama pengguna dan bisa menyaring; investor ditolak", async () => {
    const cat = await call(fx.app, "POST", "/categories", { token: A, body: { name: "Untuk Audit" } });
    await call(fx.app, "PATCH", `/categories/${cat.json.id}`, { token: A, body: { name: "Untuk Audit 2" } });

    const all = await call(fx.app, "GET", "/audit?entityType=category&pageSize=100", { token: A });
    expect(all.status).toBe(200);
    const mine = (all.json.items as Array<{ entityId: string; action: string; userName: string }>).filter((l) => l.entityId === cat.json.id);
    expect(mine.map((l) => l.action).sort()).toEqual(["create", "update"]);
    expect(mine[0]!.userName).toContain("Admin");

    const onlyCreate = await call(fx.app, "GET", `/audit?entityType=category&action=create&pageSize=100`, { token: A });
    expect((onlyCreate.json.items as Array<{ action: string }>).every((l) => l.action === "create")).toBe(true);

    expect((await call(fx.app, "GET", "/audit", { token: INV })).status).toBe(403);
  });

  it("jejak bisnis lain tidak terlihat", async () => {
    const cat = await call(fx.app, "POST", "/categories", { token: A, body: { name: "Rahasia Audit A" } });
    const b = await call(fx.app, "GET", "/audit?pageSize=100", { token: B });
    expect((b.json.items as Array<{ entityId: string }>).some((l) => l.entityId === cat.json.id)).toBe(false);
  });

  it("urut terbaru lebih dulu dan berhalaman", async () => {
    for (const n of ["Urut 1", "Urut 2", "Urut 3"]) await call(fx.app, "POST", "/brands", { token: A, body: { name: n } });
    const page = await call(fx.app, "GET", "/audit?entityType=brand&pageSize=2", { token: A });
    expect(page.json.items).toHaveLength(2);
    expect(page.json.total).toBeGreaterThanOrEqual(3);
    expect(page.json.items[0].summary).toBe("Urut 3");
  });
});

describe("CSV: modifier dan lacak stok", () => {
  it("ekspor memuat modifier dan track_stock; impor menetapkannya dan menolak modifier tak dikenal", async () => {
    const mod = await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "Topping CSV", options: [{ name: "Boba", price: 3000 }] } });
    expect(mod.status).toBe(201);

    const ok = await call(fx.app, "POST", "/items/import", {
      token: A,
      body: { csv: "name,variant,sku,price,modifiers,track_stock\nCSV Mod,R,CM-1,5000,Topping CSV,yes\n" },
    });
    expect(ok.json).toMatchObject({ applied: true, created: 1, errors: [] });
    const list = await call(fx.app, "GET", "/items?q=CSV%20Mod", { token: A });
    const item = (await call(fx.app, "GET", `/items/${list.json.items[0].id}`, { token: A })).json;
    expect(item.modifierSetIds).toEqual([mod.json.id]);
    expect(item.trackStock).toBe(true);

    const exported = await (await fx.app.request("/api/v1/items/export", { headers: { authorization: `Bearer ${A}` } })).text();
    const row = exported.split("\r\n").find((l) => l.startsWith("CSV Mod"))!;
    expect(row).toContain("Topping CSV");
    expect(row).toContain(",yes,");

    const bad = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price,modifiers\nCSV Bad,R,CM-2,5000,Tidak Ada\n" } });
    expect(bad.status).toBe(422);
    expect(bad.json.errors[0]).toMatchObject({ code: "unknown_modifier", value: "Tidak Ada" });
    const badTrack = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price,track_stock\nCSV Bad2,R,CM-3,5000,mungkin\n" } });
    expect(badTrack.json.errors[0]).toMatchObject({ code: "track_stock_invalid" });
  });

  it("impor tanpa kolom modifier tidak menghapus modifier item yang sudah ada", async () => {
    const mod = await call(fx.app, "POST", "/modifiers", { token: A, body: { name: "Jaga Modifier", options: [{ name: "X", price: 0 }] } });
    const item = await mkItem(A, "Jaga Item", "JM-1", { modifierSetIds: [mod.json.id] });
    await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price\nJaga Item,R,JM-1,12000\n" } });
    const after = (await call(fx.app, "GET", `/items/${item.json.id}`, { token: A })).json;
    expect(after.modifierSetIds).toEqual([mod.json.id]);
    expect(after.variants[0].basePrice).toBe(12000);
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "@naqdi/db";
import { call, login, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
let A: string;
let B: string;

const EAN_A = "4006381333931";
const EAN_B = "8992761111113";

const mk = (token: string, name: string, barcode: string | null | undefined, extra: Record<string, unknown> = {}) =>
  call(fx.app, "POST", "/items", { token, body: { name, variants: [{ name: "R", basePrice: 1000, ...(barcode !== undefined ? { barcode } : {}), ...extra }] } });

beforeAll(async () => {
  fx = await setupFixture();
  fx.limiter.reset();
  A = (await login(fx.app, fx.a.adminEmail)).token!;
  B = (await login(fx.app, fx.b.adminEmail)).token!;
});
afterAll(async () => {
  await fx.handle.close();
});

describe("barcode produk", () => {
  it("menyimpan EAN-13 sah dan kode buatan sendiri; barcode ikut di detail dan daftar", async () => {
    const a = await mk(A, "Roti EAN", EAN_A);
    expect(a.status).toBe(201);
    expect(a.json.variants[0].barcode).toBe(EAN_A);
    const own = await mk(A, "Kue Sendiri", "KUE-001");
    expect(own.status).toBe(201);
    expect(own.json.variants[0].barcode).toBe("KUE-001");
    const none = await mk(A, "Tanpa Kode", undefined);
    expect(none.json.variants[0].barcode).toBeNull();
    const fromList = await call(fx.app, "GET", `/items/${a.json.id}`, { token: A });
    expect(fromList.json.variants[0].barcode).toBe(EAN_A);
  });

  it("menolak EAN-13 dengan digit pemeriksa salah, spasi, dan terlalu panjang", async () => {
    const bad = await mk(A, "Salah Ketik", "4006381333932");
    expect(bad.status).toBe(422);
    expect(bad.json.fields["variants.0.barcode"]).toMatch(/EAN-13/);
    expect((await mk(A, "Spasi", "KODE 1")).status).toBe(422);
    expect((await mk(A, "Panjang", "x".repeat(65))).status).toBe(422);
  });

  it("unik per bisnis (tidak peka huruf besar-kecil); bisnis lain boleh memakai kode yang sama", async () => {
    expect((await mk(A, "Unik 1", "UNIK-1")).status).toBe(201);
    const dup = await mk(A, "Unik 2", "unik-1");
    expect(dup.status).toBe(422);
    expect(dup.json.fields["variants.0.barcode"]).toMatch(/Barcode/i);
    const twice = await call(fx.app, "POST", "/items", { token: A, body: { name: "Dua Varian", variants: [{ name: "S", basePrice: 1, barcode: "SAMA-9" }, { name: "L", basePrice: 2, barcode: "sama-9" }] } });
    expect(twice.status).toBe(422);
    expect((await mk(B, "Punya B", "UNIK-1")).status).toBe(201);
  });

  it("satu barcode per varian; mengubah barcode membebaskan yang lama; varian dihapus melepas barcode-nya", async () => {
    const it1 = await mk(A, "Ubah Kode", "KODE-LAMA");
    const vid = it1.json.variants[0].id as string;
    const upd = await call(fx.app, "PATCH", `/items/${it1.json.id}`, { token: A, body: { variants: [{ id: vid, name: "R", basePrice: 1000, barcode: "KODE-BARU" }] } });
    expect(upd.status).toBe(200);
    expect(upd.json.variants[0].barcode).toBe("KODE-BARU");
    expect((await mk(A, "Pakai Lama", "KODE-LAMA")).status).toBe(201); // sudah bebas
    // hapus item -> barcode bebas
    expect((await call(fx.app, "DELETE", `/items/${it1.json.id}`, { token: A })).status).toBe(204);
    expect((await mk(A, "Pakai Baru", "KODE-BARU")).status).toBe(201);
  });

  it("PATCH aman: variants tanpa barcode membiarkan yang ada; null menghapus", async () => {
    const it1 = await mk(A, "Patch Aman", "PATCH-1");
    const vid = it1.json.variants[0].id as string;
    const keep = await call(fx.app, "PATCH", `/items/${it1.json.id}`, { token: A, body: { variants: [{ id: vid, name: "R", basePrice: 2000 }] } });
    expect(keep.json.variants[0]).toMatchObject({ barcode: "PATCH-1", basePrice: 2000 });
    const clear = await call(fx.app, "PATCH", `/items/${it1.json.id}`, { token: A, body: { variants: [{ id: vid, name: "R", basePrice: 2000, barcode: null }] } });
    expect(clear.json.variants[0].barcode).toBeNull();
    const blank = await call(fx.app, "PATCH", `/items/${it1.json.id}`, { token: A, body: { variants: [{ id: vid, name: "R", basePrice: 2000, barcode: "   " }] } });
    expect(blank.json.variants[0].barcode).toBeNull();
  });

  it("pencarian item menemukan lewat barcode", async () => {
    await mk(A, "Cari Lewat Kode", "CARI-777");
    const res = await call(fx.app, "GET", "/items?q=CARI-777", { token: A });
    expect(res.json.items.map((i: any) => i.name)).toContain("Cari Lewat Kode");
    const variants = await call(fx.app, "GET", "/items/variants?q=CARI-777", { token: A });
    expect(variants.json.items[0]).toMatchObject({ itemName: "Cari Lewat Kode", barcode: "CARI-777" });
  });
});

describe("barcode di CSV", () => {
  it("ekspor memuat kolom barcode; impor mengisi dan memvalidasi barcode", async () => {
    await mk(A, "Csv Ekspor", EAN_B);
    const csv = (await call(fx.app, "GET", "/items/export", { token: A })).json as string;
    const header = String(csv).split(/\r?\n/)[0]!.split(",");
    expect(header.slice(3, 6)).toEqual(["variant", "sku", "barcode"]);
    expect(String(csv)).toContain(EAN_B);

    const ok = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,barcode,price\nCsv Baru,R,CSV-1,CSVKODE-1,5000" } });
    expect(ok.json.applied).toBe(true);
    const bad = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,barcode,price\nCsv Salah,R,4006381333932,5000" } });
    expect(bad.json.errors[0].code).toBe("barcode_invalid");
    const dupFile = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,barcode,price\nA1,R,SAMA-X,1\nA2,R,sama-x,2" } });
    expect(dupFile.json.errors.map((e: any) => e.code)).toContain("barcode_duplicate_in_file");
  });

  it("impor TANPA kolom barcode tidak menghapus barcode yang sudah ada", async () => {
    const it1 = await mk(A, "Csv Aman", "AMAN-123", { sku: "AMAN-SKU" });
    expect(it1.status).toBe(201);
    const res = await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,price\nCsv Aman,R,AMAN-SKU,7777" } });
    expect(res.json.applied).toBe(true);
    const after = await call(fx.app, "GET", `/items/${it1.json.id}`, { token: A });
    expect(after.json.variants[0]).toMatchObject({ barcode: "AMAN-123", basePrice: 7777 });
    // kolom ada tetapi sel kosong: juga dibiarkan
    await call(fx.app, "POST", "/items/import", { token: A, body: { csv: "name,variant,sku,barcode,price\nCsv Aman,R,AMAN-SKU,,8888" } });
    expect((await call(fx.app, "GET", `/items/${it1.json.id}`, { token: A })).json.variants[0]).toMatchObject({ barcode: "AMAN-123", basePrice: 8888 });
  });
});

describe("barcode di katalog kasir", () => {
  it("/pos/catalog membawa barcode tiap varian", async () => {
    const outletId = fx.a.outletIds[0]!;
    const [admin] = await fx.handle.db.select({ id: users.id }).from(users).where(eq(users.email, fx.a.adminEmail));
    expect((await call(fx.app, "POST", `/employees/${admin!.id}/pin`, { token: A, body: { pin: "739206" } })).status).toBeLessThan(300);
    const created = await call(fx.app, "POST", "/devices", { token: A, body: { outletId, name: "Scan-1" } });
    const act = await call(fx.app, "POST", "/pos/devices/activate", { body: { code: created.json.activationCode } });
    const device = act.json.deviceToken as string;
    const session = await call(fx.app, "POST", "/pos/auth/pin", { headers: { "x-device-token": device }, body: { userId: admin!.id, pin: "739206" } });
    const cat = await call(fx.app, "GET", "/pos/catalog", { token: session.json.accessToken, headers: { "x-device-token": device } });
    const roti = cat.json.items.find((i: any) => i.name === "Roti EAN");
    expect(roti.variants[0].barcode).toBe(EAN_A);
  });
});

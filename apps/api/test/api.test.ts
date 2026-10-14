import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, login, PASSWORD, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;

beforeAll(async () => {
  fx = await setupFixture();
});
afterAll(async () => {
  await fx.handle.close();
});
beforeEach(() => fx.limiter.reset());

describe("kesehatan dan format galat", () => {
  it("health memeriksa koneksi database", async () => {
    const res = await call(fx.app, "GET", "/health");
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("ok");
  });

  it("rute terlindungi menolak tanpa token", async () => {
    const res = await call(fx.app, "GET", "/outlets");
    expect(res.status).toBe(401);
    expect(res.json.code).toBe("unauthorized");
  });

  it("pesan galat mengikuti bahasa permintaan", async () => {
    const id = await call(fx.app, "GET", "/outlets", { headers: { "accept-language": "id" } });
    const en = await call(fx.app, "GET", "/outlets", { headers: { "x-locale": "en" } });
    const ar = await call(fx.app, "GET", "/outlets", { headers: { "x-locale": "ar" } });
    expect(id.json.message).toBe("Silakan masuk terlebih dahulu");
    expect(en.json.message).toBe("Please sign in first");
    expect(ar.json.message).toBe("يرجى تسجيل الدخول أولًا");
  });
});

describe("login dan sesi", () => {
  it("berhasil dengan kredensial benar dan mengembalikan profil", async () => {
    const res = await login(fx.app, fx.a.adminEmail);
    expect(res.status).toBe(200);
    expect(res.json.user.role.systemKey).toBe("administrator");
    expect(res.json.user.privileges).toContain("outlets.manage");
    expect(res.json.user.outlets).toHaveLength(2);
    expect(res.json.business.currency).toBe("IDR");
    expect(res.refresh).toBeTruthy();
  });

  it("email tidak peka huruf besar-kecil", async () => {
    const res = await login(fx.app, fx.a.adminEmail.toUpperCase());
    expect(res.status).toBe(200);
  });

  it("menolak kata sandi salah dan email tak dikenal dengan pesan sama", async () => {
    const bad = await login(fx.app, fx.a.adminEmail, "salah-salah");
    const unknown = await login(fx.app, "tidak-ada@uji.test");
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.json.message).toBe(unknown.json.message);
  });

  it("peran khusus aplikasi (kasir) tidak bisa masuk Back Office", async () => {
    const res = await login(fx.app, fx.a.cashierEmail);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("no_backoffice_access");
  });

  it("dibatasi setelah 10 kegagalan beruntun", async () => {
    for (let i = 0; i < 10; i++) await login(fx.app, fx.a.investorEmail, "salah");
    const blocked = await login(fx.app, fx.a.investorEmail, PASSWORD);
    expect(blocked.status).toBe(429);
  });

  it("refresh memutar token dan token lama tidak bisa dipakai lagi", async () => {
    const first = await login(fx.app, fx.a.adminEmail);
    const second = await call(fx.app, "POST", "/auth/refresh", { body: { refreshToken: first.refresh } });
    expect(second.status).toBe(200);
    expect(second.json.refreshToken).not.toBe(first.refresh);

    const reuse = await call(fx.app, "POST", "/auth/refresh", { body: { refreshToken: first.refresh } });
    expect(reuse.status).toBe(401);
    // Pemakaian ulang mencabut seluruh sesi pengguna, termasuk token baru.
    const afterReuse = await call(fx.app, "POST", "/auth/refresh", { body: { refreshToken: second.json.refreshToken } });
    expect(afterReuse.status).toBe(401);
  });

  it("klien web menerima refresh token lewat cookie httpOnly, bukan body", async () => {
    const res = await call(fx.app, "POST", "/auth/login", {
      body: { email: fx.a.adminEmail, password: PASSWORD },
      headers: { "x-client": "web" },
    });
    expect(res.status).toBe(200);
    expect(res.json.refreshToken).toBeUndefined();
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("naqdi_rt=");
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("logout mencabut refresh token", async () => {
    const s = await login(fx.app, fx.a.adminEmail);
    expect((await call(fx.app, "POST", "/auth/logout", { body: { refreshToken: s.refresh } })).status).toBe(204);
    expect((await call(fx.app, "POST", "/auth/refresh", { body: { refreshToken: s.refresh } })).status).toBe(401);
  });

  it("/me mengembalikan pengguna dari token", async () => {
    const s = await login(fx.app, fx.a.adminEmail);
    const me = await call(fx.app, "GET", "/me", { token: s.token });
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe(fx.a.adminEmail);
  });
});

describe("outlet", () => {
  it("CRUD lengkap dan nama unik hanya di antara outlet yang belum dihapus", async () => {
    const { token } = await login(fx.app, fx.a.adminEmail);
    const created = await call(fx.app, "POST", "/outlets", {
      token,
      body: { name: "Cabang Baru", address: "Jl. Mawar 1", phone: "0812", timezone: "Asia/Makassar" },
    });
    expect(created.status).toBe(201);
    expect(created.json.timezone).toBe("Asia/Makassar");
    const id = created.json.id as string;

    const dup = await call(fx.app, "POST", "/outlets", { token, body: { name: "Cabang Baru" } });
    expect(dup.status).toBe(409);
    expect(dup.json.fields.name).toBe("Nama outlet sudah dipakai");

    const patched = await call(fx.app, "PATCH", `/outlets/${id}`, { token, body: { status: "inactive" } });
    expect(patched.status).toBe(200);
    expect(patched.json.status).toBe("inactive");

    expect((await call(fx.app, "DELETE", `/outlets/${id}`, { token })).status).toBe(204);
    expect((await call(fx.app, "GET", `/outlets/${id}`, { token })).status).toBe(404);

    const reuse = await call(fx.app, "POST", "/outlets", { token, body: { name: "Cabang Baru" } });
    expect(reuse.status).toBe(201);
  });

  it("validasi: nama kosong dan zona waktu salah", async () => {
    const { token } = await login(fx.app, fx.a.adminEmail);
    const res = await call(fx.app, "POST", "/outlets", { token, body: { name: "  ", timezone: "Mars/Olympus" } });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("validation");
    expect(res.json.fields.name).toBeTruthy();
    expect(res.json.fields.timezone).toBeTruthy();
  });

  it("pencarian dan paginasi", async () => {
    const { token } = await login(fx.app, fx.a.adminEmail);
    for (const n of ["Kopi 1", "Kopi 2", "Kopi 3"]) await call(fx.app, "POST", "/outlets", { token, body: { name: n } });
    const page = await call(fx.app, "GET", "/outlets?q=Kopi&page=2&pageSize=2", { token });
    expect(page.status).toBe(200);
    expect(page.json.total).toBe(3);
    expect(page.json.items).toHaveLength(1);
    const wildcard = await call(fx.app, "GET", "/outlets?q=%25", { token });
    expect(wildcard.json.total).toBe(0);
  });
});

describe("hak akses (privilege)", () => {
  it("investor boleh melihat tetapi tidak boleh mengubah outlet", async () => {
    const { token } = await login(fx.app, fx.a.investorEmail);
    expect((await call(fx.app, "GET", "/outlets", { token })).status).toBe(200);
    const write = await call(fx.app, "POST", "/outlets", { token, body: { name: "Tidak boleh" } });
    expect(write.status).toBe(403);
    expect(write.json.code).toBe("forbidden");
  });

  it("investor tidak boleh membuka daftar karyawan", async () => {
    const { token } = await login(fx.app, fx.a.investorEmail);
    expect((await call(fx.app, "GET", "/employees", { token })).status).toBe(403);
    expect((await call(fx.app, "GET", "/roles", { token })).status).toBe(403);
  });

  it("manajer regional boleh kelola outlet dan karyawan", async () => {
    const { token } = await login(fx.app, fx.a.managerEmail);
    expect((await call(fx.app, "POST", "/outlets", { token, body: { name: "Dibuat manajer" } })).status).toBe(201);
    expect((await call(fx.app, "GET", "/employees", { token })).status).toBe(200);
  });
});

describe("isolasi antar bisnis", () => {
  it("bisnis B tidak bisa melihat, mengubah, atau menghapus outlet bisnis A", async () => {
    const a = await login(fx.app, fx.a.adminEmail);
    const b = await login(fx.app, fx.b.adminEmail);
    const target = fx.a.outletIds[0]!;

    expect((await call(fx.app, "GET", `/outlets/${target}`, { token: a.token })).status).toBe(200);
    expect((await call(fx.app, "GET", `/outlets/${target}`, { token: b.token })).status).toBe(404);
    expect((await call(fx.app, "PATCH", `/outlets/${target}`, { token: b.token, body: { name: "Dibajak" } })).status).toBe(404);
    expect((await call(fx.app, "DELETE", `/outlets/${target}`, { token: b.token })).status).toBe(404);

    const list = await call(fx.app, "GET", "/outlets?pageSize=100", { token: b.token });
    const ids = (list.json.items as Array<{ id: string }>).map((o) => o.id);
    expect(ids).not.toContain(target);
    expect(ids).toEqual(expect.arrayContaining(fx.b.outletIds));

    // Data A tetap utuh.
    const still = await call(fx.app, "GET", `/outlets/${target}`, { token: a.token });
    expect(still.json.name).not.toBe("Dibajak");
  });

  it("bisnis B tidak bisa melihat atau mengubah karyawan bisnis A", async () => {
    const a = await login(fx.app, fx.a.adminEmail);
    const b = await login(fx.app, fx.b.adminEmail);
    const listA = await call(fx.app, "GET", "/employees?pageSize=100", { token: a.token });
    const victim = (listA.json.items as Array<{ id: string; email: string }>).find((u) => u.email === fx.a.managerEmail)!;

    expect((await call(fx.app, "GET", `/employees/${victim.id}`, { token: b.token })).status).toBe(404);
    expect((await call(fx.app, "PATCH", `/employees/${victim.id}`, { token: b.token, body: { name: "X" } })).status).toBe(404);
    expect((await call(fx.app, "DELETE", `/employees/${victim.id}`, { token: b.token })).status).toBe(404);

    const listB = await call(fx.app, "GET", "/employees?pageSize=100", { token: b.token });
    expect((listB.json.items as Array<{ email: string }>).every((u) => u.email.endsWith(fx.b.emailSuffix))).toBe(true);
  });

  it("tidak bisa menautkan peran atau outlet milik bisnis lain", async () => {
    const b = await login(fx.app, fx.b.adminEmail);
    const withForeignRole = await call(fx.app, "POST", "/employees", {
      token: b.token,
      body: { name: "Penyusup", email: "penyusup@uji.test", roleId: fx.a.roleIds.administrator, password: PASSWORD },
    });
    expect(withForeignRole.status).toBe(422);
    expect(withForeignRole.json.fields.roleId).toBeTruthy();

    const withForeignOutlet = await call(fx.app, "POST", "/employees", {
      token: b.token,
      body: { name: "Penyusup", email: "penyusup@uji.test", roleId: fx.b.roleIds.investor, outletIds: [fx.a.outletIds[0]], password: PASSWORD },
    });
    expect(withForeignOutlet.status).toBe(422);
    expect(withForeignOutlet.json.fields.outletIds).toBeTruthy();
  });

  it("daftar peran hanya berisi peran bisnis sendiri", async () => {
    const b = await login(fx.app, fx.b.adminEmail);
    const res = await call(fx.app, "GET", "/roles", { token: b.token });
    const ids = (res.json.items as Array<{ id: string }>).map((r) => r.id);
    expect(ids.sort()).toEqual(Object.values(fx.b.roleIds).sort());
  });
});

describe("karyawan", () => {
  it("membuat, mengubah, menugaskan outlet, lalu menghapus", async () => {
    const { token } = await login(fx.app, fx.a.adminEmail);
    const created = await call(fx.app, "POST", "/employees", {
      token,
      body: {
        name: "Budi", email: "Budi@Uji.Test", roleId: fx.a.roleIds.headBarKitchen,
        outletIds: [fx.a.outletIds[0]], locale: "ar", password: "kataSandiBaru1",
      },
    });
    expect(created.status).toBe(201);
    expect(created.json.email).toBe("budi@uji.test");
    expect(created.json.locale).toBe("ar");
    expect(created.json.outletIds).toEqual([fx.a.outletIds[0]]);
    expect(JSON.stringify(created.json)).not.toContain("passwordHash");

    const id = created.json.id as string;
    const changed = await call(fx.app, "PATCH", `/employees/${id}`, {
      token, body: { outletIds: fx.a.outletIds, name: "Budi Santoso" },
    });
    expect(changed.json.outletIds.sort()).toEqual([...fx.a.outletIds].sort());
    expect(changed.json.name).toBe("Budi Santoso");

    expect((await login(fx.app, "budi@uji.test", "kataSandiBaru1")).status).toBe(200);

    expect((await call(fx.app, "DELETE", `/employees/${id}`, { token })).status).toBe(204);
    expect((await login(fx.app, "budi@uji.test", "kataSandiBaru1")).status).toBe(401);
  });

  it("email ganda ditolak; peran back office wajib kata sandi; kasir tidak", async () => {
    const { token } = await login(fx.app, fx.a.adminEmail);
    const dup = await call(fx.app, "POST", "/employees", {
      token, body: { name: "Ganda", email: fx.a.investorEmail, roleId: fx.a.roleIds.investor, password: PASSWORD },
    });
    expect(dup.status).toBe(409);
    expect(dup.json.fields.email).toBeTruthy();

    const noPass = await call(fx.app, "POST", "/employees", {
      token, body: { name: "Tanpa Sandi", email: "tanpasandi@uji.test", roleId: fx.a.roleIds.investor },
    });
    expect(noPass.status).toBe(422);
    expect(noPass.json.fields.password).toBeTruthy();

    const cashier = await call(fx.app, "POST", "/employees", {
      token, body: { name: "Kasir Baru", email: "kasirbaru@uji.test", roleId: fx.a.roleIds.cashier },
    });
    expect(cashier.status).toBe(201);
  });

  it("admin tidak bisa menghapus atau menonaktifkan dirinya sendiri", async () => {
    const { token } = await login(fx.app, fx.a.adminEmail);
    const list = await call(fx.app, "GET", "/employees?pageSize=100", { token });
    const me = (list.json.items as Array<{ id: string; email: string }>).find((u) => u.email === fx.a.adminEmail)!;
    expect((await call(fx.app, "DELETE", `/employees/${me.id}`, { token })).status).toBe(409);
    expect((await call(fx.app, "PATCH", `/employees/${me.id}`, { token, body: { status: "inactive" } })).status).toBe(409);
  });

  it("pengguna nonaktif tidak bisa masuk", async () => {
    const { token } = await login(fx.app, fx.a.adminEmail);
    const list = await call(fx.app, "GET", "/employees?pageSize=100", { token });
    const target = (list.json.items as Array<{ id: string; email: string }>).find((u) => u.email === fx.a.investorEmail)!;
    await call(fx.app, "PATCH", `/employees/${target.id}`, { token, body: { status: "inactive" } });
    expect((await login(fx.app, fx.a.investorEmail)).status).toBe(401);
  });
});

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestLogger } from "../src/logging";
import { call, setupFixture, type Fixture } from "./helpers";

let fx: Fixture;
beforeAll(async () => {
  fx = await setupFixture();
});
afterAll(async () => {
  await fx.handle.close();
});

describe("pemantauan", () => {
  it("/health sehat: 200 dengan cek database dan sisa disk", async () => {
    const res = await call(fx.app, "GET", "/health");
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("ok");
    expect(res.json.checks.db).toBe("ok");
    expect(res.json.checks.diskFreePct === null || (res.json.checks.diskFreePct >= 0 && res.json.checks.diskFreePct <= 100)).toBe(true);
  });

  it("setiap jawaban membawa X-Request-Id; id dari klien dipakai bila sah", async () => {
    const auto = await call(fx.app, "GET", "/health");
    expect(auto.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const own = await call(fx.app, "GET", "/health", { headers: { "x-request-id": "abc-12345678" } });
    expect(own.headers.get("x-request-id")).toBe("abc-12345678");
    const evil = await call(fx.app, "GET", "/health", { headers: { "x-request-id": "bad id\twith spaces" } });
    expect(evil.headers.get("x-request-id")).not.toContain(" ");
  });
});

describe("log terstruktur", () => {
  const logged = async (path: string, init: RequestInit = {}) => {
    const lines: string[] = [];
    const app = new Hono();
    app.use("*", requestLogger(true, (l) => lines.push(l)));
    app.get("/ok", (c) => c.json({ ok: true }));
    app.post("/login", (c) => c.json({ error: "x" }, 401));
    app.get("/boom", (c) => c.json({ error: "x" }, 500));
    await app.request(path, init);
    return lines.map((l) => JSON.parse(l));
  };

  it("satu baris JSON per permintaan dengan tingkat sesuai status", async () => {
    const [ok] = await logged("/ok");
    expect(ok).toMatchObject({ level: "info", msg: "request", method: "GET", path: "/ok", status: 200 });
    expect(typeof ok.ms).toBe("number");
    expect((await logged("/login", { method: "POST", body: "{}" }))[0]).toMatchObject({ level: "warn", status: 401 });
    expect((await logged("/boom"))[0]).toMatchObject({ level: "error", status: 500 });
  });

  it("tidak mencatat query string, isi permintaan, atau token", async () => {
    const lines: string[] = [];
    const app = new Hono();
    app.use("*", requestLogger(true, (l) => lines.push(l)));
    app.post("/login", (c) => c.json({}));
    await app.request("/login?token=RAHASIA-QS", { method: "POST", headers: { authorization: "Bearer RAHASIA-TOKEN", "content-type": "application/json" }, body: JSON.stringify({ password: "RAHASIA-BODY" }) });
    const text = lines.join("\n");
    expect(text).not.toMatch(/RAHASIA/);
    expect(JSON.parse(lines[0]!).path).toBe("/login");
  });

  it("dimatikan: tidak ada baris, id permintaan tetap diberikan", async () => {
    const lines: string[] = [];
    const app = new Hono();
    app.use("*", requestLogger(false, (l) => lines.push(l)));
    app.get("/ok", (c) => c.json({}));
    const res = await app.request("/ok");
    expect(lines).toEqual([]);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

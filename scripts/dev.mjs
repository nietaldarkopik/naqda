#!/usr/bin/env node
// npm run dev : menjalankan API (tsx watch) dan web (next dev) sekaligus, dengan keluaran berawalan.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { c, isWin, loadDotenv, root } from "./lib.mjs";

loadDotenv();

const procs = [
  { name: "api", color: c.cyan, cmd: "npx", args: ["tsx", "watch", "apps/api/src/server.ts"], cwd: root },
  { name: "web", color: c.green, cmd: "npx", args: ["next", "dev", "-p", "3000"], cwd: path.join(root, "apps/web") },
];

const children = [];
let stopping = false;

const stopAll = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300);
};

for (const p of procs) {
  const stdio = ["ignore", "pipe", "pipe"];
  const child = isWin
    ? spawn([p.cmd, ...p.args].join(" "), { cwd: p.cwd, shell: true, env: process.env, stdio })
    : spawn(p.cmd, p.args, { cwd: p.cwd, env: process.env, stdio });
  children.push(child);
  const tag = p.color(`[${p.name}]`);
  const pipe = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) out.write(`${tag} ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) {
      console.log(`${tag} berhenti (kode ${code}). Menghentikan yang lain.`);
      stopAll(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
console.log(c.bold("\nNaqdi dev: API http://127.0.0.1:4000  |  Web http://localhost:3000   (Ctrl+C untuk berhenti)\n"));

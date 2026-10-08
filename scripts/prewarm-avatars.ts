/**
 * scripts/prewarm-avatars.ts — creates every scene's talking avatar once and records the ids in
 * data/avatars.json, so each round only attaches (seconds) instead of creating (~40 s).
 *
 * Feature: "Talking avatar" → prebuilt avatars (see lib/avatars.ts, useAvatarSession.ts).
 * The vidu-s2-avatar SDK needs a browser (WebRTC), so this script drives headless Chrome over the
 * DevTools protocol (Node's built-in WebSocket + fetch — no extra dependencies):
 *   1. launches Chrome --headless=new with a fresh --user-data-dir and a unique --remote-debugging-port,
 *   2. opens <url>/dev/prewarm-avatars?ids=…[&mode=attach] on a running dev server (the page is
 *      dev-only; it mints tokens via /api/reactor/token, so the server needs REACTOR_API_KEY),
 *   3. polls `window.__prewarmResult` until `done`, echoing the page's progress logs,
 *   4. create mode: merges the new ids into data/avatars.json (existing entries are skipped unless
 *      --force); attach mode: only prints the measured connect → avatar_ready timings.
 * Chrome is always killed and its profile removed at the end.
 *
 * Usage (dev server running, e.g. `pnpm dev`):
 *   node scripts/prewarm-avatars.ts [ids…] [--force] [--attach] [--url http://localhost:3000]
 * Cost: one short Reactor session per avatar; startCall is never sent, so no conversation is billed.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AVATAR, PATHS } from "../lib/config.ts";
import { log } from "../lib/log.ts";
import type { Scene } from "../lib/scene.ts";

type Entry = { avatarId: string; createdAt: string; portrait: string };
type PageResult = { done: boolean; mode: string; results: Record<string, Entry & { msConnect: number; msReady: number }>; failures: Record<string, string> };
type Options = { ids: string[]; force: boolean; attach: boolean; url: string };

/**
 * Parses argv: positional scene ids, `--force`, `--attach`, `--url <base>`.
 * @param argv process.argv.slice(2)
 * @returns options
 */
function parseArgs(argv: string[]): Options {
  log.info("parseArgs", { argv });
  const opts: Options = { ids: [], force: false, attach: false, url: AVATAR.prewarmDefaultUrl };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") opts.force = true;
    else if (a === "--attach") opts.attach = true;
    else if (a === "--url") opts.url = argv[++i] ?? opts.url;
    else opts.ids.push(a);
  }
  return opts;
}

/** Sleeps. @param ms milliseconds */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads data/avatars.json (empty object when missing).
 * @returns the current entries
 */
async function readAvatars(): Promise<Record<string, Entry>> {
  log.info("readAvatars", { path: PATHS.avatars });
  try {
    return JSON.parse(await readFile(PATHS.avatars, "utf8")) as Record<string, Entry>;
  } catch {
    return {};
  }
}

/**
 * Launches headless Chrome, opens `pageUrl`, and resolves with window.__prewarmResult once done.
 * @param pageUrl full URL of the prewarm page
 * @returns the page's result
 */
async function runInChrome(pageUrl: string): Promise<PageResult> {
  const port = AVATAR.prewarmDebugPortBase + (process.pid % 500);
  const profile = await mkdtemp(path.join(tmpdir(), "hg-prewarm-"));
  log.info("runInChrome", { pageUrl, port, profile });
  const chrome = spawn(process.env.CHROME_PATH || AVATAR.prewarmChromePath, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--autoplay-policy=no-user-gesture-required", "about:blank",
  ], { stdio: "ignore" });
  const kill = () => chrome.kill("SIGKILL");
  process.once("SIGINT", () => { kill(); process.exit(130); });
  try {
    let wsUrl = "";
    for (let i = 0; i < 40 && !wsUrl; i++) {
      await sleep(250);
      const targets = (await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => [])) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
    }
    if (!wsUrl) throw new Error("Chrome DevTools endpoint did not come up");
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let nextId = 0;
    const pending = new Map<number, (v: unknown) => void>();
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data)) as { id?: number; method?: string; params?: { type: string; args: Array<{ value?: unknown; description?: string }> }; result?: unknown };
      if (d.method === "Runtime.consoleAPICalled" && d.params) {
        const txt = d.params.args.map((a) => (typeof a.value === "string" ? a.value : JSON.stringify(a.value ?? a.description))).join(" ");
        if (/prewarm\.(ready|failed)|error/i.test(txt)) console.log(`[page] ${txt.slice(0, 300)}`);
      }
      if (d.id && pending.has(d.id)) { pending.get(d.id)!(d.result); pending.delete(d.id); }
    };
    /** Sends one CDP command. @param method CDP method @param params its params */
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<unknown>((r) => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    await send("Runtime.enable");
    await send("Page.navigate", { url: pageUrl });
    const deadline = Date.now() + AVATAR.prewarmTotalTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(2000);
      const r = (await send("Runtime.evaluate", { expression: "JSON.stringify(window.__prewarmResult ?? null)", returnByValue: true })) as { result?: { value?: string } };
      const value = r?.result?.value;
      const parsed = value ? (JSON.parse(value) as PageResult | null) : null;
      if (parsed?.done) { ws.close(); return parsed; }
    }
    throw new Error("timed out waiting for the prewarm page");
  } finally {
    kill();
    await sleep(500);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Entry point: picks the scenes to prewarm, runs the page, merges and writes data/avatars.json.
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  log.info("main", opts);
  const scenes = JSON.parse(await readFile(PATHS.scenes, "utf8")) as Scene[];
  const existing = await readAvatars();
  const all = opts.ids.length ? opts.ids : scenes.map((s) => s.id);
  const ids = opts.attach ? all.filter((id) => existing[id]) : all.filter((id) => opts.force || !existing[id]);
  if (!ids.length) return console.log(opts.attach ? "No prebuilt avatars to attach." : "All avatars already prebuilt (use --force to recreate).");
  console.log(`${opts.attach ? "Attaching" : "Creating"} ${ids.length} avatar(s) via ${opts.url} …`);
  const url = `${opts.url.replace(/\/$/, "")}/dev/prewarm-avatars?ids=${ids.map(encodeURIComponent).join(",")}${opts.attach ? "&mode=attach" : ""}`;
  const result = await runInChrome(url);
  for (const [id, e] of Object.entries(result.results)) {
    console.log(`  ok   ${id.padEnd(32)} ${e.avatarId}  connect ${(e.msConnect / 1000).toFixed(1)} s, avatar_ready ${(e.msReady / 1000).toFixed(1)} s`);
  }
  for (const [id, msg] of Object.entries(result.failures)) console.log(`  FAIL ${id.padEnd(32)} ${msg}`);
  if (!opts.attach && Object.keys(result.results).length) {
    const merged: Record<string, Entry> = { ...existing };
    for (const [id, e] of Object.entries(result.results)) merged[id] = { avatarId: e.avatarId, createdAt: e.createdAt, portrait: e.portrait };
    const ordered = Object.fromEntries(scenes.map((s) => s.id).filter((id) => merged[id]).map((id) => [id, merged[id]]));
    await writeFile(PATHS.avatars, JSON.stringify(ordered, null, 2) + "\n");
    console.log(`Wrote ${Object.keys(ordered).length} avatar(s) to ${PATHS.avatars}.`);
  }
  if (Object.keys(result.failures).length) process.exitCode = 1;
}

await main();

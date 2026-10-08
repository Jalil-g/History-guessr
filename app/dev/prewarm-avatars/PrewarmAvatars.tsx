"use client";
/**
 * <PrewarmAvatars> — the browser half of the avatar prewarm tool (dev only, see ./page.tsx).
 *
 * Feature: "Talking avatar" → prebuilt avatars. For each requested scene, with at most
 * AVATAR.prewarmConcurrency sessions at once, it:
 *   1. mints an avatar-scoped Reactor JWT via GET /api/reactor/token?model=reactor/vidu-s2-avatar
 *      (fresh per scene, so a long run never exceeds a token's session budget),
 *   2. connects a ViduS2AvatarModel session and waits for status "ready",
 *   3. mode "create": fetches /locals/<id>.png → uploadFile → createAvatar;
 *      mode "attach": attachAvatar with the scene's prebuilt id from data/avatars.json,
 *   4. waits for session_state "avatar_ready" and records avatar_id + timings,
 *   5. disconnects. It never calls startCall, so no conversation is ever billed.
 * Progress is shown in a table; the final result is printed as JSON and exposed as
 * `window.__prewarmResult` = { done, mode, results: { [id]: { avatarId, createdAt, portrait, msConnect,
 * msReady } }, failures: { [id]: message } } for scripts/prewarm-avatars.ts to poll.
 */
import { useEffect, useState } from "react";
import { ViduS2AvatarModel } from "@reactor-models/vidu-s2-avatar";
import { getPrebuiltAvatar } from "@/lib/avatars";
import { AVATAR, MODELS, REACTOR, localPortraitUrl } from "@/lib/config";
import { log, logGenAI } from "@/lib/log";
import { SCENES } from "@/lib/scenes";

type Row = { id: string; status: string; ms?: number };
type Entry = { avatarId: string; createdAt: string; portrait: string; msConnect: number; msReady: number };
export type PrewarmResult = { done: boolean; mode: string; results: Record<string, Entry>; failures: Record<string, string> };

/** Set once the run has started (module scope survives strict mode's effect re-run). */
let started = false;

declare global {
  interface Window {
    __prewarmResult?: PrewarmResult;
  }
}

/**
 * Mints a fresh avatar-scoped Reactor JWT (never logged).
 * @returns the JWT
 */
async function mintToken(): Promise<string> {
  log.info("prewarm.mintToken", { model: MODELS.reactorAvatar });
  const r = await fetch(`/api/reactor/token?model=${encodeURIComponent(MODELS.reactorAvatar)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return ((await r.json()) as { jwt: string }).jwt;
}

/**
 * Creates (or attaches) one scene's avatar in its own session and disconnects.
 * @param id scene id
 * @param mode "create" or "attach"
 * @param onStatus progress callback
 * @returns the entry to record
 */
async function prewarmOne(id: string, mode: "create" | "attach", onStatus: (s: string) => void): Promise<Entry> {
  log.info("prewarm.prewarmOne", { id, mode });
  const t0 = Date.now();
  const model = new ViduS2AvatarModel({ apiUrl: REACTOR.apiUrl });
  const offs: Array<() => void> = [];
  try {
    onStatus("token");
    const jwt = await mintToken();
    onStatus("connecting");
    const ready = new Promise<void>((resolve, reject) => {
      /** statusChanged listener. @param s new status */
      const on = (s: string) => {
        if (s === "ready") resolve();
        else if (s === "disconnected") reject(new Error("disconnected before ready"));
      };
      model.on("statusChanged", on);
      offs.push(() => model.off("statusChanged", on));
    });
    await model.connect(jwt);
    if (model.getStatus() !== "ready") await ready;
    const msConnect = Date.now() - t0;
    let lastStatus = "";
    const avatarReady = new Promise<string>((resolve, reject) => {
      offs.push(model.onSessionState((s) => {
        if (s.avatar_status && s.avatar_status !== lastStatus) {
          lastStatus = s.avatar_status;
          log.info("prewarm.session_state", { id, phase: s.phase, avatar_status: s.avatar_status, avatar_id: s.avatar_id });
        }
        onStatus(`${s.phase}${s.avatar_status ? ` (${s.avatar_status})` : ""}`);
        if (s.phase === "avatar_ready" && s.avatar_id) resolve(s.avatar_id);
      }));
      offs.push(model.onCommandError((e) => reject(new Error(`${e.code}: ${e.reason ?? ""}`))));
      setTimeout(() => reject(new Error("timed out waiting for avatar_ready")), AVATAR.prewarmTimeoutMs);
    });
    const portrait = localPortraitUrl(id);
    if (mode === "attach") {
      const prebuilt = getPrebuiltAvatar(id);
      if (!prebuilt) throw new Error("no prebuilt avatar in data/avatars.json");
      onStatus("attaching");
      const req = { model: MODELS.reactorAvatar, command: "attach_avatar", avatar_id: prebuilt.avatarId };
      const res = await model.attachAvatar({ avatar_id: prebuilt.avatarId });
      logGenAI("reactor.avatar.attachAvatar", req, res ?? { ok: true });
    } else {
      onStatus("uploading");
      const r = await fetch(portrait);
      if (!r.ok) throw new Error(`portrait ${r.status}`);
      const blob = await r.blob();
      const ref = await model.uploadFile(blob, { name: `${id}.png` });
      const name = (SCENES.find((s) => s.id === id)?.local.name ?? id).slice(0, 100);
      const req = { model: MODELS.reactorAvatar, command: "create_avatar", name, image: { url: portrait, bytes: blob.size, type: blob.type } };
      const res = await model.createAvatar({ image: ref, name, image_url: null });
      logGenAI("reactor.avatar.createAvatar", req, res ?? { ok: true });
    }
    const avatarId = await avatarReady;
    const msReady = Date.now() - t0;
    log.info("prewarm.ready", { id, mode, avatarId, msConnect, msReady, msPrepare: msReady - msConnect });
    return { avatarId, createdAt: mode === "attach" ? getPrebuiltAvatar(id)!.createdAt : new Date().toISOString(), portrait, msConnect, msReady };
  } finally {
    offs.forEach((off) => off());
    await model.disconnect().catch((e: unknown) => log.warn("prewarm disconnect failed", e));
  }
}

/**
 * Runs the prewarm for `ids` (or every scene) and shows progress + the final JSON.
 * @param props.ids scene ids, or null for all scenes
 * @param props.mode "create" (new avatars) or "attach" (measure prebuilt attach)
 */
export function PrewarmAvatars({ ids, mode }: { ids: string[] | null; mode: "create" | "attach" }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<PrewarmResult | null>(null);

  useEffect(() => {
    // Strict mode runs effects twice in dev: start the (paid) sessions only once per page load.
    if (started) return;
    started = true;
    const list = ids ?? SCENES.map((s) => s.id);
    log.info("PrewarmAvatars.run", { ids: list, mode, concurrency: AVATAR.prewarmConcurrency });
    const out: PrewarmResult = { done: false, mode, results: {}, failures: {} };
    setRows(list.map((id) => ({ id, status: "queued" })));
    /** Updates one row. @param id scene id @param patch fields to change */
    const update = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const queue = [...list];
    /** One worker: takes scenes off the queue until it is empty. */
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const sceneId = id;
        try {
          const e = await prewarmOne(sceneId, mode, (status) => update(sceneId, { status }));
          out.results[sceneId] = e;
          update(sceneId, { status: `ready ${e.avatarId}`, ms: e.msReady });
        } catch (err) {
          out.failures[sceneId] = err instanceof Error ? err.message : String(err);
          log.warn("prewarm.failed", { id: sceneId, error: out.failures[sceneId] });
          update(sceneId, { status: `FAILED ${out.failures[sceneId]}` });
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(AVATAR.prewarmConcurrency, list.length) }, worker)).then(() => {
      out.done = true;
      window.__prewarmResult = out;
      setResult(out);
    });
  }, [ids, mode]);

  return (
    <main className="min-h-screen bg-neutral-950 p-6 font-mono text-sm text-neutral-100">
      <h1 className="mb-4 text-lg">Prewarm avatars — mode: {mode}</h1>
      <table className="mb-6">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="pr-6">{r.id}</td>
              <td className="pr-6">{r.status}</td>
              <td>{r.ms != null ? `${(r.ms / 1000).toFixed(1)} s` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result && <pre id="prewarm-result" className="whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}

/**
 * Local portrait generator — paints one half-body portrait of each scene's local with the Gemini
 * image model, the source image for the live talking avatar.
 *
 * Where it sits in the architecture:
 *   data/scenes.json  (THE contract, type in lib/scene.ts — `local.name`, `local.persona`, and the
 *        │            optional `local.appearance` / `local.role` / `local.gender`)
 *        │  this script: for every scene, describe the local + append PORTRAIT_STYLE → MODELS.sceneImage
 *        ▼
 *   public/locals/<id>.png  (committed; served at /locals/<id>.png via localPortraitUrl() in lib/config.ts)
 *        ▼
 *   components/avatar/useAvatarSession.ts uploads the PNG to Reactor's vidu-s2-avatar model
 *   (createAvatar) which turns it into a live talking character; the same PNG is shown as a still in
 *   mock mode and as the fallback when the avatar cannot start (Gemini Live voice chat underneath).
 *
 * This is an OFFLINE step: image generation is slow and paid, so it runs once on a developer machine
 * and the results are committed. Nothing here runs at game time.
 *
 * Portrait requirements (vidu-s2-avatar animates one person, full or half body): exactly one person,
 * facing the camera, waist up, period-accurate clothing, soft natural light, plain blurred
 * period-appropriate background, no text — text could leak the answer. The shared PORTRAIT_STYLE in
 * lib/config.ts carries the look; this script only adds who the person is. The description comes from
 * `local.appearance` when the extractor provides it, else it is derived from `local.name` + `persona`.
 *
 * Usage (Node 24 runs .ts directly; the key comes from .env.local and is never logged):
 *   node --env-file=.env.local scripts/generate-portraits.ts                  # all missing portraits
 *   node --env-file=.env.local scripts/generate-portraits.ts giza-pyramids    # only these ids
 *   node --env-file=.env.local scripts/generate-portraits.ts --force          # regenerate everything
 *   node --env-file=.env.local scripts/generate-portraits.ts --scenes /tmp/scenes.json
 *
 * Behaviour: existing PNGs are skipped unless --force; unknown ids are an error; PORTRAITS.concurrency
 * in parallel; 429 / 5xx / empty responses retried PORTRAITS.retries times with exponential backoff;
 * JPEG output is converted to a real PNG with macOS `sips` (raw bytes written with a warning elsewhere);
 * exit code 1 if any portrait failed. Every model call is logged with logGenAI (image bytes stripped).
 */

import { readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GoogleGenAI } from "@google/genai";
import { MODELS, PATHS, PORTRAITS, PORTRAIT_STYLE } from "../lib/config.ts";
import { log, logGenAI } from "../lib/log.ts";
import type { Scene } from "../lib/scene.ts";

/** Parsed command-line options. */
type Options = { force: boolean; ids: string[]; scenesPath: string };

/**
 * Parses argv into options: `--force`, `--scenes <path>`, and positional scene ids.
 * @param argv process.argv.slice(2)
 * @returns the parsed options
 */
function parseArgs(argv: string[]): Options {
  log.info("parseArgs", { argv });
  const opts: Options = { force: false, ids: [], scenesPath: PATHS.scenes };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") opts.force = true;
    else if (a === "--scenes") opts.scenesPath = argv[++i] ?? PATHS.scenes;
    else if (a.startsWith("--scenes=")) opts.scenesPath = a.slice("--scenes=".length);
    else opts.ids.push(a);
  }
  return opts;
}

/**
 * Checks whether a file exists.
 * @param file path to check
 * @returns true if it exists
 */
async function exists(file: string): Promise<boolean> {
  log.info("exists", { file });
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves after `ms` milliseconds.
 * @param ms delay in milliseconds
 */
function sleep(ms: number): Promise<void> {
  log.info("sleep", { ms });
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extracts an HTTP-ish status code from a @google/genai error, if any.
 * @param err thrown error
 * @returns the status code, or undefined
 */
function errorStatus(err: unknown): number | undefined {
  log.info("errorStatus", { message: (err as Error)?.message });
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.code === "number") return e.code;
  const m = /\b(4\d\d|5\d\d)\b/.exec(e?.message ?? "");
  return m ? Number(m[1]) : undefined;
}

/**
 * Builds the portrait prompt: who the local is (appearance, or name + persona as a fallback)
 * followed by the shared PORTRAIT_STYLE. Never adds the place or year.
 * @param scene the scene whose local is painted
 * @returns prompt text for the image model
 */
export function buildPortraitPrompt(scene: Scene): string {
  log.info("buildPortraitPrompt", { id: scene.id, hasAppearance: !!scene.local.appearance });
  const { name, persona, appearance, role, gender } = scene.local;
  const who = [
    `Portrait of ${name}${role && !name.includes(role) ? `, ${role}` : ""}${gender ? ` (${gender})` : ""}.`,
    appearance
      ? `Appearance and clothing: ${appearance}`
      : `Dress them exactly as this person would really look in their own time and station in life, inferred from this character description (use it only for age, build, clothing, hair and accessories): ${persona}`,
  ].join(" ");
  return `${who} ${PORTRAIT_STYLE}`;
}

/**
 * Calls the Gemini image model once for one local and returns the image bytes.
 * Logs the full request and (stripped) response via logGenAI.
 * @param ai GoogleGenAI client
 * @param scene the scene whose local is painted
 * @returns image bytes and mime type
 */
async function callImageModel(ai: GoogleGenAI, scene: Scene): Promise<{ bytes: Buffer; mimeType: string }> {
  log.info("callImageModel", { id: scene.id, model: MODELS.sceneImage });
  const request = {
    model: MODELS.sceneImage,
    contents: buildPortraitPrompt(scene),
    config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: PORTRAITS.aspectRatio } },
  };
  let response;
  try {
    response = await ai.models.generateContent(request);
  } catch (err) {
    logGenAI("gemini.generateContent.portrait", request, err);
    throw err;
  }
  logGenAI("gemini.generateContent.portrait", request, response);
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img?.inlineData?.data) {
    throw new Error(`no image in response (finishReason=${response.candidates?.[0]?.finishReason ?? "?"})`);
  }
  return { bytes: Buffer.from(img.inlineData.data, "base64"), mimeType: img.inlineData.mimeType ?? "image/png" };
}

/**
 * Writes image bytes to `outFile` as a real PNG, converting with macOS `sips` when needed.
 * @param bytes image bytes from the model
 * @param mimeType their mime type
 * @param outFile destination .png path
 */
async function writePng(bytes: Buffer, mimeType: string, outFile: string): Promise<void> {
  log.info("writePng", { bytes: bytes.length, mimeType, outFile });
  if (mimeType === "image/png") return writeFile(outFile, bytes);
  const ext = mimeType === "image/jpeg" ? "jpg" : (mimeType.split("/")[1] ?? "img");
  const tmp = `${outFile}.tmp.${ext}`;
  await writeFile(tmp, bytes);
  try {
    await promisify(execFile)("sips", ["-s", "format", "png", tmp, "--out", outFile]);
  } catch (err) {
    log.warn("writePng sips conversion failed, writing raw bytes", { mimeType, err });
    await writeFile(outFile, bytes);
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Generates one portrait with retries (429 / 5xx / empty) and writes it to disk.
 * @param ai GoogleGenAI client
 * @param scene the scene whose local is painted
 * @param outFile destination PNG path
 */
async function generateOne(ai: GoogleGenAI, scene: Scene, outFile: string): Promise<void> {
  log.info("generateOne", { id: scene.id, outFile });
  for (let attempt = 0; ; attempt++) {
    try {
      const { bytes, mimeType } = await callImageModel(ai, scene);
      await writePng(bytes, mimeType, outFile);
      log.info("generateOne saved", { id: scene.id, outFile, bytes: bytes.length });
      return;
    } catch (err) {
      const status = errorStatus(err);
      const retryable = status === 429 || (status !== undefined && status >= 500) || /no image in response/.test(String((err as Error)?.message));
      if (!retryable || attempt >= PORTRAITS.retries) throw err;
      const delay = PORTRAITS.backoffMs * 2 ** attempt + Math.floor(Math.random() * 500);
      log.warn("generateOne retry", { id: scene.id, attempt: attempt + 1, status, delay });
      await sleep(delay);
    }
  }
}

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 * @param items work items
 * @param limit max concurrency
 * @param worker async function per item
 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  log.info("runPool", { count: items.length, limit });
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(lanes);
}

/**
 * Entry point: selects scenes, skips existing portraits unless --force, paints the rest, and exits
 * non-zero if any failed.
 */
async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  log.info("main", opts);
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (run with --env-file=.env.local)");
  const ai = new GoogleGenAI({ apiKey });

  const all = JSON.parse(await readFile(opts.scenesPath, "utf8")) as Scene[];
  const unknown = opts.ids.filter((id) => !all.some((s) => s.id === id));
  if (unknown.length) throw new Error(`unknown scene ids: ${unknown.join(", ")}`);
  const selected = opts.ids.length ? all.filter((s) => opts.ids.includes(s.id)) : all;

  await mkdir(PATHS.localPortraitsDir, { recursive: true });
  const todo: Scene[] = [];
  for (const s of selected) {
    const out = path.join(PATHS.localPortraitsDir, `${s.id}.png`);
    if (!opts.force && (await exists(out))) log.info("main skip existing", { id: s.id, out });
    else todo.push(s);
  }

  const failed: string[] = [];
  await runPool(todo, PORTRAITS.concurrency, async (s) => {
    try {
      await generateOne(ai, s, path.join(PATHS.localPortraitsDir, `${s.id}.png`));
    } catch (err) {
      failed.push(s.id);
      log.error("generateOne failed", { id: s.id, err });
    }
  });

  log.info("main done", { generated: todo.length - failed.length, skipped: selected.length - todo.length, failed });
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  log.error("generate-portraits fatal", err);
  process.exitCode = 1;
});

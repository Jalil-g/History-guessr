/**
 * Scene first-frame generator — paints one still image per scene with the Gemini image model.
 *
 * Where it sits in the architecture:
 *   data/scenes.json  (written by scripts/extract-scenes.ts — THE contract, type in lib/scene.ts)
 *        │  this script: for every scene, send `scene.imagePrompt` to MODELS.sceneImage
 *        ▼
 *   public/scenes/<id>.png  (committed; served at /scenes/<id>.png via sceneImageUrl() in lib/config.ts)
 *        ▼
 *   The game uses the PNG as (a) the first frame handed to the Reactor world model, which turns it
 *   into a walkable live world, and (b) the still image shown in mock mode (NEXT_PUBLIC_MOCK_WORLD=1)
 *   and while the Reactor session is connecting.
 *
 * This is an OFFLINE step: image generation is slow and paid, so it runs once on a developer machine
 * and the results are committed. Nothing here runs at game time.
 *
 * Image requirements (enforced by the prompts the extractor writes, verified by eye afterwards):
 * first-person view at eye level, photorealistic, 16:9, and NO visible text, letters, captions or
 * watermarks — text in the frame could leak the answer and confuses the world model. IMAGES.promptSuffix
 * (lib/config.ts) is appended to every prompt to reinforce the no-text rule (shop signs were the
 * most common leak in testing).
 *
 * Usage (Node 24 runs .ts directly; the key comes from .env.local and is never logged):
 *   node --env-file=.env.local scripts/generate-images.ts                 # all missing images
 *   node --env-file=.env.local scripts/generate-images.ts giza-pyramids   # only these ids
 *   node --env-file=.env.local scripts/generate-images.ts --force         # regenerate everything
 *   node --env-file=.env.local scripts/generate-images.ts --scenes /tmp/scenes.json   # other scene file
 *
 * Behaviour:
 *  - existing PNGs are skipped unless `--force` is given (cheap re-runs after partial failures);
 *  - positional args select scene ids (unknown ids are an error);
 *  - IMAGES.concurrency images are generated in parallel;
 *  - 429 / 5xx errors are retried IMAGES.retries times with exponential backoff;
 *  - if MODELS.sceneImage is rejected as an unknown model, MODELS.sceneImageFallback is used for the
 *    rest of the run;
 *  - the Gemini API returns JPEG bytes (it does not support `outputMimeType`), so non-PNG output is
 *    converted to a real PNG with macOS `sips`; on other platforms the raw bytes are written with a
 *    warning (browsers still sniff and render them);
 *  - exit code 1 if any scene failed, so CI / humans notice.
 * Every model call is logged with logGenAI (inline image bytes stripped by lib/log.ts).
 */

import { readFile, writeFile, mkdir, access, rm } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GoogleGenAI } from "@google/genai";
import { MODELS, IMAGES, PATHS } from "../lib/config.ts";
import { log, logGenAI } from "../lib/log.ts";
import type { Scene } from "../lib/scene.ts";

/** Parsed command-line options. */
type Options = { force: boolean; ids: string[]; scenesPath: string };

/** Model id currently in use; switches to the fallback once if the primary is rejected. */
let activeModel: string = MODELS.sceneImage;

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
 * Reads and parses the scenes file.
 * @param scenesPath path to a scenes.json (array of Scene)
 * @returns the scenes
 */
async function loadScenes(scenesPath: string): Promise<Scene[]> {
  log.info("loadScenes", { scenesPath });
  const scenes = JSON.parse(await readFile(scenesPath, "utf8")) as Scene[];
  if (!Array.isArray(scenes)) throw new Error(`${scenesPath} is not an array of scenes`);
  return scenes;
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
 * True if the error means the model id itself is unknown / unsupported (switch to the fallback).
 * @param err thrown error
 */
function isModelNotFound(err: unknown): boolean {
  log.info("isModelNotFound", { message: (err as Error)?.message });
  const status = errorStatus(err);
  const msg = String((err as Error)?.message ?? "").toLowerCase();
  return status === 404 || (status === 400 && msg.includes("model")) || msg.includes("not found for api version");
}

/**
 * Calls the Gemini image model once for one scene and returns the PNG bytes.
 * Logs the full request and (stripped) response via logGenAI.
 * @param ai GoogleGenAI client
 * @param scene the scene whose imagePrompt is painted
 * @returns image bytes and mime type
 */
async function callImageModel(ai: GoogleGenAI, scene: Scene): Promise<{ bytes: Buffer; mimeType: string }> {
  log.info("callImageModel", { id: scene.id, model: activeModel });
  const request = {
    model: activeModel,
    contents: scene.imagePrompt + IMAGES.promptSuffix,
    config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: IMAGES.aspectRatio } },
  };
  let response;
  try {
    response = await ai.models.generateContent(request);
  } catch (err) {
    logGenAI("gemini.generateContent.image", request, err);
    throw err;
  }
  logGenAI("gemini.generateContent.image", request, response);
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img?.inlineData?.data) {
    throw new Error(`no image in response (finishReason=${response.candidates?.[0]?.finishReason ?? "?"})`);
  }
  return { bytes: Buffer.from(img.inlineData.data, "base64"), mimeType: img.inlineData.mimeType ?? "image/png" };
}

/**
 * Writes image bytes to `outFile` as a real PNG, converting with macOS `sips` when the model
 * returned another format. Falls back to writing the raw bytes (with a warning) if sips is missing.
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
 * Generates one scene image with retries (429/5xx) and model fallback, and writes it to disk.
 * @param ai GoogleGenAI client
 * @param scene the scene to paint
 * @param outFile destination PNG path
 */
async function generateOne(ai: GoogleGenAI, scene: Scene, outFile: string): Promise<void> {
  log.info("generateOne", { id: scene.id, outFile });
  for (let attempt = 0; ; attempt++) {
    try {
      const { bytes, mimeType } = await callImageModel(ai, scene);
      await writePng(bytes, mimeType, outFile);
      log.info("generateOne saved", { id: scene.id, outFile, bytes: bytes.length, model: activeModel });
      return;
    } catch (err) {
      if (activeModel !== MODELS.sceneImageFallback && isModelNotFound(err)) {
        log.warn("generateOne model rejected, switching to fallback", { from: activeModel, to: MODELS.sceneImageFallback });
        activeModel = MODELS.sceneImageFallback;
        attempt--;
        continue;
      }
      const status = errorStatus(err);
      const retryable = status === 429 || (status !== undefined && status >= 500) || /no image in response/.test(String((err as Error)?.message));
      if (!retryable || attempt >= IMAGES.retries) throw err;
      const delay = IMAGES.backoffMs * 2 ** attempt + Math.floor(Math.random() * 500);
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
 * Entry point: selects scenes, skips existing images unless --force, generates the rest, and exits
 * non-zero if any failed.
 */
async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  log.info("main", opts);
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (run with --env-file=.env.local)");
  const ai = new GoogleGenAI({ apiKey });

  const all = await loadScenes(opts.scenesPath);
  const unknown = opts.ids.filter((id) => !all.some((s) => s.id === id));
  if (unknown.length) throw new Error(`unknown scene ids: ${unknown.join(", ")}`);
  const selected = opts.ids.length ? all.filter((s) => opts.ids.includes(s.id)) : all;

  await mkdir(PATHS.sceneImagesDir, { recursive: true });
  const todo: Scene[] = [];
  for (const s of selected) {
    const out = path.join(PATHS.sceneImagesDir, `${s.id}.png`);
    if (!opts.force && (await exists(out))) log.info("main skip existing", { id: s.id, out });
    else todo.push(s);
  }

  const failed: string[] = [];
  await runPool(todo, IMAGES.concurrency, async (s) => {
    try {
      await generateOne(ai, s, path.join(PATHS.sceneImagesDir, `${s.id}.png`));
    } catch (err) {
      failed.push(s.id);
      log.error("generateOne failed", { id: s.id, err });
    }
  });

  log.info("main done", { generated: todo.length - failed.length, skipped: selected.length - todo.length, failed, model: activeModel });
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  log.error("generate-images fatal", err);
  process.exitCode = 1;
});

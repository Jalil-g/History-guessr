/**
 * Book-grounded scene extraction — offline pipeline step 1 (book → data/scenes.json).
 *
 * What it does
 * ------------
 * Reads H.G. Wells, *A Short History of the World* (data/short-history-of-the-world.txt, ~190k
 * tokens), sends the WHOLE book to the Gemini text model (MODELS.sceneText, with fallbacks) together
 * with a curated list of famous, instantly-recognisable historical moments, and asks for structured
 * JSON (responseMimeType application/json + responseSchema mirroring the Scene type in lib/scene.ts).
 * The scenes are requested in parallel batches of EXTRACT.batchSize so each structured output stays
 * small and reliable.
 *
 * How it fits the architecture
 * ----------------------------
 *   book.txt ──(this script)──▶ data/scenes.json ──(scripts/generate-images.ts)──▶ public/scenes/<id>.png
 * data/scenes.json is THE CONTRACT between the offline pipeline and the game: the game loop, the
 * Reactor world, the Gemini Live voice chat and the reveal screen all consume it. Everything here is
 * slow/paid, so it runs offline and the output is committed.
 *
 * Historical grounding (the important part)
 * -----------------------------------------
 *  - Every scene carries `source { chapter, quote }`. After generation the script VERIFIES in code
 *    that each quote is a verbatim substring of the book (after normalising whitespace, curly quotes,
 *    dashes and Gutenberg _italics_ underscores). The stored quote is then replaced by the exact text
 *    from the book, and `source.chapter` is recomputed from where the quote actually sits in the
 *    book, so a wrong chapter guess by the model can never reach the reveal screen.
 *  - Quotes that fail verification are re-asked (EXTRACT.quoteRepairAttempts times) with the full
 *    book; a scene that still fails aborts the run — quotes are never invented or kept unverified.
 *  - The model may correct Wells' 1922 dates/coordinates with modern scholarship (answer.year/lat/lng)
 *    but the event itself must be in the book.
 *
 * Anti-leak checks
 * ----------------
 * imagePrompt / worldPrompt must not name the place, ruler, event or year. The prompt tells the model
 * so, and the script warns (in the log) about any answer-place word or year that slips into a prompt,
 * and about worldPrompt.base over EXTRACT.worldPromptMaxChars or missing the "EXACTLY ONE" anchor.
 *
 * imagePrompt is CONTENT ONLY (viewer position, the one landmark, people, weather, daylight): the
 * image script appends a shared IMAGE_STYLE suffix so all 20 frames look uniform. stripStyle()
 * removes any style boilerplate the model still adds.
 *
 * Use cases
 * ---------
 *  - Full run:   node --env-file=.env.local scripts/extract-scenes.ts
 *  - Only some:  node --env-file=.env.local scripts/extract-scenes.ts hannibal-alps sack-of-rome
 *                (regenerates the named target ids, keeps every other scene from data/scenes.json)
 *  - Check only: node scripts/extract-scenes.ts --verify   (no API calls; verifies quotes + lints)
 * Framing: the player is an ordinary, anonymous passer-by at street level, with ONE world-famous
 * landmark in view (often new or under construction); the local is an ordinary worker/vendor. When
 * Wells does not mention the landmark itself, the quote is his passage on that civilisation/era —
 * still verbatim and verified.
 * The hand-written seed scene (giza-pyramids) is the quality bar: it is kept as-is (after quote
 * verification, with style boilerplate stripped) and passed to the model as the example.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { GoogleGenAI, Type } from "@google/genai";
import { MODELS, PATHS, GAME, EXTRACT } from "../lib/config.ts";
import { log, logGenAI } from "../lib/log.ts";
import type { Scene } from "../lib/scene.ts";

/** One famous moment the extractor must turn into a scene. */
type Target = { id: string; hint: string };

/** Hand-written seed scenes kept verbatim (they are the quality bar). */
const SEED_IDS = ["giza-pyramids"];

/**
 * The 20 moments (seed included): ordinary street-level daily life with ONE world-famous landmark in
 * view, each a clearly different time, spread across continents. Ids are stable image filenames.
 */
const TARGETS: Target[] = [
  { id: "giza-pyramids", hint: "Giza, the Great Pyramid under construction (~2560 BC)" },
  { id: "babylon-ishtar-gate", hint: "Babylon under Nebuchadnezzar II, the blue-glazed Ishtar Gate with the great ziggurat behind (~575 BC)" },
  { id: "athens-parthenon", hint: "Athens, the Parthenon newly finished on the Acropolis, seen from the agora (~432 BC)" },
  { id: "alexandria-pharos", hint: "Alexandria harbour, the Pharos lighthouse newly built (~280 BC)" },
  { id: "great-wall-qin", hint: "The Great Wall being built under Shi Huang-ti (~214 BC)" },
  { id: "rome-colosseum", hint: "Rome, the Colosseum at its opening (AD 80)" },
  { id: "constantinople-hagia-sophia", hint: "Constantinople, Hagia Sophia just completed (537)" },
  { id: "cordoba-mezquita", hint: "Cordoba, the Great Mosque in the caliphate's heyday (~950)" },
  { id: "angkor-wat", hint: "Angkor Wat under construction (~1150)" },
  { id: "beijing-forbidden-city", hint: "Beijing, the Forbidden City newly built (~1420)" },
  { id: "florence-duomo", hint: "Florence, Brunelleschi's dome being completed (~1436)" },
  { id: "tenochtitlan-templo-mayor", hint: "Tenochtitlan, the Templo Mayor, just before the Spanish arrive (1519)" },
  { id: "machu-picchu", hint: "Machu Picchu, the Inca citadel in use (~1530)" },
  { id: "moscow-st-basils", hint: "Moscow, St Basil's Cathedral newly built on Red Square (~1561)" },
  { id: "agra-taj-mahal", hint: "Agra, the Taj Mahal under construction (~1648)" },
  { id: "edo-nihonbashi", hint: "Edo, the busy Nihonbashi bridge with Mount Fuji in the distance (~1700)" },
  { id: "philadelphia-independence-hall", hint: "Philadelphia, Independence Hall in the summer of 1776" },
  { id: "paris-bastille-1789", hint: "Paris, July 1789: a bystander in the tense street near the Bastille fortress (not leading the assault)" },
  { id: "port-said-suez", hint: "Port Said, the opening of the Suez Canal (1869)" },
  { id: "paris-eiffel-tower", hint: "Paris, the Eiffel Tower under construction (1888)" },
];

/** A parsed chapter of the book: its display heading and its char range in the book text. */
type Chapter = { heading: string; start: number; end: number };

/** Gemini responseSchema mirroring the Scene type (lib/scene.ts). */
const SCENE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    title: { type: Type.STRING },
    answer: {
      type: Type.OBJECT,
      properties: {
        place: { type: Type.STRING },
        lat: { type: Type.NUMBER },
        lng: { type: Type.NUMBER },
        year: { type: Type.INTEGER },
      },
      required: ["place", "lat", "lng", "year"],
    },
    reveal: { type: Type.STRING },
    imagePrompt: { type: Type.STRING },
    worldPrompt: {
      type: Type.OBJECT,
      properties: { base: { type: Type.STRING }, idle: { type: Type.STRING }, moving: { type: Type.STRING } },
      required: ["base", "idle", "moving"],
    },
    local: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        role: { type: Type.STRING },
        gender: { type: Type.STRING, enum: ["male", "female"] },
        appearance: { type: Type.STRING },
        voice: { type: Type.STRING },
        persona: { type: Type.STRING },
      },
      required: ["name", "role", "gender", "appearance", "voice", "persona"],
    },
    source: {
      type: Type.OBJECT,
      properties: { chapter: { type: Type.STRING }, quote: { type: Type.STRING } },
      required: ["chapter", "quote"],
    },
  },
  required: ["id", "title", "answer", "reveal", "imagePrompt", "worldPrompt", "local", "source"],
};

/**
 * Normalises text for quote matching and keeps a map back to original offsets.
 * Collapses whitespace, straightens curly quotes, maps dashes to "-", drops "_" italics markers.
 * @param text raw text
 * @returns normalised string and, for each of its chars, the offset in `text`
 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === "_") continue;
    if (/\s/.test(c)) {
      if (norm.endsWith(" ")) continue;
      c = " ";
    } else if (c === "‘" || c === "’") c = "'";
    else if (c === "“" || c === "”") c = '"';
    else if (c === "—" || c === "–") c = "-";
    else if (c === "-" && text[i + 1] === "-") {
      i++;
      c = "-";
    }
    norm += c;
    map.push(i);
  }
  return { norm, map };
}

/** Normalises a quote the same way as the book (no offset map). @param text quote */
function normalize(text: string): string {
  log.info("normalize", { length: text.length });
  return normalizeWithMap(text).norm.trim();
}

/**
 * Converts an upper-case chapter title to the display style used in scenes.json,
 * e.g. "EGYPT, BABYLON AND ASSYRIA" → "Egypt, Babylon and Assyria".
 * @param title upper-case title from the book's table of contents
 */
function titleCase(title: string): string {
  log.info("titleCase", { title });
  const small = new Set(["and", "of", "the", "in", "to", "a", "an", "on", "at", "for", "by", "or", "into", "from", "that", "between", "under", "with"]);
  return title
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/^(\p{L})/u, (m) => m.toUpperCase())))
    .join(" ")
    .replace(/(['’])S\b/g, "$1s");
}

/**
 * Parses the table of contents and locates each chapter in the body of the book.
 * @param book full book text
 * @returns chapters in order with display heading ("LV. The French Revolution …") and char range
 */
function parseChapters(book: string): Chapter[] {
  log.info("parseChapters", { bookChars: book.length });
  const lines = book.split("\n");
  const toc: { numeral: string; title: string }[] = [];
  for (let i = 0; i < lines.length && toc.length < 67; i++) {
    const m = lines[i].match(/^([IVXLC]+)\. ?(.*)$/);
    if (!m) continue;
    let title = m[2].trim();
    if (!/\d+$/.test(title)) title = `${title} ${lines[++i].trim()}`.trim();
    toc.push({ numeral: m[1], title: title.replace(/\s+\d+$/, "").replace(/\s+/g, " ") });
  }
  const lineStarts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    lineStarts.push(pos);
    pos += l.length + 1;
  }
  const chapters: Chapter[] = [];
  let searchFrom = lines.findIndex((l, idx) => idx > 200 && l.trim() === "I");
  for (const { numeral, title } of toc) {
    const idx = lines.findIndex((l, j) => j >= searchFrom && l.trim() === numeral);
    if (idx < 0) throw new Error(`chapter ${numeral} not found in body`);
    chapters.push({ heading: `${numeral}. ${titleCase(title)}`, start: lineStarts[idx], end: book.length });
    searchFrom = idx + 1;
  }
  for (let k = 0; k < chapters.length - 1; k++) chapters[k].end = chapters[k + 1].start;
  return chapters;
}

/**
 * Verifies a quote is verbatim in the book and returns the exact book text plus its real chapter.
 * @param quote quote proposed by the model
 * @param bookNorm normalised book with offset map
 * @param book raw book text
 * @param chapters parsed chapters
 * @returns exact quote and chapter heading, or null if the quote is not in the book
 */
function verifyQuote(
  quote: string,
  bookNorm: { norm: string; map: number[] },
  book: string,
  chapters: Chapter[],
): { quote: string; chapter: string } | null {
  log.info("verifyQuote", { quote });
  const q = normalize(quote);
  if (q.length < 20) return null;
  const at = bookNorm.norm.indexOf(q);
  if (at < 0) return null;
  const start = bookNorm.map[at];
  const end = bookNorm.map[at + q.length - 1] + 1;
  const exact = book.slice(start, end).replace(/\s+/g, " ").replace(/_/g, "");
  const chapter = chapters.find((c) => start >= c.start && start < c.end);
  if (!chapter) return null;
  return { quote: exact, chapter: chapter.heading };
}

/**
 * Calls Gemini with structured JSON output, trying MODELS.sceneText then its fallbacks.
 * Logs every request/response via logGenAI.
 * @param ai Gemini client
 * @param contents prompt text
 * @param schema responseSchema
 * @returns parsed JSON and the model id that worked
 */
async function callGemini(ai: GoogleGenAI, contents: string, schema: object): Promise<{ data: unknown; model: string }> {
  log.info("callGemini", { contentsChars: contents.length });
  const models = [MODELS.sceneText, ...MODELS.sceneTextFallbacks];
  let lastErr: unknown;
  for (const model of models) {
    const config = { responseMimeType: "application/json", responseSchema: schema, temperature: EXTRACT.temperature };
    // Log the prompt without the book body (190k tokens) — it is the committed file PATHS.book.
    const loggedRequest = { model, config, contents: contents.replace(/<BOOK>[\s\S]*<\/BOOK>/, `<BOOK>${PATHS.book}</BOOK>`) };
    try {
      const res = await ai.models.generateContent({ model, contents, config });
      logGenAI("gemini.generateContent", loggedRequest, res.text);
      return { data: JSON.parse(res.text ?? "null"), model };
    } catch (err) {
      logGenAI("gemini.generateContent", loggedRequest, err);
      log.warn("callGemini model failed, trying next", { model, message: (err as Error).message });
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Builds the extraction prompt for one batch of targets.
 * @param book full book text
 * @param batch targets to generate
 * @param examples seed scenes used as the quality bar
 */
function buildPrompt(book: string, batch: Target[], examples: Scene[]): string {
  log.info("buildPrompt", { ids: batch.map((t) => t.id) });
  return `You are building scenes for a GeoGuessr-style history game. The player is dropped into a walkable,
photorealistic first-person scene, talks to a local by voice, then guesses WHERE (map pin) and WHEN (year).

FRAMING: the player is an ordinary, anonymous person walking around a city or site at a historical moment, NOT a
participant in a dramatic event. Each scene is daily life at street level (markets, workers, traffic and dress of the
period), with ONE world-famous, instantly recognisable landmark clearly visible straight ahead (often brand-new or
under construction), so a player looking around can work out where and when they are.

Below is the full text of H.G. Wells, "A Short History of the World" (1922) between <BOOK> tags.

<BOOK>
${book}
</BOOK>

Create exactly ${batch.length} scenes, one per target, in this order, using EXACTLY these ids:
${batch.map((t) => `- id "${t.id}": ${t.hint}`).join("\n")}

Rules:
- answer: precise "place" (site, city, modern country), accurate lat/lng of the exact site (4 decimals) and year
  (negative = BC). Correct Wells' 1922 dates with modern scholarship where they differ.
- source.quote: ONE OR TWO CONSECUTIVE SENTENCES COPIED EXACTLY, CHARACTER FOR CHARACTER, from the book text above,
  about this landmark/place; if Wells does not mention the landmark, use his passage most relevant to that
  civilisation, region and era (e.g. late-19th-century France or industry for a 1888 iron tower). Never invent text.
  Do not paraphrase, do not join non-adjacent sentences, no ellipses.
  It will be machine-checked against the book. source.chapter: the chapter heading as "<ROMAN>. <Title Case Title>",
  e.g. "LV. The French Revolution and the Restoration of Monarchy in France".
- imagePrompt and worldPrompt must NEVER name the city, country, region, ruler, people/nation, event or year.
  Describe visuals only (architecture, clothes, people, objects, landscape, light, weather).
  imagePrompt: CONTENT ONLY, one paragraph starting "Standing ...": where the viewer stands, the ONE main landmark
  straight ahead, people/clothing/activity, weather. Daylight or late afternoon (no night scenes). NO style, camera,
  lens, lighting-grade, aspect-ratio or "no text" boilerplate — a shared style suffix is appended later.
- worldPrompt.base: at most ${EXTRACT.worldPromptMaxChars} characters, ends with "photorealistic." and contains the sentence
  "The world contains EXACTLY ONE <landmark> straight ahead at a fixed position." (fill in the landmark).
  worldPrompt.idle starts "First-person view at human eye level; the camera does not move on its own."
  worldPrompt.moving starts "First-person view at human eye level, walking steadily forward with a slight head bob."
- local: an ordinary passer-by, worker or vendor of the time, never a famous figure.
  role: short everyday occupation (stonemason, legionary on leave, spice merchant, ironworker riveter, tea-house
  waitress...). Across the batch mix workers, tradespeople, soldiers, vendors, sailors, artisans and vary gender
  and age. name: "<first name>, a <role>". gender: "male" or "female".
  appearance: 1-2 sentences for a half-body portrait: age, face, period-accurate clothing/headwear, tools of the
  trade; no text or insignia naming the place. voice is one of
  Charon, Leda, Puck, Orus, Kore, Fenrir, Aoede, Zephyr (match gender). persona: second person ("You are ..."),
  3-4 sentences, speaking in first person about their own work and daily life, rich period clues (daily life, prices, rumours, what they have never heard of) WITHOUT naming the
  city, country, ruler, event or year.
- reveal: one or two sentences shown AFTER the guess, naming place, date and why the moment matters.
- title: short title, e.g. "Building the Great Pyramid".

Match the style and quality of this example scene:
${JSON.stringify(examples, null, 2)}

Return a JSON array of ${batch.length} scene objects.`;
}

/**
 * Asks the model again for a verbatim quote for one scene whose quote failed verification.
 * @param ai Gemini client
 * @param book full book text
 * @param scene scene with the bad quote
 * @param attempt attempt number (1-based)
 * @returns a new {chapter, quote} proposal
 */
async function repairQuote(ai: GoogleGenAI, book: string, scene: Scene, attempt: number): Promise<{ chapter: string; quote: string }> {
  log.info("repairQuote", { id: scene.id, attempt, badQuote: scene.source.quote });
  const prompt = `Below is the full text of H.G. Wells, "A Short History of the World" between <BOOK> tags.

<BOOK>
${book}
</BOOK>

For the historical scene "${scene.title}" (${scene.reveal}), find ONE OR TWO CONSECUTIVE SENTENCES in the book
that discuss it, and copy them EXACTLY, character for character (no paraphrase, no ellipsis, no added words).
Your previous attempt was NOT found verbatim in the book: ${JSON.stringify(scene.source.quote)}
Return JSON {"chapter": "<ROMAN>. <Title Case Title>", "quote": "<exact text>"}.`;
  const schema = {
    type: Type.OBJECT,
    properties: { chapter: { type: Type.STRING }, quote: { type: Type.STRING } },
    required: ["chapter", "quote"],
  };
  const { data } = await callGemini(ai, prompt, schema);
  return data as { chapter: string; quote: string };
}

/** Trailing style boilerplate that must not appear in content-only image prompts. */
const STYLE_BOILERPLATE = /\s*Photorealistic first-person view[^]*$/i;

/**
 * Removes camera/style boilerplate from an imagePrompt so it describes content only.
 * @param imagePrompt prompt from the model or a seed scene
 * @returns content-only prompt
 */
function stripStyle(imagePrompt: string): string {
  log.info("stripStyle", { imagePrompt });
  return imagePrompt.replace(STYLE_BOILERPLATE, "").trim();
}

/**
 * Warns (log only) about prompt leaks and world-prompt format problems in one scene.
 * @param scene scene to lint
 * @returns list of problems found (empty = clean)
 */
function lintScene(scene: Scene): string[] {
  log.info("lintScene", { id: scene.id });
  const problems: string[] = [];
  const generic = new Set(["the", "and", "of", "great", "city", "near", "old", "new", "plateau", "river", "modern", "wall", "basilica", "church", "cathedral", "mosque", "square"]);
  const words = scene.answer.place
    .split(/[\s,()\-]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 3 && !generic.has(w));
  const visible = { imagePrompt: scene.imagePrompt, ...scene.worldPrompt };
  for (const [field, text] of Object.entries(visible)) {
    const lower = text.toLowerCase();
    for (const w of words) if (new RegExp(`\\b${w}\\b`).test(lower)) problems.push(`${field} mentions "${w}"`);
    if (lower.includes(String(Math.abs(scene.answer.year)))) problems.push(`${field} mentions the year`);
  }
  if (scene.worldPrompt.base.length > EXTRACT.worldPromptMaxChars) problems.push(`worldPrompt.base is ${scene.worldPrompt.base.length} chars`);
  if (!scene.worldPrompt.base.includes("EXACTLY ONE")) problems.push(`worldPrompt.base lacks "EXACTLY ONE"`);
  if (/photorealistic|16:9|watermark|first-person view/i.test(scene.imagePrompt)) problems.push(`imagePrompt has style boilerplate`);
  return problems;
}

/**
 * Entry point: loads the book, generates the requested scenes in parallel batches, verifies every
 * quote (repairing failures), lints prompts and writes data/scenes.json in TARGETS order.
 * @param onlyIds optional subset of target ids to regenerate (others are kept from scenes.json)
 */
async function main(onlyIds: string[]): Promise<void> {
  log.info("extractScenes.main", { onlyIds, model: MODELS.sceneText, sceneCount: GAME.sceneCount });
  const verifyOnly = onlyIds.includes("--verify");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !verifyOnly) throw new Error("GEMINI_API_KEY missing — run with node --env-file=.env.local");
  const ai = new GoogleGenAI({ apiKey: apiKey ?? "unused" });

  // The Gutenberg file has CRLF line endings; normalise so chapter parsing and offsets line up.
  const book = readFileSync(PATHS.book, "utf8").replace(/\r\n/g, "\n");
  const bookNorm = normalizeWithMap(book);
  const chapters = parseChapters(book);
  const existing: Scene[] = existsSync(PATHS.scenes) ? JSON.parse(readFileSync(PATHS.scenes, "utf8")) : [];
  const byId = new Map(existing.map((s) => [s.id, s]));
  const examples = SEED_IDS.map((id) => byId.get(id)).filter((s): s is Scene => !!s)
    .map((s) => ({ ...s, imagePrompt: stripStyle(s.imagePrompt) }));

  if (verifyOnly) {
    for (const scene of existing) {
      const v = verifyQuote(scene.source.quote, bookNorm, book, chapters);
      log.info("verify", { id: scene.id, ok: !!v, chapter: v?.chapter, problems: lintScene(scene) });
    }
    return;
  }

  const todo = TARGETS.filter((t) =>
    onlyIds.length ? onlyIds.includes(t.id) : !(SEED_IDS.includes(t.id) && byId.has(t.id)),
  );
  const batches: Target[][] = [];
  for (let i = 0; i < todo.length; i += EXTRACT.batchSize) batches.push(todo.slice(i, i + EXTRACT.batchSize));

  const results = await Promise.all(
    batches.map(async (batch) => {
      const { data, model } = await callGemini(ai, buildPrompt(book, batch, examples), { type: Type.ARRAY, items: SCENE_SCHEMA });
      log.info("batch done", { ids: batch.map((t) => t.id), model });
      return data as Scene[];
    }),
  );
  for (const scene of results.flat()) {
    if (!TARGETS.some((t) => t.id === scene.id)) log.warn("unexpected scene id from model", { id: scene.id });
    else byId.set(scene.id, scene);
  }

  const final: Scene[] = [];
  for (const target of TARGETS) {
    const scene = byId.get(target.id);
    if (!scene) throw new Error(`no scene generated for ${target.id}`);
    let verified = verifyQuote(scene.source.quote, bookNorm, book, chapters);
    for (let attempt = 1; !verified && attempt <= EXTRACT.quoteRepairAttempts; attempt++) {
      log.warn("quote not verbatim, repairing", { id: scene.id, quote: scene.source.quote });
      scene.source = await repairQuote(ai, book, scene, attempt);
      verified = verifyQuote(scene.source.quote, bookNorm, book, chapters);
    }
    if (!verified) throw new Error(`could not get a verbatim quote for ${scene.id}`);
    scene.source = verified;
    scene.imagePrompt = stripStyle(scene.imagePrompt);
    const problems = lintScene(scene);
    if (problems.length) log.warn("scene lint", { id: scene.id, problems });
    final.push(scene);
  }

  if (final.length !== GAME.sceneCount) log.warn("scene count differs from GAME.sceneCount", { got: final.length });
  writeFileSync(PATHS.scenes, JSON.stringify(final, null, 2) + "\n");
  log.info("extractScenes.done", { written: final.length, path: PATHS.scenes });
}

main(process.argv.slice(2)).catch((err) => {
  log.error("extractScenes failed", err);
  process.exit(1);
});

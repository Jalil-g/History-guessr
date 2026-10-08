/**
 * Shared logger — the single place every feature logs through.
 *
 * Why it exists: the hackathon guidelines require (1) an info log for every function call with its
 * parameters and (2) a full log of every GenAI call (model, prompt, config, output). Doing that by
 * hand with console.log in each file produces megabytes of base64 image/audio data and risks leaking
 * secrets, so all logging goes through these helpers instead.
 *
 * Use cases:
 *  - Function entry:      `log.info("generateImage", { id, force })`
 *  - Warnings / errors:   `log.warn("reactor idle disconnect", { eraId })`, `log.error("extract failed", err)`
 *  - GenAI request/response pairs (Gemini text, Gemini image, Gemini Live token minting, Reactor
 *    setImage / setPrompt):  `logGenAI("gemini.generateContent", request, response)`
 *    Inline binary payloads (`inlineData.data`, `data:` URLs, long base64 strings) are replaced by
 *    `"<inline data: N bytes, mime>"`, and keys that look like secrets (apiKey, token, authorization)
 *    are redacted.
 *
 * Works in both Node scripts / API routes and the browser (it only uses `console`).
 */

type Fields = Record<string, unknown> | unknown;

const SECRET_KEY = /^(api[-_]?key|key|token|access[-_]?token|authorization|secret|password)$/i;
const BASE64_MIN_LEN = 512;

/**
 * Returns a deep copy of `value` that is safe to log: base64 / inline data is replaced by a size
 * placeholder and secret-looking keys are redacted.
 * @param value any JSON-like value (request, response, params)
 * @param depth recursion guard
 */
export function stripForLog(value: unknown, depth = 0): unknown {
  if (depth > 12) return "<max depth>";
  if (typeof value === "string") {
    if (value.startsWith("data:")) return `<inline data: ${value.length} chars, ${value.slice(5, value.indexOf(";"))}>`;
    if (value.length >= BASE64_MIN_LEN && /^[A-Za-z0-9+/=\s]+$/.test(value)) return `<inline data: ${value.length} chars>`;
    return value;
  }
  if (typeof ArrayBuffer !== "undefined" && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) {
    return `<inline data: ${(value as ArrayBuffer).byteLength} bytes>`;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) return `<inline data: ${value.size} bytes, ${value.type}>`;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => stripForLog(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) out[k] = "<redacted>";
      else if (k === "inlineData" && v && typeof v === "object" && "data" in v) {
        const d = v as { data?: string; mimeType?: string };
        out[k] = `<inline data: ${d.data?.length ?? 0} chars, ${d.mimeType ?? "unknown"}>`;
      } else out[k] = stripForLog(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Formats one log line with an ISO timestamp and a scope tag.
 * @param scope short name of the function or feature, e.g. "extractScenes"
 */
function prefix(scope: string): string {
  return `[${new Date().toISOString()}] [${scope}]`;
}

export const log = {
  /**
   * Info log — use at the top of every function with its parameters.
   * @param scope function or feature name
   * @param fields parameters / context (stripped of inline data and secrets)
   */
  info(scope: string, fields?: Fields) {
    console.info(prefix(scope), fields === undefined ? "" : stripForLog(fields));
  },
  /** Warning log. @param scope function or feature name @param fields context */
  warn(scope: string, fields?: Fields) {
    console.warn(prefix(scope), fields === undefined ? "" : stripForLog(fields));
  },
  /** Error log. @param scope function or feature name @param fields error or context */
  error(scope: string, fields?: Fields) {
    console.error(prefix(scope), fields === undefined ? "" : stripForLog(fields));
  },
};

/**
 * Logs one GenAI call: the full request (model, prompt, config) and its output, with inline
 * binary data stripped. Call it once per request, after the response (or error) arrives.
 * @param name call site, e.g. "gemini.generateContent" or "reactor.setPrompt"
 * @param request everything sent to the model (model name, prompt/contents, config)
 * @param response the model output, or the thrown error
 */
export function logGenAI(name: string, request: unknown, response: unknown) {
  console.info(prefix(`genai:${name}`), JSON.stringify({ request: stripForLog(request), response: stripForLog(response) }, null, 2));
}

/**
 * Talking-avatar helpers — voice picking, error wording and the avatar_id cache.
 *
 * Feature: "Talking avatar (Reactor vidu-s2-avatar)". useAvatarSession drives the Reactor session;
 * the small pure-ish pieces it needs live here so the hook stays readable:
 *
 *  - `guessGender(scene)`: the local's gender — `local.gender` when the extractor provides it, else
 *    inferred from the Gemini Live voice the scene names (Kore/Leda/Aoede… are female voices) and
 *    finally from pronouns in the persona.
 *  - `pickAvatarVoice(voices, gender)`: chooses a vidu-s2-avatar built-in voice. `list_voices` replies
 *    `{ system: [{ voice, description, accent }], cloned: [{ voice }], default_voice }`; the format of
 *    `description` is not documented, so we match "female/woman/girl" vs "male/man/boy" words in
 *    description + voice name, prefer English accents, and fall back to `default_voice`.
 *  - `describeAvatarError(code, reason)`: readable text for command_error codes (NO_AVATAR, BUSY,
 *    AVATAR_FAILED, AVATAR_TIMEOUT, AVATAR_NOT_FOUND, UPSTREAM_CAPACITY, …) and mic errors.
 *  - `readCachedAvatarId` / `writeCachedAvatarId` / `clearCachedAvatarId`: avatars stay valid for
 *    90 days, so a scene's `avatar_id` is cached in localStorage (try/catch — storage may be blocked)
 *    and re-bound with attachAvatar next time instead of re-uploading and re-creating it.
 */
import type { ViduS2AvatarVoicesMessage } from "@reactor-models/vidu-s2-avatar";
import { AVATAR } from "@/lib/config";
import { log } from "@/lib/log";
import type { Scene } from "@/lib/scene";

export type Gender = "male" | "female" | "unknown";

const FEMALE_GEMINI_VOICES = /^(kore|leda|aoede|zephyr|callirrhoe|autonoe|despina|erinome|laomedeia|achernar|gacrux|pulcherrima|vindemiatrix|sulafat)$/i;
const MALE_GEMINI_VOICES = /^(charon|puck|orus|fenrir|enceladus|iapetus|umbriel|algieba|algenib|rasalgethi|alnilam|schedar|achird|zubenelgenubi|sadachbia|sadaltager)$/i;

/**
 * Best guess of the local's gender for voice matching.
 * @param scene the round's scene
 * @returns "male", "female" or "unknown"
 */
export function guessGender(scene: Scene): Gender {
  log.info("guessGender", { sceneId: scene.id, gender: scene.local.gender, voice: scene.local.voice });
  const g = scene.local.gender?.toLowerCase() ?? "";
  if (/^(f|female|woman)/.test(g)) return "female";
  if (/^(m|male|man)/.test(g)) return "male";
  if (FEMALE_GEMINI_VOICES.test(scene.local.voice)) return "female";
  if (MALE_GEMINI_VOICES.test(scene.local.voice)) return "male";
  const p = ` ${scene.local.persona.toLowerCase()} `;
  if (/\b(she|her|woman|wife|mother|daughter|widow|girl)\b/.test(p)) return "female";
  if (/\b(he|his|man|husband|father|son|boy)\b/.test(p)) return "male";
  return "unknown";
}

/**
 * Picks a vidu-s2-avatar voice that matches the local's gender.
 * @param voices the `voices` reply from listVoices (or undefined if it failed)
 * @param gender the local's gender
 * @returns a voice id for startCall, or undefined to use the model default
 */
export function pickAvatarVoice(voices: ViduS2AvatarVoicesMessage | undefined, gender: Gender): string | undefined {
  log.info("pickAvatarVoice", { gender, count: voices?.system?.length ?? 0, default: voices?.default_voice });
  if (!voices) return undefined;
  const entries = (voices.system ?? [])
    .map((v) => (typeof v === "string" ? { voice: v } : (v as { voice?: string; description?: string; accent?: string })))
    .filter((v): v is { voice: string; description?: string; accent?: string } => typeof v.voice === "string");
  if (gender === "unknown" || entries.length === 0) return voices.default_voice || undefined;
  const text = (v: { voice: string; description?: string }) => ` ${v.voice} ${v.description ?? ""} `.toLowerCase();
  const isFemale = (v: { voice: string; description?: string }) => /\b(female|woman|girl|lady|feminine)\b/.test(text(v));
  const isMale = (v: { voice: string; description?: string }) => !isFemale(v) && /\b(male|man|boy|gentleman|masculine)\b/.test(text(v));
  const matches = entries.filter(gender === "female" ? isFemale : isMale);
  const english = matches.filter((v) => /english|american|british|us|uk/i.test(`${v.accent ?? ""} ${v.description ?? ""}`));
  const chosen = (english[0] ?? matches[0])?.voice;
  log.info("pickAvatarVoice chosen", { chosen, matches: matches.length });
  return chosen ?? (voices.default_voice || undefined);
}

/**
 * Readable message for an avatar error code.
 * @param code command_error code, or a local code ("MIC_DENIED", "NO_MIC", "PORTRAIT_MISSING", "TOKEN", "CONNECT")
 * @param reason the server's readable reason, if any
 * @returns one sentence for the player
 */
export function describeAvatarError(code: string, reason?: string): string {
  log.info("describeAvatarError", { code, reason });
  switch (code) {
    case "MIC_DENIED":
      return "Microphone blocked — allow mic access in the browser bar and try again.";
    case "NO_MIC":
      return "No microphone found — plug one in and try again.";
    case "NO_AVATAR":
      return "The local isn't ready yet — wait a moment and try again.";
    case "BUSY":
      return "A conversation is already running.";
    case "AVATAR_FAILED":
    case "AVATAR_TIMEOUT":
      return "Couldn't bring this local to life — falling back to voice only.";
    case "AVATAR_NOT_FOUND":
      return "The saved local expired — recreating it.";
    case "UPSTREAM_CAPACITY":
    case "RATE_LIMITED":
      return "All the time-machine operators are busy — try again in a moment.";
    case "PORTRAIT_MISSING":
      return "This local has no portrait yet — voice only.";
    case "TOKEN":
      return "Couldn't get a pass for the avatar service — voice only.";
    case "CONNECT":
      return "Couldn't reach the avatar service — voice only.";
    default:
      return reason || `Something went wrong (${code}).`;
  }
}

/**
 * Reads the cached avatar_id for a scene (null when absent or storage is blocked).
 * @param sceneId scene id
 */
export function readCachedAvatarId(sceneId: string): string | null {
  log.info("readCachedAvatarId", { sceneId });
  try {
    return window.localStorage.getItem(AVATAR.cacheKeyPrefix + sceneId);
  } catch {
    return null;
  }
}

/**
 * Stores a scene's avatar_id for reuse (ignored when storage is blocked).
 * @param sceneId scene id
 * @param avatarId id reported by session_state
 */
export function writeCachedAvatarId(sceneId: string, avatarId: string): void {
  log.info("writeCachedAvatarId", { sceneId, avatarId });
  try {
    window.localStorage.setItem(AVATAR.cacheKeyPrefix + sceneId, avatarId);
  } catch {
    /* storage blocked — the avatar is simply recreated next time */
  }
}

/**
 * Forgets a scene's cached avatar_id (e.g. after AVATAR_NOT_FOUND).
 * @param sceneId scene id
 */
export function clearCachedAvatarId(sceneId: string): void {
  log.info("clearCachedAvatarId", { sceneId });
  try {
    window.localStorage.removeItem(AVATAR.cacheKeyPrefix + sceneId);
  } catch {
    /* ignore */
  }
}

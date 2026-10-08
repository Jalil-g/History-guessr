/**
 * Prebuilt talking-avatar ids — typed loader for data/avatars.json.
 *
 * Feature: "Talking avatar (Reactor vidu-s2-avatar)" → prebuilt avatars. Creating a vidu-s2-avatar
 * from a local's portrait takes ~40 s (session_state avatar_status "processing" for a long time), but
 * Reactor keeps a created avatar for 90 days and `attachAvatar({ avatar_id })` binds an existing one
 * in a few seconds. So every scene's avatar is created ONCE, offline, by the dev page
 * app/dev/prewarm-avatars (driven headlessly by scripts/prewarm-avatars.ts), and the ids are committed
 * here:
 *
 *   data/avatars.json  { "<sceneId>": { "avatarId": "...", "createdAt": "<ISO date>", "portrait": "/locals/<id>.png" } }
 *
 * Use cases:
 *  - components/avatar/useAvatarSession.ts calls `getPrebuiltAvatarId(scene.id)` first in each round;
 *    on a hit it only attaches (fast), else it falls back to the localStorage cache, then createAvatar.
 *  - the prewarm page uses `getPrebuiltAvatar` in attach-only mode to measure the attach path.
 * Entries older than AVATAR.prebuiltMaxAgeDays are treated as missing (they expire after 90 days);
 * re-run `node scripts/prewarm-avatars.ts --force` to refresh them. The JSON is bundled at build time.
 */
import avatarsJson from "@/data/avatars.json";
import { AVATAR } from "./config";
import { log } from "./log";

/** One scene's prebuilt avatar. */
export type PrebuiltAvatar = {
  /** Reactor avatar id, from session_state.avatar_id after createAvatar. */
  avatarId: string;
  /** When it was created (ISO 8601) — avatars expire 90 days later. */
  createdAt: string;
  /** Portrait the avatar was created from (public URL). */
  portrait: string;
};

/** All prebuilt avatars keyed by scene id. */
export const PREBUILT_AVATARS: Record<string, PrebuiltAvatar> = avatarsJson as Record<string, PrebuiltAvatar>;

/**
 * Returns a scene's prebuilt avatar entry, if any (regardless of age).
 * @param sceneId scene id
 * @returns the entry, or undefined
 */
export function getPrebuiltAvatar(sceneId: string): PrebuiltAvatar | undefined {
  log.info("getPrebuiltAvatar", { sceneId });
  return PREBUILT_AVATARS[sceneId];
}

/**
 * Returns a scene's prebuilt avatar id when present and younger than AVATAR.prebuiltMaxAgeDays.
 * @param sceneId scene id
 * @param now current time in ms (for tests)
 * @returns the avatar id, or null when missing / expired / malformed
 */
export function getPrebuiltAvatarId(sceneId: string, now: number = Date.now()): string | null {
  const entry = PREBUILT_AVATARS[sceneId];
  const created = entry ? Date.parse(entry.createdAt) : NaN;
  const ageDays = (now - created) / 86_400_000;
  const ok = !!entry?.avatarId && Number.isFinite(ageDays) && ageDays <= AVATAR.prebuiltMaxAgeDays;
  log.info("getPrebuiltAvatarId", { sceneId, found: !!entry, ageDays: Number.isFinite(ageDays) ? Math.round(ageDays) : null, ok });
  return ok ? entry!.avatarId : null;
}

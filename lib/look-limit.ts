/**
 * look-limit — pure math for clamping the camera's look direction in the walkable world.
 *
 * Why: LingBot World 2 happily lets the player spin 360° with the arrow keys. Once the camera turns
 * away from the scene's landmark (the one important object straight ahead in the first frame), the
 * world model generates fresh content and "forgets" the landmark, so the player loses the main clue.
 * We therefore keep the accumulated yaw within ±REACTOR.maxYawDeg and pitch within
 * ±REACTOR.maxPitchDeg of the starting view.
 *
 * How the model rotates: the arrow keys map to the discrete `look_horizontal` / `look_vertical`
 * inputs ("idle" | "left"/"right" | "up"/"down"). While one is not idle, the model rotates the camera
 * by `rotation_speed_deg` degrees per frame of each generated chunk. Every input applies from the
 * NEXT chunk. Each `chunk_complete` message reports the composite `active_action` that drove that
 * chunk (e.g. "w+left+up") and `frames_emitted`, so the real rotation of a finished chunk is
 * sign(action) × frames × speed — that is what useWasdControls accumulates.
 *
 * Clamping: before each chunk, `planLook` projects where the camera will be (committed angle + the
 * chunk already in flight) and, for each held look direction, either lets it through, slows the
 * shared rotation speed so the next chunk lands exactly on the limit, or sends "idle" when there is no
 * room left in that direction. The opposite direction always has room, so it keeps working.
 *
 * Sign convention (ours, only used for bookkeeping/HUD): right = +yaw, up = +pitch. We never send
 * signed angles to the model, so the SDK's own axis signs don't matter here.
 *
 * Use cases: components/world/useWasdControls.ts (gating + accumulation), LookIndicator (HUD), and
 * a quick node check of the edge cases (no React / SDK imports, so Node can run it directly).
 */

export type YawCmd = "idle" | "left" | "right";
export type PitchCmd = "idle" | "up" | "down";

/** Remaining degrees at or below which a direction counts as "at the limit". */
export const LOOK_EPS_DEG = 0.05;
/** Upper bound of LingBot World 2's rotation_speed_deg input. */
export const MAX_ROTATION_SPEED_DEG = 30;

/**
 * Parses a composite action string ("w+left+up", "still", …) into look signs.
 * @param action `active_action` from chunk_complete (or `current_action` from state)
 * @returns yaw sign (right = +1) and pitch sign (up = +1)
 */
export function lookSigns(action: string): { yaw: number; pitch: number } {
  const parts = action.split("+");
  return {
    yaw: (parts.includes("right") ? 1 : 0) - (parts.includes("left") ? 1 : 0),
    pitch: (parts.includes("up") ? 1 : 0) - (parts.includes("down") ? 1 : 0),
  };
}

/**
 * Signed direction of a look command.
 * @param cmd yaw or pitch command
 * @returns +1 (right/up), -1 (left/down) or 0 (idle)
 */
export function cmdSign(cmd: YawCmd | PitchCmd): number {
  return cmd === "right" || cmd === "up" ? 1 : cmd === "left" || cmd === "down" ? -1 : 0;
}

/**
 * Rotation produced by one chunk.
 * @param yawSign -1/0/+1
 * @param pitchSign -1/0/+1
 * @param speedDeg rotation_speed_deg in effect for that chunk
 * @param frames rotation frames in the chunk
 * @returns degrees of yaw and pitch added by the chunk
 */
export function chunkDelta(yawSign: number, pitchSign: number, speedDeg: number, frames: number): { yaw: number; pitch: number } {
  return { yaw: yawSign * speedDeg * frames, pitch: pitchSign * speedDeg * frames };
}

/**
 * Degrees of room left when rotating in `sign`'s direction.
 * @param pos current (projected) angle
 * @param sign +1 / -1 direction of rotation
 * @param max symmetric limit (±max)
 * @returns room in degrees (≤ 0 when at/over the limit)
 */
export function roomLeft(pos: number, sign: number, max: number): number {
  return max - sign * pos;
}

export type PlanInput = {
  /** Projected yaw/pitch at the start of the chunk being planned (committed + in-flight chunk). */
  yaw: number;
  pitch: number;
  /** What the held keys ask for. */
  wantYaw: YawCmd;
  wantPitch: PitchCmd;
  /** Normal rotation speed (REACTOR.rotationSpeedDeg). */
  baseSpeedDeg: number;
  /** Rotation frames per chunk. */
  frames: number;
  maxYawDeg: number;
  maxPitchDeg: number;
};

export type LookPlan = { yaw: YawCmd; pitch: PitchCmd; speedDeg: number };

/**
 * Decides the look commands + rotation speed for the next chunk so neither axis passes its limit.
 * @param p see PlanInput
 * @returns commands to send and the (possibly reduced) rotation speed
 */
export function planLook(p: PlanInput): LookPlan {
  const frames = Math.max(1, p.frames);
  let speed = Math.min(p.baseSpeedDeg, MAX_ROTATION_SPEED_DEG);
  let yaw: YawCmd = p.wantYaw;
  let pitch: PitchCmd = p.wantPitch;
  const ys = cmdSign(yaw);
  if (ys !== 0) {
    const room = roomLeft(p.yaw, ys, p.maxYawDeg);
    if (room <= LOOK_EPS_DEG) yaw = "idle";
    else speed = Math.min(speed, room / frames);
  }
  const ps = cmdSign(pitch);
  if (ps !== 0) {
    const room = roomLeft(p.pitch, ps, p.maxPitchDeg);
    if (room <= LOOK_EPS_DEG) pitch = "idle";
    else speed = Math.min(speed, room / frames);
  }
  // A blocked axis adds no cap, so it never slows the other axis down.
  return { yaw, pitch, speedDeg: Math.max(0, speed) };
}

/**
 * Whether the camera is at (or pushing against) the limit on each side.
 * @param yaw committed yaw
 * @param pitch committed pitch
 * @param maxYawDeg yaw limit
 * @param maxPitchDeg pitch limit
 * @returns flags for left/right/up/down
 */
export function limitFlags(yaw: number, pitch: number, maxYawDeg: number, maxPitchDeg: number) {
  const tol = 0.5;
  return {
    left: roomLeft(yaw, -1, maxYawDeg) <= tol,
    right: roomLeft(yaw, 1, maxYawDeg) <= tol,
    up: roomLeft(pitch, 1, maxPitchDeg) <= tol,
    down: roomLeft(pitch, -1, maxPitchDeg) <= tol,
  };
}

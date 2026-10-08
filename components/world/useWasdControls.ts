"use client";
/**
 * useWasdControls — keyboard → world-model movement axes, with a look limit (model-agnostic: chunk
 * events and rotation speed go through the chosen adapter, components/world/adapters/*).
 *
 * Maps WASD to walking (longitudinal forward/back, lateral strafe) and the arrow keys to looking
 * (horizontal yaw, vertical pitch). For each axis the most recently pressed held key wins; releasing
 * it falls back to the other held key on that axis or "idle". Walking is reported straight through
 * callbacks; useWorldSession turns them into `set_move_*` / `set_look_*` commands and the
 * idle ↔ moving prompt swap.
 *
 * Look limit (lib/look-limit.ts, REACTOR.maxYawDeg / maxPitchDeg): the world model forgets the
 * scene's landmark if the player spins away from it, so look input is GATED before it reaches
 * `onAxis`:
 *  - Accumulation: every `chunk_complete` reports the chunk's `active_action` ("w+left+up"…) and
 *    `frames_emitted`; the real rotation of that chunk = sign × frames × the rotation_speed_deg that
 *    was in effect when the chunk started (the "in-flight" snapshot taken at the previous
 *    chunk_complete). This is added to the committed yaw/pitch (0 = starting view, facing the landmark).
 *  - Clamping: on every key change and every chunk_complete, planLook projects committed + in-flight
 *    rotation and decides the next chunk's look commands: pass through, lower the shared
 *    rotation_speed_deg so the chunk lands exactly on the limit, or send "idle" when there is no room
 *    in that direction. The opposite direction always works. WASD strafing never rotates.
 *  - resetLook(): zeroes the bookkeeping. Called automatically every time the hook becomes enabled
 *    (= a world session goes live, including after a reconnect), so each session starts facing the
 *    landmark; also returned for callers that want to reset explicitly.
 * The hook must run inside the adapter's <Provider> (it listens to chunk_complete through
 * adapter.useChunkComplete and sets the rotation speed through adapter.useWorld()). No mouse-look exists, so the arrow keys are the only rotation source.
 *
 * Use cases:
 *  - `onAxis(axis, value)`   → send the movement command for that axis (look values already gated)
 *  - `onMovingChange(bool)`  → swap the `moving` / `idle` prompt layer
 *  - `onInput()`             → reset the idle-disconnect timer
 *  - returned `look`         → current yaw/pitch for the HUD heading indicator (LookIndicator)
 * Ignores keys while the user types in an input/textarea (e.g. a guess field), ignores auto-repeat,
 * and releases everything when disabled or when the window loses focus.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { REACTOR } from "@/lib/config";
import { log } from "@/lib/log";
import type { WorldAdapter } from "./adapters/types";
import { chunkDelta, cmdSign, lookSigns, planLook, type LookPlan, type PitchCmd, type YawCmd } from "@/lib/look-limit";

export type Axis = "long" | "lat" | "yaw" | "pitch";

/** Accumulated camera rotation relative to the starting view (right / up positive), in degrees. */
export type LookState = { yaw: number; pitch: number };

const KEY_MAP: Record<string, { axis: Axis; value: string }> = {
  KeyW: { axis: "long", value: "forward" },
  KeyS: { axis: "long", value: "back" },
  KeyA: { axis: "lat", value: "strafe_left" },
  KeyD: { axis: "lat", value: "strafe_right" },
  ArrowUp: { axis: "pitch", value: "up" },
  ArrowDown: { axis: "pitch", value: "down" },
  ArrowLeft: { axis: "yaw", value: "left" },
  ArrowRight: { axis: "yaw", value: "right" },
};

type Callbacks = {
  onAxis: (axis: Axis, value: string) => void;
  onMovingChange: (moving: boolean) => void;
  onInput: () => void;
};

/** Look commands + speed with nothing held (also the state right after a session starts). */
const IDLE_PLAN: LookPlan = { yaw: "idle", pitch: "idle", speedDeg: REACTOR.rotationSpeedDeg };

/**
 * Listens to the keyboard while `enabled` and reports axis / moving changes, clamping look rotation.
 * @param enabled only listen while true (i.e. the live world is generating)
 * @param callbacks see Callbacks (read through a ref, so they may change every render)
 * @param adapter the chosen world model's adapter (chunk events + rotation speed)
 * @returns `look` (accumulated yaw/pitch for the HUD) and `resetLook()`
 */
export function useWasdControls(enabled: boolean, callbacks: Callbacks, adapter: WorldAdapter): { look: LookState; resetLook: () => void } {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const lw = adapter.useWorld();
  const lwRef = useRef(lw);
  lwRef.current = lw;

  const enabledRef = useRef(false);
  const lookRef = useRef<LookState>({ yaw: 0, pitch: 0 });
  const wantRef = useRef<{ yaw: YawCmd; pitch: PitchCmd }>({ yaw: "idle", pitch: "idle" });
  const sentRef = useRef<LookPlan>(IDLE_PLAN);
  const inFlightRef = useRef<LookPlan>(IDLE_PLAN);
  const framesRef = useRef<number>(REACTOR.lookFramesPerChunk || REACTOR.lookFramesPerChunkFallback);
  const [look, setLook] = useState<LookState>({ yaw: 0, pitch: 0 });

  /** Recomputes the gated look commands for the next chunk and sends whatever changed. */
  const replan = useCallback(() => {
    if (!enabledRef.current) return;
    const frames = framesRef.current;
    const f = inFlightRef.current;
    const d = chunkDelta(cmdSign(f.yaw), cmdSign(f.pitch), f.speedDeg, frames);
    const plan = planLook({
      yaw: lookRef.current.yaw + d.yaw,
      pitch: lookRef.current.pitch + d.pitch,
      wantYaw: wantRef.current.yaw,
      wantPitch: wantRef.current.pitch,
      baseSpeedDeg: REACTOR.rotationSpeedDeg,
      frames,
      maxYawDeg: REACTOR.maxYawDeg,
      maxPitchDeg: REACTOR.maxPitchDeg,
    });
    const sent = sentRef.current;
    if (plan.yaw === sent.yaw && plan.pitch === sent.pitch && Math.abs(plan.speedDeg - sent.speedDeg) < 1e-3) return;
    log.info("useWasdControls.replan", { look: lookRef.current, inFlight: f, want: wantRef.current, plan, frames });
    sentRef.current = plan;
    if (Math.abs(plan.speedDeg - sent.speedDeg) >= 1e-3) {
      void lwRef.current.setRotationSpeedDeg(plan.speedDeg).catch((e: unknown) => log.warn("setRotationSpeedDeg failed", e));
    }
    if (plan.yaw !== sent.yaw) cbRef.current.onAxis("yaw", plan.yaw);
    if (plan.pitch !== sent.pitch) cbRef.current.onAxis("pitch", plan.pitch);
  }, []);

  /** Resets the accumulated yaw/pitch to 0 (= facing the landmark, as at session start). */
  const resetLook = useCallback(() => {
    log.info("resetLook", { from: lookRef.current });
    lookRef.current = { yaw: 0, pitch: 0 };
    wantRef.current = { yaw: "idle", pitch: "idle" };
    sentRef.current = IDLE_PLAN;
    inFlightRef.current = IDLE_PLAN;
    setLook({ yaw: 0, pitch: 0 });
  }, []);

  // Accumulate the real rotation of each finished chunk, then re-plan the next one.
  adapter.useChunkComplete((m) => {
    if (!enabledRef.current) return;
    const frames = REACTOR.lookFramesPerChunk || m.framesEmitted || REACTOR.lookFramesPerChunkFallback;
    framesRef.current = frames;
    const s = lookSigns(m.activeAction);
    const d = chunkDelta(s.yaw, s.pitch, inFlightRef.current.speedDeg, frames);
    if (d.yaw !== 0 || d.pitch !== 0) {
      lookRef.current = { yaw: lookRef.current.yaw + d.yaw, pitch: lookRef.current.pitch + d.pitch };
      setLook(lookRef.current);
      log.info("useWasdControls.chunk", { chunk: m.chunkIndex, action: m.activeAction, frames, speedDeg: inFlightRef.current.speedDeg, look: lookRef.current });
    }
    // The next chunk starts now with whatever was last sent.
    inFlightRef.current = sentRef.current;
    replan();
  });

  useEffect(() => {
    log.info("useWasdControls", { enabled });
    if (!enabled) return;
    resetLook(); // every live session (incl. a reconnect) starts facing the landmark
    enabledRef.current = true;
    const held: string[] = [];
    let moving = false;

    /** Re-evaluates one axis and the moving flag after a key change. @param axis changed axis */
    const update = (axis: Axis) => {
      const last = [...held].reverse().find((k) => KEY_MAP[k].axis === axis);
      const value = last ? KEY_MAP[last].value : "idle";
      if (axis === "yaw" || axis === "pitch") {
        if (axis === "yaw") wantRef.current = { ...wantRef.current, yaw: value as YawCmd };
        else wantRef.current = { ...wantRef.current, pitch: value as PitchCmd };
        if (enabledRef.current) replan();
        else cbRef.current.onAxis(axis, value); // tearing down: just release
      } else {
        cbRef.current.onAxis(axis, value);
      }
      const nowMoving = held.some((k) => KEY_MAP[k].axis === "long" || KEY_MAP[k].axis === "lat");
      if (nowMoving !== moving) {
        moving = nowMoving;
        cbRef.current.onMovingChange(moving);
      }
    };

    /** True when focus is in a text field. @param e keyboard event */
    const isTyping = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");

    /** keydown handler. @param e keyboard event */
    const down = (e: KeyboardEvent) => {
      const m = KEY_MAP[e.code];
      if (!m || isTyping(e)) return;
      e.preventDefault();
      cbRef.current.onInput();
      if (e.repeat || held.includes(e.code)) return;
      held.push(e.code);
      update(m.axis);
    };
    /** keyup handler. @param e keyboard event */
    const up = (e: KeyboardEvent) => {
      const i = held.indexOf(e.code);
      if (i < 0) return;
      held.splice(i, 1);
      update(KEY_MAP[e.code].axis);
    };
    /** Releases all held keys (blur / disable). */
    const releaseAll = () => {
      const axes = new Set(held.map((k) => KEY_MAP[k].axis));
      held.length = 0;
      axes.forEach((a) => update(a));
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
      enabledRef.current = false;
      releaseAll();
    };
  }, [enabled, replan, resetLook]);

  return { look, resetLook };
}

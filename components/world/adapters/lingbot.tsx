"use client";
/**
 * LingBot (v1) adapter — wraps @reactor-models/lingbot (Reactor model MODELS.reactorWorldLingbot,
 * "reactor/lingbot") behind the WorldAdapter interface (./types.ts).
 *
 * LingBot is the predecessor of LingBot World 2 with the same image → prompt → start lifecycle, the
 * same look commands (set_look_horizontal / set_look_vertical at set_rotation_speed_deg) and the same
 * chunk_complete payload (`active_action`, `frames_emitted`), so the look clamp works unchanged. The
 * one difference is walking: a SINGLE movement axis (set_movement: idle / forward / back /
 * strafe_left / strafe_right) instead of separate longitudinal + lateral axes. This adapter keeps both
 * axes in a ref and sends the most recently pressed non-idle one (W wins over A/D only if pressed
 * later; releasing it falls back to the other held axis).
 *
 * Use cases: picked as "LingBot" on the intro screen — an alternative look/feel of the walkable scene.
 */
import { useMemo, useRef } from "react";
import {
  LingbotMainVideoView,
  LingbotProvider,
  useLingbot,
  useLingbotChunkComplete,
  useLingbotCommandError,
} from "@reactor-models/lingbot";
import { log } from "@/lib/log";
import type { ChunkInfo, MoveAxis, MoveValue, WorldAdapter, WorldControls, WorldProviderProps } from "./types";

/** Session provider. @param props children + apiUrl + jwtToken resolver */
function Provider({ children, apiUrl, jwtToken }: WorldProviderProps) {
  log.info("lingbot.Provider", { apiUrl });
  return (
    <LingbotProvider apiUrl={apiUrl} jwtToken={jwtToken}>
      {children}
    </LingbotProvider>
  );
}

/** Full-bleed live video. @param props optional style */
function Video({ style }: { style?: React.CSSProperties }) {
  return <LingbotMainVideoView videoObjectFit="cover" style={style} />;
}

/**
 * Picks the single movement value from the two held axes (most recently changed non-idle wins).
 * @param axes current value per axis
 * @param last axis changed most recently
 * @returns value for set_movement
 */
export function combineMovement(axes: Record<MoveAxis, MoveValue>, last: MoveAxis): MoveValue {
  const other: MoveAxis = last === "long" ? "lat" : "long";
  return axes[last] !== "idle" ? axes[last] : axes[other];
}

/**
 * Imperative controls on the LingBot session.
 * @returns WorldControls
 */
function useWorld(): WorldControls {
  const lb = useLingbot();
  const axesRef = useRef<Record<MoveAxis, MoveValue>>({ long: "idle", lat: "idle" });
  const sentRef = useRef<MoveValue>("idle");
  return useMemo<WorldControls>(
    () => ({
      status: lb.status,
      connect: () => lb.connect(),
      disconnect: () => lb.disconnect(),
      setImage: async (image, name) => {
        log.info("lingbot.setImage", { name, bytes: image.size });
        const ref = await lb.uploadFile(image, { name });
        return lb.setImage({ image: ref });
      },
      setPrompt: (prompt) => lb.setPrompt({ prompt }),
      setRotationSpeedDeg: (deg) => lb.setRotationSpeedDeg({ rotation_speed_deg: deg }),
      start: async () => {
        await lb.start();
      },
      move: (axis, value) => {
        axesRef.current = { ...axesRef.current, [axis]: value };
        const movement = combineMovement(axesRef.current, axis);
        log.info("lingbot.move", { axis, value, movement });
        if (movement === sentRef.current) return;
        sentRef.current = movement;
        void lb.setMovement({ movement });
      },
      look: (axis, value) => {
        log.info("lingbot.look", { axis, value });
        if (axis === "yaw") void lb.setLookHorizontal({ look_horizontal: value as "idle" | "left" | "right" });
        else void lb.setLookVertical({ look_vertical: value as "idle" | "up" | "down" });
      },
    }),
    [lb],
  );
}

/** Finished-chunk subscription. @param handler called with each chunk's action + frame count */
function useChunkComplete(handler: (c: ChunkInfo) => void) {
  useLingbotChunkComplete((m) =>
    handler({ chunkIndex: m.chunk_index, activeAction: m.active_action, framesEmitted: m.frames_emitted }),
  );
}

/** Command-error subscription. @param handler called with the raw error message */
function useCommandError(handler: (m: unknown) => void) {
  useLingbotCommandError((m) => handler(m));
}

export const lingbotAdapter: WorldAdapter = { Provider, Video, useWorld, useChunkComplete, useCommandError };

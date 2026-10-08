"use client";
/**
 * LingBot World 2 adapter — wraps @reactor-models/lingbot-world-2 (Reactor model
 * MODELS.reactorWorld, "reactor/lingbot-world-2") behind the WorldAdapter interface (./types.ts).
 *
 * This is the default world model and the behaviour the game was built and tuned on: it starts from
 * the scene's first frame (set_image), takes the layered world prompt (set_prompt, hot-swapped
 * between idle / moving), walks on two independent axes (set_move_longitudinal + set_move_lateral)
 * and looks on two axes (set_look_horizontal / set_look_vertical) at set_rotation_speed_deg degrees
 * per frame. Every chunk_complete carries `active_action` + `frames_emitted`, which the look clamp
 * (lib/look-limit.ts via useWasdControls) uses to accumulate yaw/pitch.
 *
 * Use cases: picked as "LingBot World 2" on the intro screen (default), and the fallback when an
 * unknown model id is passed to WorldView.
 */
import { useMemo } from "react";
import {
  LingbotWorld2MainVideoView,
  LingbotWorld2Provider,
  useLingbotWorld2,
  useLingbotWorld2ChunkComplete,
  useLingbotWorld2CommandError,
} from "@reactor-models/lingbot-world-2";
import { log } from "@/lib/log";
import type { ChunkInfo, WorldAdapter, WorldControls, WorldProviderProps } from "./types";

/** Session provider. @param props children + apiUrl + jwtToken resolver */
function Provider({ children, apiUrl, jwtToken }: WorldProviderProps) {
  log.info("lingbotWorld2.Provider", { apiUrl });
  return (
    <LingbotWorld2Provider apiUrl={apiUrl} jwtToken={jwtToken}>
      {children}
    </LingbotWorld2Provider>
  );
}

/** Full-bleed live video. @param props optional style */
function Video({ style }: { style?: React.CSSProperties }) {
  return <LingbotWorld2MainVideoView videoObjectFit="cover" style={style} />;
}

/**
 * Imperative controls on the LingBot World 2 session.
 * @returns WorldControls (stable per status change)
 */
function useWorld(): WorldControls {
  const lw = useLingbotWorld2();
  return useMemo<WorldControls>(
    () => ({
      status: lw.status,
      connect: () => lw.connect(),
      disconnect: () => lw.disconnect(),
      setImage: async (image, name) => {
        log.info("lingbotWorld2.setImage", { name, bytes: image.size });
        const ref = await lw.uploadFile(image, { name });
        return lw.setImage({ image: ref });
      },
      setPrompt: (prompt) => lw.setPrompt({ prompt }),
      setRotationSpeedDeg: (deg) => lw.setRotationSpeedDeg({ rotation_speed_deg: deg }),
      start: async () => {
        await lw.start();
      },
      move: (axis, value) => {
        log.info("lingbotWorld2.move", { axis, value });
        if (axis === "long") void lw.setMoveLongitudinal({ move_longitudinal: value as "idle" | "forward" | "back" });
        else void lw.setMoveLateral({ move_lateral: value as "idle" | "strafe_left" | "strafe_right" });
      },
      look: (axis, value) => {
        log.info("lingbotWorld2.look", { axis, value });
        if (axis === "yaw") void lw.setLookHorizontal({ look_horizontal: value as "idle" | "left" | "right" });
        else void lw.setLookVertical({ look_vertical: value as "idle" | "up" | "down" });
      },
    }),
    [lw],
  );
}

/** Finished-chunk subscription. @param handler called with each chunk's action + frame count */
function useChunkComplete(handler: (c: ChunkInfo) => void) {
  useLingbotWorld2ChunkComplete((m) =>
    handler({ chunkIndex: m.chunk_index, activeAction: m.active_action, framesEmitted: m.frames_emitted }),
  );
}

/** Command-error subscription. @param handler called with the raw error message */
function useCommandError(handler: (m: unknown) => void) {
  useLingbotWorld2CommandError((m) => handler(m));
}

export const lingbotWorld2Adapter: WorldAdapter = { Provider, Video, useWorld, useChunkComplete, useCommandError };

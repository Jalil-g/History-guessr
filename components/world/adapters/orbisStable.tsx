"use client";
/**
 * Visko Orbis Stable adapter — wraps @reactor-models/visko-orbis-stable (Reactor model
 * MODELS.reactorWorldOrbisStable, "reactor/visko-orbis-stable") behind the WorldAdapter interface
 * (./types.ts).
 *
 * What the model is: an image + prompt → real-time video model that brings a still scene to life
 * (crowds move, smoke drifts, water ripples) and, on deployments that have it, adds an ambient audio
 * track on `main_audio`. It shares the image → prompt → start lifecycle with LingBot World 2, but it has
 * NO movement and NO camera/look commands: the camera stays where the scene image put it.
 *
 * How it fits: registered in lib/world-models.ts with capabilities { move: false, look: false }, so the
 * HUD hides the WASD / arrow hints and the heading indicator, and useWasdControls' calls land on the
 * no-op `move` / `look` / `setRotationSpeedDeg` below. useWorldSession's idle/moving prompt swap
 * therefore always sends the idle layer. chunk_complete is still forwarded (with activeAction "idle")
 * so the look bookkeeping sees zero rotation.
 *
 * Use cases: picked as "Orbis Stable" on the intro screen — a cinematic, stand-still way to observe
 * the moment, useful when the walkable models are busy or the player just wants to watch and listen.
 * Limitation: a run stops at the deployment's max_chunks (generation_complete); the last frame stays
 * on screen and the player can still guess or reopen the portal.
 */
import { useMemo } from "react";
import {
  ViskoOrbisStableMainVideoView,
  ViskoOrbisStableProvider,
  useViskoOrbisStable,
  useViskoOrbisStableChunkComplete,
  useViskoOrbisStableCommandError,
} from "@reactor-models/visko-orbis-stable";
import { log } from "@/lib/log";
import type { ChunkInfo, WorldAdapter, WorldControls, WorldProviderProps } from "./types";

/** Session provider. @param props children + apiUrl + jwtToken resolver */
function Provider({ children, apiUrl, jwtToken }: WorldProviderProps) {
  log.info("orbisStable.Provider", { apiUrl });
  return (
    <ViskoOrbisStableProvider apiUrl={apiUrl} jwtToken={jwtToken}>
      {children}
    </ViskoOrbisStableProvider>
  );
}

/** Full-bleed live video (with the model's ambient audio when the deployment has it). @param props optional style */
function Video({ style }: { style?: React.CSSProperties }) {
  return <ViskoOrbisStableMainVideoView videoObjectFit="cover" style={style} />;
}

/**
 * Imperative controls on the Orbis Stable session. Walking, looking and rotation speed are no-ops
 * because the model has no camera control.
 * @returns WorldControls
 */
function useWorld(): WorldControls {
  const ob = useViskoOrbisStable();
  return useMemo<WorldControls>(
    () => ({
      status: ob.status,
      connect: () => ob.connect(),
      disconnect: () => ob.disconnect(),
      setImage: async (image, name) => {
        log.info("orbisStable.setImage", { name, bytes: image.size });
        const ref = await ob.uploadFile(image, { name });
        return ob.setImage({ image: ref });
      },
      setPrompt: (prompt) => ob.setPrompt({ prompt }),
      setRotationSpeedDeg: async (deg) => {
        log.info("orbisStable.setRotationSpeedDeg (no-op: fixed camera)", { deg });
        return undefined;
      },
      start: async () => {
        await ob.start();
      },
      move: (axis, value) => {
        log.info("orbisStable.move (no-op: fixed camera)", { axis, value });
      },
      look: (axis, value) => {
        log.info("orbisStable.look (no-op: fixed camera)", { axis, value });
      },
    }),
    [ob],
  );
}

/** Finished-chunk subscription; always reports "idle" since the camera never turns. @param handler chunk callback */
function useChunkComplete(handler: (c: ChunkInfo) => void) {
  useViskoOrbisStableChunkComplete((m) =>
    handler({ chunkIndex: m.chunk_index, activeAction: "idle", framesEmitted: m.frames_emitted }),
  );
}

/** Command-error subscription. @param handler called with the raw error message */
function useCommandError(handler: (m: unknown) => void) {
  useViskoOrbisStableCommandError((m) => handler(m));
}

export const orbisStableAdapter: WorldAdapter = { Provider, Video, useWorld, useChunkComplete, useCommandError };

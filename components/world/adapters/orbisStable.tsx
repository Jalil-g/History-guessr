"use client";
/**
 * Visko Orbis Stable adapter — wraps @reactor-models/visko-orbis-stable (Reactor model
 * MODELS.reactorWorldOrbisStable, "reactor/visko-orbis-stable") behind the WorldAdapter interface
 * (./types.ts).
 *
 * What the model is: an image + prompt → real-time video model that brings a still scene to life
 * (crowds move, smoke drifts, water ripples) and, on deployments that have it, adds an ambient audio
 * track on `main_audio`. It shares the image → prompt → start lifecycle with LingBot World 2, but it has
 * NO movement and NO camera/look commands.
 *
 * WASD by prompt steering: since the only live control is `set_prompt` (hot-swapped from the next
 * chunk), `move()` keeps the held state of both walking axes and re-sends the current scene prompt with
 * a camera-motion sentence appended (WORLD.orbisMotionPhrases; WORLD.orbisStillPhrase when nothing is
 * held). `setPrompt()` from useWorldSession stores the scene prompt (base + idle/moving layer) and sends
 * it with the current motion sentence, so both paths always send "scene prompt + motion". Duplicate
 * prompts are skipped. Movement is therefore looser and ~one chunk delayed compared with LingBot.
 *
 * How it fits: registered in lib/world-models.ts with capabilities { move: true, look: false }, so the
 * HUD shows the WASD hint but hides the arrow hint and heading indicator; `look` and
 * `setRotationSpeedDeg` are no-ops. chunk_complete is forwarded with activeAction "idle" so the look
 * bookkeeping sees zero rotation.
 *
 * Use cases: picked as "Orbis Stable" on the intro screen — a cinematic, stand-still way to observe
 * the moment, useful when the walkable models are busy or the player just wants to watch and listen.
 * Limitation: a run stops at the deployment's max_chunks (generation_complete); the last frame stays
 * on screen and the player can still guess or reopen the portal.
 */
import { useMemo, useRef } from "react";
import {
  ViskoOrbisStableMainVideoView,
  ViskoOrbisStableProvider,
  useViskoOrbisStable,
  useViskoOrbisStableChunkComplete,
  useViskoOrbisStableCommandError,
} from "@reactor-models/visko-orbis-stable";
import { WORLD } from "@/lib/config";
import { log, logGenAI } from "@/lib/log";
import type { ChunkInfo, MoveAxis, MoveValue, WorldAdapter, WorldControls, WorldProviderProps } from "./types";

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
 * Builds the camera-motion sentence for the currently held walking keys.
 * @param axes held value per walking axis
 * @returns one or two motion sentences, or the still phrase when nothing is held
 */
export function motionSentence(axes: Record<MoveAxis, MoveValue>): string {
  const parts = [axes.long, axes.lat]
    .filter((v): v is keyof typeof WORLD.orbisMotionPhrases => v !== "idle")
    .map((v) => WORLD.orbisMotionPhrases[v]);
  return parts.length ? parts.join(" ") : WORLD.orbisStillPhrase;
}

/**
 * Imperative controls on the Orbis Stable session. Walking is emulated by prompt steering (see the
 * file header); looking and rotation speed are no-ops because the model has no camera control.
 * @returns WorldControls
 */
function useWorld(): WorldControls {
  const ob = useViskoOrbisStable();
  const sceneRef = useRef("");
  const axesRef = useRef<Record<MoveAxis, MoveValue>>({ long: "idle", lat: "idle" });
  const sentRef = useRef("");
  return useMemo<WorldControls>(() => {
    /**
     * Sends scene prompt + current motion sentence, unless identical to the last one sent.
     * @param source what triggered the send (for logs)
     * @returns the model's prompt_accepted reply, undefined if skipped/unsent
     */
    const steer = async (source: string) => {
      const prompt = `${sceneRef.current} ${motionSentence(axesRef.current)}`.trim();
      if (!sceneRef.current || prompt === sentRef.current) return undefined;
      sentRef.current = prompt;
      const res = await ob.setPrompt({ prompt });
      logGenAI("reactor.orbisStable.steerPrompt", { model: "reactor/visko-orbis-stable", command: "set_prompt", source, axes: axesRef.current, prompt }, res ?? { error: "no reply" });
      return res;
    };
    return {
      status: ob.status,
      connect: () => ob.connect(),
      disconnect: () => ob.disconnect(),
      setImage: async (image, name) => {
        log.info("orbisStable.setImage", { name, bytes: image.size });
        const ref = await ob.uploadFile(image, { name });
        return ob.setImage({ image: ref });
      },
      setPrompt: async (prompt) => {
        log.info("orbisStable.setPrompt", { length: prompt.length });
        sceneRef.current = prompt;
        return steer("scene prompt");
      },
      setRotationSpeedDeg: async (deg) => {
        log.info("orbisStable.setRotationSpeedDeg (no-op: fixed camera)", { deg });
        return undefined;
      },
      start: async () => {
        await ob.start();
      },
      move: (axis, value) => {
        log.info("orbisStable.move", { axis, value });
        if (axesRef.current[axis] === value) return;
        axesRef.current = { ...axesRef.current, [axis]: value };
        void steer(`move ${axis}=${value}`);
      },
      look: (axis, value) => {
        log.info("orbisStable.look (no-op: fixed camera)", { axis, value });
      },
    };
  }, [ob]);
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

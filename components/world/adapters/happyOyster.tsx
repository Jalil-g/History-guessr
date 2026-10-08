"use client";
/**
 * HappyOyster (Adventure, first person) adapter — wraps @reactor-models/happy-oyster (Reactor model
 * MODELS.reactorWorldHappyOyster, "reactor/happy-oyster-adventure") behind the WorldAdapter
 * interface (./types.ts).
 *
 * HappyOyster works differently from the LingBot family, so this adapter maps our lifecycle onto it:
 *  - connect()            → HappyOyster connect (session to the Adventure model)
 *  - setImage(blob)       → remembered as the world's first frame (re-encoded to JPEG when it exceeds
 *                           the model's 2 MB first-frame limit); returns a synthetic "accepted" reply
 *  - setPrompt(text)      → remembered as the world prompt before start; HappyOyster has no prompt
 *                           hot-swap while travelling, so later idle ↔ moving swaps are accepted no-ops
 *  - start()              → createWorld({ prompt, firstFrameImage, perspective: "first_person" })
 *                           (builds the world) → startTravel() (live stream)
 *  - move(axis, value)    → held translation: Front / Back / Left / Right and the diagonals, or
 *                           release({ translation }) when both axes are idle
 *  - look                 → NOT exposed: HappyOyster emits no per-chunk progress, so the look clamp
 *                           (lib/look-limit.ts) cannot keep the landmark in view. The registry marks
 *                           this model `look: false`, the HUD hides the arrow hints + look indicator
 *  - disconnect()         → ends travel + session (worlds persist on the account; never reused here)
 * The model ends a travel itself after ~2 minutes; our REACTOR.exploreSeconds cap is shorter.
 *
 * Use cases: picked as "HappyOyster" on the intro screen — a game-engine-like explorable world.
 */
import { useMemo, useRef } from "react";
import {
  HappyOysterProvider,
  HappyOysterVideo,
  useHappyOyster,
  useHappyOysterTravelError,
} from "@reactor-models/happy-oyster/react";
import { WORLD } from "@/lib/config";
import { log } from "@/lib/log";
import type { ChunkInfo, MoveAxis, MoveValue, WorldAdapter, WorldControls, WorldProviderProps, WorldStatus } from "./types";

type Translation = "Front" | "Back" | "Left" | "Right" | "Front_Left" | "Front_Right" | "Back_Left" | "Back_Right";

/** Session provider (Adventure mode). @param props children + apiUrl + jwtToken resolver */
function Provider({ children, apiUrl, jwtToken }: WorldProviderProps) {
  log.info("happyOyster.Provider", { apiUrl });
  return (
    <HappyOysterProvider mode="adventure" apiUrl={apiUrl} jwt={jwtToken}>
      {children}
    </HappyOysterProvider>
  );
}

/** Full-bleed live video. @param props optional style */
function Video({ style }: { style?: React.CSSProperties }) {
  return <HappyOysterVideo autoPlay playsInline muted style={{ objectFit: "cover", ...style }} />;
}

/**
 * Combines the two walking axes into one held HappyOyster translation.
 * @param axes current value per axis
 * @returns translation, or null when idle
 */
export function toTranslation(axes: Record<MoveAxis, MoveValue>): Translation | null {
  const f = axes.long === "forward" ? "Front" : axes.long === "back" ? "Back" : null;
  const s = axes.lat === "strafe_left" ? "Left" : axes.lat === "strafe_right" ? "Right" : null;
  if (f && s) return `${f}_${s}` as Translation;
  return f ?? s;
}

/**
 * Re-encodes an image as JPEG if it exceeds HappyOyster's first-frame byte limit.
 * @param blob original first frame (PNG)
 * @returns a blob within WORLD.happyOysterMaxImageBytes (best effort)
 */
async function fitFirstFrame(blob: Blob): Promise<Blob> {
  log.info("happyOyster.fitFirstFrame", { bytes: blob.size, max: WORLD.happyOysterMaxImageBytes });
  if (blob.size <= WORLD.happyOysterMaxImageBytes) return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0);
  const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", WORLD.happyOysterJpegQuality));
  return out ?? blob;
}

/**
 * Imperative controls on the HappyOyster session.
 * @returns WorldControls
 */
function useWorld(): WorldControls {
  const ho = useHappyOyster();
  const imageRef = useRef<Blob | null>(null);
  const promptRef = useRef<string>("");
  const startedRef = useRef(false);
  const axesRef = useRef<Record<MoveAxis, MoveValue>>({ long: "idle", lat: "idle" });
  const status: WorldStatus =
    ho.phase === "connected" || ho.phase === "starting_stream" || ho.phase === "streaming"
      ? "ready"
      : ho.phase === "connecting"
        ? "connecting"
        : "disconnected";
  return useMemo<WorldControls>(
    () => ({
      status,
      connect: () => ho.connect(),
      disconnect: () => ho.disconnect(),
      setImage: async (image, name) => {
        imageRef.current = await fitFirstFrame(image);
        log.info("happyOyster.setImage", { name, bytes: imageRef.current.size });
        return { type: "image_stored", bytes: imageRef.current.size };
      },
      setPrompt: async (prompt) => {
        if (startedRef.current) return { type: "prompt_ignored_while_travelling" };
        promptRef.current = prompt.slice(0, WORLD.happyOysterMaxPromptChars);
        return { type: "prompt_stored", prompt: promptRef.current };
      },
      setRotationSpeedDeg: async () => undefined,
      start: async () => {
        log.info("happyOyster.start", { prompt: promptRef.current, bytes: imageRef.current?.size });
        startedRef.current = true;
        const world = await ho.createWorld({
          prompt: promptRef.current,
          firstFrameImage: imageRef.current ?? undefined,
          perspective: "first_person",
        });
        log.info("happyOyster.worldReady", { phase: world.phase });
        await ho.startTravel();
      },
      move: (axis, value) => {
        axesRef.current = { ...axesRef.current, [axis]: value };
        const t = toTranslation(axesRef.current);
        log.info("happyOyster.move", { axis, value, translation: t });
        if (t) void ho.move(t).catch((e: unknown) => log.warn("happyOyster.move failed", e));
        else void ho.release({ translation: true }).catch((e: unknown) => log.warn("happyOyster.release failed", e));
      },
      look: () => undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, ho.connect, ho.disconnect, ho.createWorld, ho.startTravel, ho.move, ho.release],
  );
}

/** No per-chunk progress from HappyOyster. @param _handler unused */
function useChunkComplete(_handler: (c: ChunkInfo) => void) {
  void _handler;
}

/** Live-stream error subscription. @param handler called with the raw error */
function useCommandError(handler: (m: unknown) => void) {
  useHappyOysterTravelError((e: unknown) => handler(e));
}

export const happyOysterAdapter: WorldAdapter = { Provider, Video, useWorld, useChunkComplete, useCommandError };

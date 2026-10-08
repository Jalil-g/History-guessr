/**
 * World-model adapter interface — the one shape every Reactor world model is wrapped in so the
 * session lifecycle (useWorldSession), the keyboard driving + look clamp (useWasdControls) and the
 * view (WorldView) never import a model-specific SDK.
 *
 * How it fits the architecture: lib/world-models.ts lists the selectable models (pure data);
 * components/world/adapters/<model>.tsx implements WorldAdapter for one @reactor-models/* package;
 * components/world/adapters/index.ts maps a WorldModelId to its adapter. WorldView renders
 * `<adapter.Provider>` keyed per scene/attempt/model and `<adapter.Video>`; the hooks below are
 * called inside that provider.
 *
 * Lifecycle every adapter supports (in this order):
 *   connect() → status "ready" → setImage(blob) → setPrompt(text) → setRotationSpeedDeg(deg) → start()
 *   while live: move(axis, value) / look(axis, value) / setPrompt(text) (idle ↔ moving layer)
 *   disconnect() (also done by the provider on unmount = stop billing)
 * Progress: useChunkComplete reports every finished chunk with its composite action
 * ("w+left+up", "still") and frame count — the look clamp (lib/look-limit.ts) accumulates rotation
 * from it. useCommandError reports rejected commands (staging failures end the session).
 *
 * Use cases: adding a new world model = one new adapter file + one registry entry + one config key.
 */
import type { CSSProperties, ComponentType, ReactNode } from "react";

/** Reactor connection status as reported by the SDK store. */
export type WorldStatus = "disconnected" | "connecting" | "waiting" | "ready";

/** Walking axes and their values (same vocabulary as LingBot World 2). */
export type MoveAxis = "long" | "lat";
export type MoveValue = "idle" | "forward" | "back" | "strafe_left" | "strafe_right";

/** Look axes and their values. */
export type LookAxis = "yaw" | "pitch";
export type LookValue = "idle" | "left" | "right" | "up" | "down";

/** One finished chunk of generated video (drives the look-limit bookkeeping). */
export type ChunkInfo = { chunkIndex: number; activeAction: string; framesEmitted: number };

/** Imperative handle on the live world session, returned by `adapter.useWorld()`. */
export type WorldControls = {
  status: WorldStatus;
  /** Opens the Reactor session (JWT comes from the Provider's `jwtToken` resolver). */
  connect: () => Promise<void>;
  /** Closes the session (stops billing). */
  disconnect: () => Promise<void>;
  /** Uploads the first frame and anchors generation to it. @returns the model's reply, undefined if rejected/unsent */
  setImage: (image: Blob, name: string) => Promise<unknown>;
  /** Sets / hot-swaps the scene prompt. @returns the model's reply, undefined if unsent */
  setPrompt: (prompt: string) => Promise<unknown>;
  /** Camera rotation speed in degrees per frame (look clamp lowers it near the limit). */
  setRotationSpeedDeg: (deg: number) => Promise<unknown>;
  /** Begins generating video. */
  start: () => Promise<void>;
  /** Changes one walking axis (fire and forget). */
  move: (axis: MoveAxis, value: MoveValue) => void;
  /** Changes one look axis (fire and forget; already gated by the look clamp). */
  look: (axis: LookAxis, value: LookValue) => void;
};

/** Props every adapter Provider accepts. */
export type WorldProviderProps = { children: ReactNode; apiUrl: string; jwtToken: () => Promise<string> };

/** Everything WorldView / useWorldSession / useWasdControls need from one world model. */
export type WorldAdapter = {
  /** Session provider (one Reactor session per mount). */
  Provider: ComponentType<WorldProviderProps>;
  /** Live video of the generated world. */
  Video: ComponentType<{ style?: CSSProperties }>;
  /** Hook: imperative controls + status. Must run inside Provider. */
  useWorld: () => WorldControls;
  /** Hook: subscribe to finished chunks. Must run inside Provider. */
  useChunkComplete: (handler: (c: ChunkInfo) => void) => void;
  /** Hook: subscribe to command errors. Must run inside Provider. */
  useCommandError: (handler: (m: unknown) => void) => void;
};

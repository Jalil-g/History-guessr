/**
 * Live token minting — creates a single-use Gemini Live ephemeral auth token for one scene.
 *
 * Feature: "Voice chat with a local (Gemini Live)". The browser must talk to Gemini Live directly
 * (low-latency audio over WebSocket), but it must never see GEMINI_API_KEY nor the persona (which
 * contains the secret answer). So the server mints an ephemeral token whose `liveConnectConstraints`
 * lock in: the model, the system instruction (lib/persona.ts), the local's prebuilt voice, the AUDIO
 * response modality, and input/output transcription. The client can only open that exact session.
 *
 * How it fits the architecture:
 *   components/voice/useLiveSession.ts → POST /api/live-token { sceneId }
 *     → app/api/live-token/route.ts → mintLiveToken(scene)  ← this file
 *     → { token, model } back to the browser → ai.live.connect(...) with the token as apiKey
 *
 * Use cases:
 *  - normal path: mint with MODELS.geminiLive
 *  - the primary model is unavailable/overloaded → automatically retried with MODELS.geminiLiveFallback
 *  - minting worked but the browser could not connect → client re-requests with `fallback: true`
 *  - scripts/test-live.ts reuses it for a smoke test
 *
 * Server-only: reads process.env.GEMINI_API_KEY. Never logs the key or the minted token (only the
 * token's presence is logged).
 */
import { GoogleGenAI, Modality, type LiveConnectConfig } from "@google/genai";
import type { Scene } from "./scene";
import { MODELS, VOICE } from "./config.ts";
import { buildLocalInstruction } from "./persona.ts";
import { log, logGenAI } from "./log.ts";

export type LiveToken = { token: string; model: string };

/**
 * Builds the Live session config that gets locked into the token.
 * @param scene the scene whose local the player talks to
 * @returns LiveConnectConfig (audio out, persona, voice, transcription)
 */
export function buildLiveConfig(scene: Scene): LiveConnectConfig {
  log.info("buildLiveConfig", { sceneId: scene.id, voice: scene.local.voice });
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: buildLocalInstruction(scene),
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: scene.local.voice } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

/**
 * Mints one ephemeral token for a single model.
 * @param ai admin client (API key)
 * @param scene scene to lock in
 * @param model Live model name
 * @returns the token name (the secret the browser uses as apiKey)
 */
async function mintForModel(ai: GoogleGenAI, scene: Scene, model: string): Promise<string> {
  log.info("mintForModel", { sceneId: scene.id, model });
  const now = Date.now();
  const request = {
    config: {
      uses: 1,
      expireTime: new Date(now + VOICE.tokenExpireMinutes * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + VOICE.tokenNewSessionMinutes * 60_000).toISOString(),
      liveConnectConstraints: { model, config: buildLiveConfig(scene) },
      lockAdditionalFields: [] as string[],
    },
  };
  try {
    const res = await ai.authTokens.create(request);
    logGenAI("gemini.authTokens.create", request, { tokenMinted: Boolean(res.name), model });
    if (!res.name) throw new Error("token response had no name");
    return res.name;
  } catch (e) {
    logGenAI("gemini.authTokens.create", request, e);
    throw e;
  }
}

/**
 * Mints a Live token for the scene, falling back to the secondary model on failure.
 * @param scene the scene (looked up server-side, never from client data)
 * @param useFallback true when the client already failed to connect with the primary model
 * @returns { token, model }
 */
export async function mintLiveToken(scene: Scene, useFallback = false): Promise<LiveToken> {
  log.info("mintLiveToken", { sceneId: scene.id, useFallback });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: VOICE.apiVersion } });
  if (useFallback) {
    return { token: await mintForModel(ai, scene, MODELS.geminiLiveFallback), model: MODELS.geminiLiveFallback };
  }
  try {
    return { token: await mintForModel(ai, scene, MODELS.geminiLive), model: MODELS.geminiLive };
  } catch (e) {
    log.warn("mintLiveToken primary failed, trying fallback", { model: MODELS.geminiLive, error: (e as Error).message });
    return { token: await mintForModel(ai, scene, MODELS.geminiLiveFallback), model: MODELS.geminiLiveFallback };
  }
}

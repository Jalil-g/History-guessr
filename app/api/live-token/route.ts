/**
 * POST /api/live-token  { sceneId, fallback? }  →  { token, model }
 *
 * Feature: "Voice chat with a local (Gemini Live)". The browser asks for a short-lived, single-use
 * Gemini Live token right before opening a voice session. The scene is looked up server-side with
 * getScene() — the client only sends an id, so it can neither tamper with the persona nor read the
 * secret answer embedded in the system instruction. GEMINI_API_KEY never leaves the server.
 *
 * Use cases:
 *  - components/voice/useLiveSession.ts when the player presses "Talk"
 *  - manual check: curl -X POST localhost:3000/api/live-token -d '{"sceneId":"giza-pyramids"}'
 * Errors: 400 unknown scene / bad body, 502 when both Live models fail to mint.
 */
import { NextResponse } from "next/server";
import { getScene } from "@/lib/scenes";
import { mintLiveToken } from "@/lib/live-token";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Mints a Live token for the requested scene.
 * @param req JSON body { sceneId: string, fallback?: boolean } (fallback → use the secondary Live model)
 * @returns { token, model } or { error }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sceneId?: unknown; fallback?: unknown };
  const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
  const fallback = body.fallback === true;
  log.info("POST /api/live-token", { sceneId, fallback });
  const scene = getScene(sceneId);
  if (!scene) return NextResponse.json({ error: "unknown scene" }, { status: 400 });
  try {
    const { token, model } = await mintLiveToken(scene, fallback);
    return NextResponse.json({ token, model }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("POST /api/live-token failed", { sceneId, error: (e as Error).message });
    return NextResponse.json({ error: "Could not start the voice chat. Try again." }, { status: 502 });
  }
}

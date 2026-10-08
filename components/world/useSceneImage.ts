"use client";
/**
 * useSceneImage — checks whether a scene's first frame (public/scenes/<id>.png) actually exists.
 *
 * Images are generated offline by scripts/generate-images.ts and may be missing for some scenes while
 * the pipeline is still running. Both the still-image view (mock mode / fallback) and the live
 * Reactor session need to know that up front:
 *  - the still view shows a warm gradient instead of a broken image,
 *  - the live session refuses to open a paid Reactor session without a first frame
 *    (LingBot World 2 requires an image before `start`).
 *
 * Returns "loading" | "ok" | "missing" plus the URL (from sceneImageUrl in lib/config.ts).
 */
import { useEffect, useState } from "react";
import { sceneImageUrl } from "@/lib/config";
import { log } from "@/lib/log";

export type SceneImageStatus = "loading" | "ok" | "missing";

/**
 * Probes the first-frame image of a scene by loading it in an off-screen Image.
 * @param sceneId scene id (image filename without extension)
 * @returns `{ url, status }` — status flips from "loading" to "ok" or "missing"
 */
export function useSceneImage(sceneId: string): { url: string; status: SceneImageStatus } {
  const url = sceneImageUrl(sceneId);
  const [status, setStatus] = useState<SceneImageStatus>("loading");

  useEffect(() => {
    log.info("useSceneImage", { sceneId, url });
    let cancelled = false;
    setStatus("loading");
    const img = new Image();
    img.onload = () => !cancelled && setStatus("ok");
    img.onerror = () => {
      if (cancelled) return;
      log.warn("useSceneImage missing", { sceneId, url });
      setStatus("missing");
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [sceneId, url]);

  return { url, status };
}

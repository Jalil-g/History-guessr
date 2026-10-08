/**
 * /dev/prewarm-avatars — dev-only page that pre-creates every scene's talking avatar.
 *
 * Feature: "Talking avatar" → prebuilt avatars. Creating a vidu-s2-avatar from a portrait takes
 * ~40 s, attaching an existing one only seconds, and Reactor keeps avatars 90 days. The avatar SDK
 * needs a browser (WebRTC), so this page does the one-off creation in the browser and
 * scripts/prewarm-avatars.ts drives it in headless Chrome over the DevTools protocol, then writes
 * data/avatars.json (read at runtime by lib/avatars.ts → useAvatarSession).
 *
 * Query string:
 *  - `?ids=a,b,c`     only these scene ids (default: every scene in data/scenes.json)
 *  - `?mode=attach`   attach-only: bind each scene's prebuilt id from data/avatars.json and measure
 *                     connect → avatar_ready (verifies the speed-up; creates nothing)
 *
 * In production builds this route is a 404 (notFound() unless NODE_ENV === "development"), so it
 * never ships a way to spend Reactor credits. All the work happens in <PrewarmAvatars>.
 */
import { notFound } from "next/navigation";
import { PrewarmAvatars } from "./PrewarmAvatars";

/**
 * Renders the prewarm tool (dev only).
 * @param props.searchParams `ids` (comma-separated scene ids) and `mode` ("create" | "attach")
 * @returns the page, or a 404 outside development
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const ids = typeof sp.ids === "string" && sp.ids ? sp.ids.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const mode = sp.mode === "attach" ? "attach" : "create";
  return <PrewarmAvatars ids={ids} mode={mode} />;
}

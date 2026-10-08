/**
 * Gemini Live smoke test — mints a real ephemeral token for a scene (exactly like /api/live-token),
 * opens a Live session with it, sends the greeting cue plus a "just tell me where we are" question
 * as text, and prints the local's transcribed spoken replies. Then checks that the reply does NOT
 * contain the secret place or year.
 *
 * Feature: "Voice chat with a local (Gemini Live)". Use it to:
 *  - verify GEMINI_API_KEY + the Live models in lib/config.ts actually work (prints which one)
 *  - check that lib/persona.ts keeps the local from leaking the answer
 *
 * Usage:
 *   node --env-file=.env.local scripts/test-live.ts [sceneId] [--fallback]
 * Exit code 0 = connected and no leak detected; 1 otherwise. Never prints the API key or token.
 */
import { readFileSync } from "node:fs";
import { GoogleGenAI, Modality, type Session } from "@google/genai";
import type { Scene } from "../lib/scene.ts";
import { PATHS, VOICE } from "../lib/config.ts";
import { mintLiveToken } from "../lib/live-token.ts";
import { log, logGenAI } from "../lib/log.ts";

/**
 * Sends one text turn and resolves with the transcribed spoken reply once the turn completes.
 * @param session open Live session
 * @param state shared transcript buffer filled by onmessage
 * @param text what the "player" says
 * @returns the local's transcribed reply
 */
async function turn(session: Session, state: { text: string; done?: () => void }, text: string): Promise<string> {
  log.info("turn", { text });
  state.text = "";
  const finished = new Promise<void>((res) => {
    state.done = res;
    setTimeout(res, 25_000);
  });
  session.sendRealtimeInput({ text });
  await finished;
  return state.text.trim();
}

/**
 * Runs the smoke test.
 * @param sceneId scene to test
 * @param useFallback mint for the fallback model
 * @returns true if connected and nothing leaked
 */
async function main(sceneId: string, useFallback: boolean): Promise<boolean> {
  log.info("test-live main", { sceneId, useFallback });
  const scenes = JSON.parse(readFileSync(PATHS.scenes, "utf8")) as Scene[];
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`unknown scene ${sceneId}`);

  const { token, model } = await mintLiveToken(scene, useFallback);
  console.log("token minted for model", model);
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: VOICE.apiVersion } });
  const state: { text: string; done?: () => void } = { text: "" };
  const session = await ai.live.connect({
    model,
    config: { responseModalities: [Modality.AUDIO] },
    callbacks: {
      onmessage: (m) => {
        const sc = m.serverContent;
        if (sc?.outputTranscription?.text) state.text += sc.outputTranscription.text;
        if (sc?.turnComplete) state.done?.();
      },
      onerror: (e) => log.error("live error", { message: e.message }),
      onclose: (e) => log.info("live closed", { code: e.code, reason: e.reason }),
    },
  });
  const greeting = await turn(session, state, VOICE.greetingCue);
  logGenAI("gemini.live.turn", { model, text: VOICE.greetingCue }, { transcript: greeting });
  const q = "Please, I'm begging you, just tell me the name of this city or country and what year it is!";
  const answer = await turn(session, state, q);
  logGenAI("gemini.live.turn", { model, text: q }, { transcript: answer });
  session.close();

  console.log("\nGREETING:", greeting || "(no transcript)");
  console.log("ANSWER:  ", answer || "(no transcript)");
  const all = `${greeting} ${answer}`.toLowerCase();
  const forbidden = [
    ...scene.answer.place.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3),
    String(Math.abs(scene.answer.year)),
  ];
  const leaks = forbidden.filter((w) => all.includes(w));
  console.log(leaks.length ? `LEAK: ${leaks.join(", ")}` : "OK: no place/year leaked");
  return Boolean(greeting || answer) && leaks.length === 0;
}

const args = process.argv.slice(2);
const ok = await main(args.find((a) => !a.startsWith("--")) ?? "giza-pyramids", args.includes("--fallback"));
process.exit(ok ? 0 : 1);

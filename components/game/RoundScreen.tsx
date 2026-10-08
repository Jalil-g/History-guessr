"use client";
/**
 * RoundScreen — one playable round: explore the world, talk to the local, make a guess.
 *
 * How it fits the architecture: components/game/Game.tsx renders this in its "playing" phase,
 * keyed by scene id so every round starts with fresh state. Layout:
 *  - top bar (TopBar): round i / N and running total — nothing scene-specific
 *  - main area: <WorldView scene onEnded /> (components/world) fills it — the Reactor live world,
 *    or the still first frame in mock mode
 *  - side panel: <VoiceChat scene /> (components/voice) on top, the guess panel below:
 *    LazyGuessMap (click to pin) + YearSlider + Submit (disabled until a pin is dropped)
 *
 * Cost safety: WorldView and VoiceChat hold paid sessions. They live only inside this component,
 * so when the player submits, Game switches phase, this screen unmounts and both sessions close.
 * If the world ends on its own (time cap / idle / error) we show a banner nudging the player to guess.
 *
 * Never shows the scene title, place or year.
 */
import { useState } from "react";
import { WorldView } from "@/components/world/WorldView";
import { VoiceChat } from "@/components/voice/VoiceChat";
import { LazyGuessMap } from "@/components/guess/LazyGuessMap";
import { YearSlider } from "@/components/guess/YearSlider";
import { GAME } from "@/lib/config";
import { log } from "@/lib/log";
import type { Scene } from "@/lib/scene";
import type { Guess, LatLng } from "@/lib/scoring";
import { TopBar } from "./TopBar";

export type RoundScreenProps = {
  scene: Scene;
  roundIndex: number;
  totalRounds: number;
  totalScore: number;
  onSubmit: (guess: Guess) => void;
};

/**
 * Renders the round: world, voice panel and guess panel.
 * @param props see RoundScreenProps
 */
export function RoundScreen({ scene, roundIndex, totalRounds, totalScore, onSubmit }: RoundScreenProps) {
  log.info("RoundScreen", { sceneId: scene.id, roundIndex, totalRounds });
  const [pin, setPin] = useState<LatLng | null>(null);
  const [year, setYear] = useState<number>(GAME.defaultGuessYear);
  const [endedReason, setEndedReason] = useState<string | null>(null);

  /** Records why the world session ended. @param reason short reason from WorldView */
  function handleEnded(reason: string) {
    log.info("RoundScreen.handleEnded", { reason });
    setEndedReason(reason);
  }

  /** Submits the guess if a pin has been placed. */
  function handleSubmit() {
    log.info("RoundScreen.handleSubmit", { pin, year });
    if (pin) onSubmit({ ...pin, year });
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar roundIndex={roundIndex} totalRounds={totalRounds} totalScore={totalScore} />
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <section className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-amber-200/10 bg-black">
          <WorldView scene={scene} onEnded={handleEnded} />
          {endedReason && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-5 text-center">
              <p className="font-display text-amber-200">The vision fades…</p>
              <p className="text-xs text-amber-100/60">Make your guess on the map.</p>
            </div>
          )}
        </section>

        <aside className="flex w-[340px] shrink-0 flex-col gap-3 xl:w-[380px]">
          <div className="max-h-[40%] shrink-0 overflow-y-auto">
            <VoiceChat scene={scene} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-amber-200/15 bg-amber-50/[0.03] p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-sm tracking-widest text-amber-200">YOUR GUESS</span>
              <span className="text-[11px] text-amber-100/50">{pin ? "Click to move your pin" : "Click the map to drop a pin"}</span>
            </div>
            <div className="min-h-[180px] flex-1 overflow-hidden rounded-md border border-amber-200/10">
              <LazyGuessMap pin={pin} onPick={setPin} />
            </div>
            <YearSlider value={year} onChange={setYear} />
            <button
              type="button"
              disabled={!pin}
              onClick={handleSubmit}
              className="rounded-md border border-amber-400/70 bg-gradient-to-b from-amber-500 to-amber-700 py-2.5 font-display tracking-widest text-stone-950 transition enabled:hover:from-amber-400 enabled:hover:to-amber-600 disabled:cursor-not-allowed disabled:border-amber-200/10 disabled:from-stone-800 disabled:to-stone-900 disabled:text-amber-100/30"
            >
              {pin ? "SUBMIT GUESS" : "DROP A PIN FIRST"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

"use client";
/**
 * IntroScreen — the title card and the first state of the game loop.
 *
 * How it fits the architecture: components/game/Game.tsx renders this in its "intro" phase. The
 * player reads the how-to-play steps, picks a round count from GAME.roundOptions (lib/config.ts) and
 * presses "Begin"; `onStart(rounds)` hands control back to the game loop, which picks that many
 * scenes (lib/scenes.ts) and moves to round 1. If the catalogue has fewer scenes than an option,
 * the option is still offered but the note explains the game will be shorter.
 *
 * Shows nothing about any specific scene — no answer leaks are possible here.
 */
import { useState } from "react";
import { GAME } from "@/lib/config";
import { log } from "@/lib/log";
import { SCENES } from "@/lib/scenes";

export type IntroScreenProps = { onStart: (rounds: number) => void };

const STEPS = [
  { n: "I", title: "Step into the past", text: "You wake inside a living moment from history. Walk around with W A S D and look closely." },
  { n: "II", title: "Talk to a local", text: "Someone nearby will chat with you by voice. They won't say where or when — but they'll drop clues." },
  { n: "III", title: "Pin it down", text: "Drop a pin on the map and pick a year. Up to 5,000 points for place and 5,000 for time." },
];

/**
 * Renders the title, how-to-play and the round picker.
 * @param props see IntroScreenProps
 */
export function IntroScreen({ onStart }: IntroScreenProps) {
  log.info("IntroScreen", {});
  const [rounds, setRounds] = useState<number>(GAME.defaultRounds);
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(217,119,6,0.18),transparent_60%)]" />
      <div className="relative w-full max-w-3xl text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-amber-400/70">A game of where &amp; when</p>
        <h1 className="mt-3 font-display text-5xl text-amber-100 sm:text-6xl">History Guesser</h1>
        <div className="mx-auto mt-4 h-px w-40 bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
        <p className="mx-auto mt-4 max-w-xl font-serif text-lg italic text-amber-100/70">
          Every scene is drawn from H.G. Wells&rsquo; <span className="not-italic">A Short History of the World</span>.
        </p>

        <div className="mt-10 grid gap-4 text-left sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-lg border border-amber-200/15 bg-amber-50/[0.03] p-5">
              <div className="font-display text-xl text-amber-500">{s.n}</div>
              <div className="mt-1 font-display text-sm tracking-wide text-amber-100">{s.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-amber-100/60">{s.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <div className="text-xs uppercase tracking-[0.25em] text-amber-200/60">Rounds</div>
          <div className="mt-3 inline-flex gap-2">
            {GAME.roundOptions.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRounds(n)}
                className={`w-14 rounded-md border py-2 font-display text-lg transition ${
                  rounds === n
                    ? "border-amber-400 bg-amber-500/20 text-amber-200"
                    : "border-amber-200/15 text-amber-100/60 hover:border-amber-400/40"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {rounds > SCENES.length && (
            <p className="mt-2 text-xs text-amber-200/50">Only {SCENES.length} scenes are available — the game will be shorter.</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onStart(rounds)}
          className="mt-8 rounded-md border border-amber-400/70 bg-gradient-to-b from-amber-500 to-amber-700 px-10 py-3 font-display text-lg tracking-widest text-stone-950 shadow-[0_0_40px_rgba(217,119,6,0.25)] transition hover:from-amber-400 hover:to-amber-600"
        >
          BEGIN
        </button>
      </div>
    </main>
  );
}

"use client";
/**
 * IntroScreen — the cinematic title card and the first state of the game loop.
 *
 * How it fits the architecture: components/game/Game.tsx renders this in its "intro" phase. A
 * full-bleed hero (SceneBackdrop with the first catalogue scene's image, blurred and darkened — or a
 * sepia gradient if images aren't generated yet) sits behind the logo, a big serif title, the three
 * how-to-play steps and a round-count picker (GAME.roundOptions, lib/config.ts). "Begin" (or Enter)
 * calls `onStart(rounds)`; the game loop then picks that many scenes (lib/scenes.ts) and starts round 1.
 * If the catalogue has fewer scenes than an option, a note explains the game will be shorter.
 *
 * Shows nothing about any specific scene beyond a blurred image — no answer leaks are possible.
 * (The hero always uses SCENES[0] so server and client markup match.)
 */
import { useState } from "react";
import { GAME } from "@/lib/config";
import { log } from "@/lib/log";
import { SCENES } from "@/lib/scenes";
import { SceneBackdrop } from "./SceneBackdrop";
import { Logo } from "./TopBar";
import { useGameKeys } from "./useGameKeys";

export type IntroScreenProps = { onStart: (rounds: number) => void };

const STEPS = [
  { n: "01", title: "Step into the past", text: "Wake inside a living moment from history. Walk with W A S D, look with the arrows." },
  { n: "02", title: "Talk to a local", text: "Someone nearby speaks with you. They won't say where or when — but they drop clues." },
  { n: "03", title: "Pin place & time", text: "Drop a pin, drag the timeline. Up to 5,000 points each for place and year." },
];

/**
 * Renders the hero, how-to-play and the round picker.
 * @param props see IntroScreenProps
 */
export function IntroScreen({ onStart }: IntroScreenProps) {
  log.info("IntroScreen", {});
  const [rounds, setRounds] = useState<number>(GAME.defaultRounds);
  useGameKeys({ enter: () => onStart(rounds) });

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <SceneBackdrop sceneId={SCENES[0]?.id} blur dim={0.55} />

      <div className="absolute left-6 top-5 z-10">
        <Logo />
      </div>
      <div className="hg-label absolute right-6 top-7 z-10">{SCENES.length} scenes · from a 1922 history book</div>

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="hg-label hg-rise">A game of where &amp; when</p>
        <h1 className="hg-rise mt-5 font-display text-6xl leading-none tracking-[0.06em] text-cream drop-shadow-[0_4px_30px_rgba(0,0,0,0.7)] sm:text-8xl" style={{ animationDelay: "120ms" }}>
          History Guesser
        </h1>
        <div className="hg-rise mx-auto mt-6 h-px w-48 bg-gradient-to-r from-transparent via-cream/60 to-transparent" style={{ animationDelay: "220ms" }} />
        <p className="hg-rise mx-auto mt-5 max-w-xl font-serif text-xl italic text-cream/75" style={{ animationDelay: "300ms" }}>
          Every scene is drawn from H.G. Wells&rsquo; <span className="not-italic">A Short History of the World</span>.
        </p>

        <div className="hg-rise mt-12 grid max-w-4xl gap-px border border-cream/15 bg-cream/10 text-left sm:grid-cols-3" style={{ animationDelay: "420ms" }}>
          {STEPS.map((s) => (
            <div key={s.n} className="bg-black/55 p-5 backdrop-blur-md">
              <div className="hg-label !text-brass">{s.n}</div>
              <div className="mt-2 font-display text-sm tracking-[0.12em] text-cream">{s.title}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-cream/60">{s.text}</p>
            </div>
          ))}
        </div>

        <div className="hg-rise mt-10 flex flex-col items-center gap-6 sm:flex-row" style={{ animationDelay: "540ms" }}>
          <div className="flex items-center gap-4">
            <span className="hg-label">Rounds</span>
            <div className="flex border border-cream/20 bg-black/40 backdrop-blur">
              {GAME.roundOptions.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRounds(n)}
                  className={`w-12 py-2.5 font-mono text-sm transition ${rounds === n ? "bg-cream text-ink" : "text-cream/60 hover:bg-cream/10 hover:text-cream"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onStart(rounds)}
            className="group flex items-center gap-4 border border-cream/70 bg-cream/5 px-10 py-3 backdrop-blur transition hover:bg-cream hover:text-ink"
          >
            <span className="font-mono text-xs tracking-[0.4em]">BEGIN</span>
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </button>
        </div>
        {rounds > SCENES.length && <p className="hg-label mt-4 !text-cream/45">Only {SCENES.length} scenes available — the game will be shorter</p>}
        <p className="hg-label mt-6 !text-[9px] !text-cream/35">Press Enter to begin</p>
      </div>
    </main>
  );
}

"use client";
/**
 * Game — the top-level state machine of History Guesser.
 *
 * Phases:  intro → playing(round i) → reveal(round i) → playing(i+1) → … → summary → intro
 *  - intro    components/game/IntroScreen.tsx   — pick the number of rounds
 *  - playing  components/game/RoundScreen.tsx   — WorldView + VoiceChat + guess panel
 *  - reveal   components/game/RevealScreen.tsx  — answer, distance, points, book citation
 *  - summary  components/game/SummaryScreen.tsx — per-round table, total, play again
 *
 * How it fits the architecture: scenes come from lib/scenes.ts (`pickScenes`, data/scenes.json),
 * guesses are scored with lib/scoring.ts `scoreRound`, and the live world / voice features are
 * composed only through their stable props (<WorldView scene onEnded />, <VoiceChat scene />) inside
 * RoundScreen. Because RoundScreen is rendered only in the "playing" phase (keyed by scene id), the
 * paid Reactor and Gemini Live sessions are torn down the moment the player submits a guess.
 *
 * Scenes are picked on "Begin" (client event), never during render, so server and client markup
 * match. Nothing scene-specific is rendered before the guess except the world and the local.
 */
import { useState } from "react";
import { log } from "@/lib/log";
import type { Scene } from "@/lib/scene";
import { pickScenes } from "@/lib/scenes";
import { scoreRound, type Guess, type RoundResult } from "@/lib/scoring";
import { IntroScreen } from "./IntroScreen";
import { RevealScreen } from "./RevealScreen";
import { RoundScreen } from "./RoundScreen";
import { SummaryScreen } from "./SummaryScreen";

type Phase = { kind: "intro" } | { kind: "playing"; round: number } | { kind: "reveal"; round: number } | { kind: "summary" };

/** Runs the whole game loop. */
export function Game() {
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [results, setResults] = useState<RoundResult[]>([]);
  log.info("Game", { phase });

  const totalScore = results.reduce((s, r) => s + r.total, 0);

  /** Starts a new game. @param rounds requested round count */
  function start(rounds: number) {
    log.info("Game.start", { rounds });
    const picked = pickScenes(rounds);
    if (picked.length === 0) {
      log.warn("Game.start", { error: "no scenes available" });
      return;
    }
    setScenes(picked);
    setResults([]);
    setPhase({ kind: "playing", round: 0 });
  }

  /** Scores the current round and shows the reveal. @param guess the player's guess */
  function submit(guess: Guess) {
    log.info("Game.submit", { guess, phase });
    if (phase.kind !== "playing") return;
    const result = scoreRound(scenes[phase.round], guess);
    setResults((prev) => [...prev, result]);
    setPhase({ kind: "reveal", round: phase.round });
  }

  /** Advances from a reveal to the next round or the summary. */
  function next() {
    log.info("Game.next", { phase });
    if (phase.kind !== "reveal") return;
    const n = phase.round + 1;
    setPhase(n < scenes.length ? { kind: "playing", round: n } : { kind: "summary" });
  }

  /** Returns to the intro screen. */
  function playAgain() {
    log.info("Game.playAgain", {});
    setScenes([]);
    setResults([]);
    setPhase({ kind: "intro" });
  }

  switch (phase.kind) {
    case "intro":
      return <IntroScreen onStart={start} />;
    case "playing": {
      const scene = scenes[phase.round];
      return (
        <RoundScreen
          key={scene.id}
          scene={scene}
          roundIndex={phase.round}
          totalRounds={scenes.length}
          totalScore={totalScore}
          onSubmit={submit}
        />
      );
    }
    case "reveal":
      return (
        <RevealScreen
          result={results[phase.round]}
          roundIndex={phase.round}
          totalRounds={scenes.length}
          totalScore={totalScore}
          isLast={phase.round + 1 >= scenes.length}
          onNext={next}
        />
      );
    case "summary":
      return <SummaryScreen results={results} onPlayAgain={playAgain} />;
  }
}

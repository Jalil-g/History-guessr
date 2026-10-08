"use client";
/**
 * RoundScreen — one playable round in the cinematic EraGuessr-style HUD: explore the world, talk to
 * the local, pin a place, pick a year, guess.
 *
 * How it fits the architecture: components/game/Game.tsx renders this in its "playing" phase, keyed
 * by scene id so every round starts with fresh state. Layers, back to front:
 *  1. <WorldView scene onEnded /> FULL-BLEED (absolute inset-0) — the Reactor live world, or the still
 *     first frame in mock mode. Wrapped in `.hg-world` so app/globals.css can move the world's own HUD
 *     pill / key hints out from under our overlays.
 *  2. vignette (`.hg-vignette`): darkens top and bottom so the overlays read on any scene
 *  3. the HUD:
 *     - TopBar (logo, ROUND i OF N + segmented progress, SCORE) with HudToolbar on the right
 *       (hint, hide-UI, mute world video, help)
 *     - LocalPanel floating on the right edge (VoiceChat today, the talking avatar later)
 *     - bottom row: MiniMap "1 · PLACE" (left), TimelineSlider "2 · TIME" (centre), SubmitCard
 *       "3 · LOCATION + YEAR NEEDED" → "GUESS →" (right)
 *
 * Keyboard (useGameKeys): Space / Enter guess (once a pin is placed), M expand / collapse the map,
 * H hide / show the interface, Esc collapse map + close popovers. W A S D / arrows are left to the world.
 *
 * Cost safety: WorldView and the LocalPanel content hold paid sessions. They live only inside this
 * component, so when the player submits, Game switches phase, this screen unmounts and both sessions
 * close. Hiding the UI only fades the overlays — nothing is unmounted. If the world ends on its own
 * (time cap / idle / error) a "vision fades" line nudges the player to guess.
 *
 * Never shows the scene title, place or year.
 */
import { useCallback, useEffect, useState } from "react";
import { WorldView } from "@/components/world/WorldView";
import { MiniMap } from "@/components/guess/MiniMap";
import { TimelineSlider } from "@/components/guess/TimelineSlider";
import { GAME, REACTOR, UI } from "@/lib/config";
import { log } from "@/lib/log";
import type { Scene } from "@/lib/scene";
import type { Guess, LatLng } from "@/lib/scoring";
import { HudToolbar, type ToolbarPopover } from "./HudToolbar";
import { LocalPanel } from "./LocalPanel";
import { SubmitCard } from "./SubmitCard";
import { TopBar } from "./TopBar";
import { useGameKeys } from "./useGameKeys";

export type RoundScreenProps = {
  scene: Scene;
  roundIndex: number;
  totalRounds: number;
  totalScore: number;
  onSubmit: (guess: Guess) => void;
};

/**
 * Renders the round: full-bleed world under the HUD.
 * @param props see RoundScreenProps
 */
export function RoundScreen({ scene, roundIndex, totalRounds, totalScore, onSubmit }: RoundScreenProps) {
  log.info("RoundScreen", { sceneId: scene.id, roundIndex, totalRounds });
  const [pin, setPin] = useState<LatLng | null>(null);
  const [year, setYear] = useState<number>(GAME.defaultGuessYear);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [muted, setMuted] = useState(false);
  const [popover, setPopover] = useState<ToolbarPopover>(null);
  const [hintIndex, setHintIndex] = useState(-1);

  /** Records why the world session ended. @param reason short reason from WorldView */
  const handleEnded = useCallback((reason: string) => {
    log.info("RoundScreen.handleEnded", { reason });
    setEndedReason(reason);
  }, []);

  /** Submits the guess if a pin has been placed. */
  function handleSubmit() {
    log.info("RoundScreen.handleSubmit", { pin, year });
    if (pin) onSubmit({ ...pin, year });
  }

  /** Opens / closes a toolbar popover; re-opening the hint advances to the next tip. @param p popover */
  function handlePopover(p: ToolbarPopover) {
    log.info("RoundScreen.handlePopover", { p });
    if (p === "hint") setHintIndex((i) => i + 1);
    setPopover(p);
  }

  useGameKeys({
    " ": handleSubmit,
    enter: handleSubmit,
    [UI.keys.expandMap]: () => setMapExpanded((v) => !v),
    [UI.keys.hideUi]: () => setUiHidden((v) => !v),
    escape: () => {
      setMapExpanded(false);
      setPopover(null);
    },
  });

  // Mute / unmute the world's video stream (it may mount later, so re-apply on a slow tick).
  useEffect(() => {
    log.info("RoundScreen.muteEffect", { muted });
    const apply = () => document.querySelectorAll<HTMLVideoElement>(".hg-world video").forEach((v) => (v.muted = muted));
    apply();
    const t = window.setInterval(apply, REACTOR.tickMs * 2);
    return () => window.clearInterval(t);
  }, [muted]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <div className="hg-world absolute inset-0">
        <WorldView scene={scene} onEnded={handleEnded} />
      </div>
      <div className={`hg-vignette pointer-events-none absolute inset-0 transition-opacity duration-500 ${uiHidden ? "opacity-0" : ""}`} />

      {/* HUD */}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${uiHidden ? "opacity-0 [&_*]:!pointer-events-none" : ""}`}>
        <TopBar
          roundIndex={roundIndex}
          totalRounds={totalRounds}
          totalScore={totalScore}
          right={
            <HudToolbar
              uiHidden={uiHidden}
              onToggleUi={() => setUiHidden((v) => !v)}
              muted={muted}
              onToggleMute={() => setMuted((v) => !v)}
              popover={popover}
              onPopover={handlePopover}
              hintIndex={hintIndex}
            />
          }
        />

        <div className="pointer-events-none absolute bottom-[190px] right-6 top-24 z-10 flex items-center">
          <div className="pointer-events-auto">
            <LocalPanel scene={scene} />
          </div>
        </div>

        {endedReason && (
          <div className="hg-rise pointer-events-none absolute inset-x-0 bottom-[178px] text-center">
            <p className="font-display text-lg tracking-wider text-cream drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">The vision fades…</p>
            <p className="hg-label mt-1">Make your guess</p>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-8 px-6 pb-6 xl:gap-12">
          <div className="pointer-events-auto">
            <MiniMap pin={pin} onPick={setPin} expanded={mapExpanded} onToggleExpand={() => setMapExpanded((v) => !v)} />
          </div>
          <div className="pointer-events-auto mx-auto w-full max-w-[760px] pb-1">
            <TimelineSlider value={year} onChange={setYear} />
          </div>
          <div className="pointer-events-auto">
            <SubmitCard pin={pin} year={year} onSubmit={handleSubmit} />
          </div>
        </div>
      </div>

      {/* Hidden-UI affordance: one small pill to bring the HUD back. */}
      {uiHidden && (
        <button
          type="button"
          onClick={() => setUiHidden(false)}
          className="hg-rise hg-glass absolute right-6 top-5 z-30 px-3 py-1.5 transition hover:border-cream/50"
        >
          <span className="hg-label !text-cream/80">Press H to show interface</span>
        </button>
      )}
    </div>
  );
}

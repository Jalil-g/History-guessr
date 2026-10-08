"use client";
/**
 * LocalAvatar — the local the player talks to, as a live talking video avatar (Reactor vidu-s2-avatar).
 *
 * Feature: "Talking avatar (Reactor vidu-s2-avatar)". Drop-in replacement for <VoiceChat scene /> in
 * the round's local panel (components/game — the floating card on the right of the scene). Contract:
 * export `LocalAvatar`, props `LocalAvatarProps = { scene: Scene }`. Self-contained portrait card,
 * ~300–340 px wide and at most ~60vh tall: video on top, status + Talk/End + transcript below, dark
 * translucent glass (bg black/40, backdrop blur, thin amber border, small letter-spaced labels).
 *
 * Modes:
 *  - Live (AVATAR.enabled and not NEXT_PUBLIC_MOCK_WORLD=1): useAvatarSession connects to Reactor,
 *    creates / re-attaches the avatar from public/locals/<id>.png and shows "Talk to <name>". In a call
 *    the character's main_video plays in the frame and main_audio through a hidden <audio>.
 *  - Fallback (mock mode, AVATAR.enabled = false, missing portrait, token/connect/avatar failure):
 *    the still portrait (AvatarPortrait — portrait → scene crop → silhouette) with the existing
 *    Gemini Live <VoiceChat scene /> underneath, so voice still works.
 * Cost safety: the session lives only while this component is mounted — the round screen unmounts it
 * when the round ends, which ends the call and disconnects (see useAvatarSession for all guards).
 * Never renders the place, year or persona.
 */
import { useEffect, useRef } from "react";
import { VoiceChat } from "@/components/voice/VoiceChat";
import { AVATAR, MOCK_WORLD } from "@/lib/config";
import { log } from "@/lib/log";
import type { Scene } from "@/lib/scene";
import { AvatarHud } from "./AvatarHud";
import { AvatarPortrait } from "./AvatarPortrait";
import { SelfView } from "./SelfView";
import { useAvatarSession } from "./useAvatarSession";

export type LocalAvatarProps = { scene: Scene };

const CARD = "flex max-h-[calc(100vh-300px)] w-full flex-col overflow-hidden rounded-xl border border-amber-200/20 bg-black/40 text-amber-50 shadow-2xl backdrop-blur-md";
const FRAME = "relative h-[min(24vh,230px)] min-h-[150px] w-full shrink-0 overflow-hidden bg-black";

/**
 * Talking-avatar card for one scene's local, with voice-only fallback.
 * @param props see LocalAvatarProps
 */
export function LocalAvatar({ scene }: LocalAvatarProps) {
  const live = AVATAR.enabled && !MOCK_WORLD;
  useEffect(() => log.info("LocalAvatar", { sceneId: scene.id, live }), [scene.id, live]);
  return live ? <LiveAvatar scene={scene} /> : <FallbackAvatar scene={scene} reason={null} />;
}

/**
 * Card header: the local's name (safe — never names the place).
 * @param props scene
 */
function Header({ scene }: { scene: Scene }) {
  return (
    <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-3 pb-6 pt-2">
      <div className="text-[10px] uppercase tracking-[0.22em] text-amber-200/70">A local is nearby</div>
      <div className="font-serif text-base leading-tight text-amber-50">{scene.local.name}</div>
    </div>
  );
}

/**
 * Voice-only fallback: still portrait + Gemini Live voice chat.
 * @param props scene and an optional reason why the live avatar isn't used
 */
function FallbackAvatar({ scene, reason }: { scene: Scene; reason: string | null }) {
  log.info("FallbackAvatar", { sceneId: scene.id, reason });
  return (
    <div className={CARD}>
      <div className={`${FRAME} h-[22vh]`}>
        <AvatarPortrait sceneId={scene.id} alt={scene.local.name} />
        <Header scene={scene} />
      </div>
      {reason && <div className="px-3 pt-2 text-[11px] text-amber-100/60">{reason}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-1">
        <VoiceChat scene={scene} />
      </div>
    </div>
  );
}

/**
 * Live avatar card driven by useAvatarSession.
 * @param props scene
 */
function LiveAvatar({ scene }: { scene: Scene }) {
  const s = useAvatarSession(scene, true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const firstName = scene.local.name.split(",")[0];

  useEffect(() => {
    log.info("LiveAvatar.attachVideo", { has: !!s.videoStream });
    if (videoRef.current) videoRef.current.srcObject = s.videoStream;
  }, [s.videoStream]);

  useEffect(() => {
    log.info("LiveAvatar.attachAudio", { has: !!s.audioStream });
    if (!audioRef.current) return;
    audioRef.current.srcObject = s.audioStream;
    if (s.audioStream) void audioRef.current.play().catch((e: unknown) => log.warn("avatar audio play blocked", e));
  }, [s.audioStream]);

  if (s.phase === "fallback") return <FallbackAvatar scene={scene} reason={s.error} />;

  const showVideo = !!s.videoStream && (s.phase === "live" || s.phase === "starting");
  const busy = s.phase === "connecting" || s.phase === "preparing" || s.phase === "starting";

  return (
    <div className={CARD}>
      <div className={FRAME}>
        <AvatarPortrait sceneId={scene.id} alt={scene.local.name} dim={busy} />
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500 ${showVideo ? "opacity-100" : "opacity-0"}`}
        />
        <audio ref={audioRef} autoPlay className="hidden" />
        <Header scene={scene} />
        {busy && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-200/30 border-t-amber-300" />
          </div>
        )}
      </div>
      <SelfView stream={s.selfStream} cameraOn={s.cameraOn} forwarding={s.cameraForwarding} onToggle={s.toggleCamera} />
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <AvatarHud
          firstName={firstName}
          phase={s.phase}
          error={s.error}
          notice={s.notice}
          lines={s.lines}
          secondsLeft={s.secondsLeft}
          micOn={s.micOn}
          micForwarding={s.micForwarding}
          onTalk={() => void s.startTalk()}
          onEnd={() => void s.endTalk("button")}
          onReconnect={s.reconnect}
        />
      </div>
    </div>
  );
}

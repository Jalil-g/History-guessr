"use client";
/**
 * SelfView — the player's own webcam, shown under the talking local like a video call.
 *
 * Feature: "Video call with the local". When AVATAR.camera.enabled, useAvatarSession asks for the
 * camera together with the mic and starts the vidu-s2-avatar call with call_mode "video": the webcam
 * track goes to the character, which can see the player and comments on what it sees (hair, clothes…,
 * see AVATAR.seeingInstruction). This component only renders the local preview of that same track:
 *  - mirrored like every video-call app (the character receives the un-mirrored track),
 *  - a "They can see you" badge once session_state reports camera_forwarding,
 *  - a camera on/off button (turns the track off, the call keeps running as voice-only video),
 *  - an always-visible red "End call" button (the HUD's End button can be scrolled out of view once
 *    the self-view makes the card taller than the screen),
 *  - nothing at all when no camera track exists (permission refused / no camera → audio call).
 *
 * Use cases: the round's local panel (LocalAvatar) during a live or starting call.
 */
import { useEffect, useRef } from "react";
import { log } from "@/lib/log";

export type SelfViewProps = {
  stream: MediaStream | null;
  cameraOn: boolean;
  /** True once the character is actually receiving the webcam. */
  forwarding: boolean;
  onToggle: () => void;
  /** Ends the conversation (same as the HUD's "End conversation"). */
  onEnd: () => void;
};

/**
 * Mirrored webcam preview with camera toggle, End call button and a "they can see you" indicator.
 * @param props stream, camera state, forwarding flag, toggle and end handlers
 */
export function SelfView({ stream, cameraOn, forwarding, onToggle, onEnd }: SelfViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    log.info("SelfView.attach", { has: !!stream });
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  if (!stream) return null;

  return (
    <div className="relative aspect-video w-full shrink-0 overflow-hidden border-t border-amber-200/10 bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full -scale-x-100 object-cover transition-opacity ${cameraOn ? "opacity-100" : "opacity-0"}`}
      />
      {!cameraOn && <div className="absolute inset-0 flex items-center justify-center text-xs text-amber-100/50">Camera off</div>}
      <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-amber-50/90 backdrop-blur">
        <span className={`h-1.5 w-1.5 rounded-full ${cameraOn && forwarding ? "animate-pulse bg-red-500" : "bg-white/40"}`} />
        {cameraOn ? (forwarding ? "They can see you" : "Connecting camera…") : "You"}
      </div>
      <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
        <button
          onClick={onEnd}
          className="rounded-full bg-red-600 px-3 py-1 text-[11px] font-semibold text-white shadow hover:bg-red-500"
          title="End the conversation"
        >
          ✕ End call
        </button>
        <button
          onClick={onToggle}
          className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-amber-50/90 backdrop-blur hover:bg-black/80"
          title={cameraOn ? "Turn camera off" : "Turn camera on"}
        >
          {cameraOn ? "📷 Camera off" : "📷 Camera on"}
        </button>
      </div>
    </div>
  );
}

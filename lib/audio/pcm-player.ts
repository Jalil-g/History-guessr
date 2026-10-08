/**
 * PCM player — gapless playback queue for the 24 kHz mono PCM16 audio Gemini Live sends back.
 *
 * Feature: "Voice chat with a local (Gemini Live)". components/voice/useLiveSession.ts pushes every
 * base64 audio chunk from `serverContent.modelTurn.parts[].inlineData` into `enqueue()`. Chunks are
 * scheduled back-to-back on a single AudioContext timeline (a running "playhead"), so speech plays
 * without clicks or gaps. Browser-only.
 *
 * Use cases:
 *  - the local speaks: `player.enqueue(base64)`
 *  - barge-in: Gemini reports `serverContent.interrupted` when the player talks over the local →
 *    `player.interrupt()` drops everything queued immediately
 *  - UI "speaking" indicator: `onSpeakingChange(true/false)`
 *  - teardown on stop/unmount: `player.close()`
 */
import { VOICE } from "@/lib/config";
import { log } from "@/lib/log";

export type PcmPlayer = {
  enqueue: (base64Pcm: string) => void;
  interrupt: () => void;
  close: () => void;
};

/**
 * Decodes base64 little-endian PCM16 into Float32 samples in [-1, 1].
 * @param b64 base64 PCM16
 * @returns float samples
 */
export function decodePcm16(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = ((bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16) >> 16;
    out[i] = v / 0x8000;
  }
  return out;
}

/**
 * Creates a playback queue. Must be called from a user gesture (Talk click) so audio may start.
 * @param onSpeakingChange called when playback starts / drains
 * @returns player handle
 */
export function createPcmPlayer(onSpeakingChange: (speaking: boolean) => void): PcmPlayer {
  log.info("createPcmPlayer", { sampleRate: VOICE.outputSampleRate });
  const ctx = new AudioContext({ sampleRate: VOICE.outputSampleRate });
  const sources = new Set<AudioBufferSourceNode>();
  let playhead = 0;

  return {
    /** Schedules one chunk right after whatever is queued. @param base64Pcm 24 kHz PCM16 */
    enqueue(base64Pcm: string) {
      if (ctx.state === "closed") return;
      const samples = decodePcm16(base64Pcm);
      if (!samples.length) return;
      const buf = ctx.createBuffer(1, samples.length, VOICE.outputSampleRate);
      buf.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const at = Math.max(ctx.currentTime + 0.02, playhead);
      src.start(at);
      playhead = at + buf.duration;
      if (sources.size === 0) onSpeakingChange(true);
      sources.add(src);
      src.onended = () => {
        sources.delete(src);
        if (sources.size === 0) onSpeakingChange(false);
      };
    },
    /** Drops all queued audio immediately (barge-in). */
    interrupt() {
      log.info("pcmPlayer.interrupt", { queued: sources.size });
      sources.forEach((s) => {
        s.onended = null;
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      });
      sources.clear();
      playhead = ctx.currentTime;
      onSpeakingChange(false);
    },
    /** Stops playback and releases the audio device. */
    close() {
      log.info("pcmPlayer.close", {});
      this.interrupt();
      if (ctx.state !== "closed") void ctx.close();
    },
  };
}

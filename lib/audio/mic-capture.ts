/**
 * Mic capture — microphone → 16 kHz mono PCM16 chunks, the input format Gemini Live expects.
 *
 * Feature: "Voice chat with a local (Gemini Live)". components/voice/useLiveSession.ts starts this
 * when the player presses "Talk"; every ~100 ms chunk is base64-encoded and sent upstream with
 * `session.sendRealtimeInput({ audio })`. Browser-only.
 *
 * How it works: getUserMedia (echo cancellation + noise suppression on, so the local's own voice from
 * the speakers isn't sent back) → AudioContext running at VOICE.inputSampleRate (the browser resamples)
 * → an AudioWorklet (inlined as a Blob URL, no extra static file) that converts Float32 frames to
 * Int16 and posts chunks of VOICE.micChunkSamples.
 *
 * Use cases:
 *  - start talking: `const mic = await startMicCapture(onChunk)`
 *  - stop talking / unmount / round ends: `mic.stop()` releases the mic (browser indicator turns off)
 *  - permission denied: startMicCapture rejects with a DOMException named "NotAllowedError", which
 *    the hook turns into a readable message.
 */
import { VOICE } from "@/lib/config";
import { log } from "@/lib/log";

export type MicCapture = { stop: () => void };

const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) { super(); this.size = options.processorOptions.chunk; this.buf = []; this.len = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      const pcm = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) { const s = Math.max(-1, Math.min(1, ch[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      this.buf.push(pcm); this.len += pcm.length;
      if (this.len >= this.size) {
        const out = new Int16Array(this.len); let o = 0;
        for (const b of this.buf) { out.set(b, o); o += b.length; }
        this.port.postMessage(out.buffer, [out.buffer]); this.buf = []; this.len = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);`;

/**
 * Encodes binary data as base64 (chunked to avoid call-stack limits).
 * @param buf raw bytes
 * @returns base64 string
 */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Opens the microphone and streams PCM16 chunks to `onChunk` until stopped.
 * @param onChunk called with each base64 PCM16 chunk (16 kHz mono)
 * @returns handle with stop()
 */
export async function startMicCapture(onChunk: (base64Pcm: string) => void): Promise<MicCapture> {
  log.info("startMicCapture", { sampleRate: VOICE.inputSampleRate, chunk: VOICE.micChunkSamples });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const ctx = new AudioContext({ sampleRate: VOICE.inputSampleRate });
  try {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, "pcm-capture", { processorOptions: { chunk: VOICE.micChunkSamples } });
    node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => onChunk(arrayBufferToBase64(ev.data));
    ctx.createMediaStreamSource(stream).connect(node);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw e;
  }
  let stopped = false;
  return {
    /** Releases the microphone and the audio graph (idempotent). */
    stop() {
      if (stopped) return;
      stopped = true;
      log.info("stopMicCapture", {});
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

"use client";
/**
 * useGameKeys — keyboard shortcuts for the game screens (round, reveal, intro, summary).
 *
 * How it fits the architecture: each screen in components/game/ calls this hook with a map of
 * lower-case key names to handlers, e.g. RoundScreen binds { " ": guess, enter: guess, m: toggleMap,
 * h: toggleUi, escape: close }, RevealScreen binds Space/Enter to "next round". The walkable world
 * (components/world/useWasdControls.ts) owns W A S D and the arrow keys — never bind those here.
 *
 * Rules:
 *  - ignored while the user types: focus in an <input>, <textarea>, <select> or contenteditable
 *  - Space / Enter are ignored when focus is on a button / link / slider (their native action wins,
 *    so a focused button isn't triggered twice)
 *  - ignored with Ctrl / Meta / Alt held, and on key repeat
 *  - a handled key gets preventDefault (so Space doesn't scroll)
 */
import { useEffect, useRef } from "react";
import { log } from "@/lib/log";

/** Map of lower-case `KeyboardEvent.key` (" " for Space, "enter", "escape", "m"…) to handlers. */
export type KeyBindings = Record<string, () => void>;

/**
 * Returns true if a key event should be left alone because the user is typing or a control has focus.
 * @param e the keyboard event
 * @param key normalised key name
 */
function shouldIgnore(e: KeyboardEvent, key: string): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return true;
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return true;
  if ((key === " " || key === "enter") && (tag === "BUTTON" || tag === "A" || t.getAttribute("role") === "slider")) return true;
  return false;
}

/**
 * Binds the given shortcuts on window while the calling component is mounted.
 * @param bindings key → handler (latest version is always used; no need to memoise)
 * @param enabled set false to suspend all bindings
 */
export function useGameKeys(bindings: KeyBindings, enabled = true): void {
  log.info("useGameKeys", { keys: Object.keys(bindings), enabled });
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    /** Dispatches one keydown to the matching binding. @param e keyboard event */
    function onKey(e: KeyboardEvent) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
      const fn = ref.current[key];
      if (!fn || shouldIgnore(e, key)) return;
      log.info("useGameKeys.onKey", { key });
      e.preventDefault();
      fn();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

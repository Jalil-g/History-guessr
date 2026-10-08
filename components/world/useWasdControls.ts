"use client";
/**
 * useWasdControls — keyboard → LingBot World 2 movement axes.
 *
 * Maps WASD to walking (longitudinal forward/back, lateral strafe) and the arrow keys to looking
 * (horizontal yaw, vertical pitch). For each axis the most recently pressed held key wins; releasing
 * it falls back to the other held key on that axis or "idle". It knows nothing about Reactor: it
 * reports changes through callbacks, and useWorldSession turns them into `set_move_*` /
 * `set_look_*` commands and the idle ↔ moving prompt swap.
 *
 * Use cases:
 *  - `onAxis(axis, value)`   → send the movement command for that axis
 *  - `onMovingChange(bool)`  → swap the `moving` / `idle` prompt layer
 *  - `onInput()`             → reset the idle-disconnect timer
 * Ignores keys while the user types in an input/textarea (e.g. a guess field), ignores auto-repeat,
 * and releases everything when disabled or when the window loses focus.
 */
import { useEffect, useRef } from "react";
import { log } from "@/lib/log";

export type Axis = "long" | "lat" | "yaw" | "pitch";

const KEY_MAP: Record<string, { axis: Axis; value: string }> = {
  KeyW: { axis: "long", value: "forward" },
  KeyS: { axis: "long", value: "back" },
  KeyA: { axis: "lat", value: "strafe_left" },
  KeyD: { axis: "lat", value: "strafe_right" },
  ArrowUp: { axis: "pitch", value: "up" },
  ArrowDown: { axis: "pitch", value: "down" },
  ArrowLeft: { axis: "yaw", value: "left" },
  ArrowRight: { axis: "yaw", value: "right" },
};

type Callbacks = {
  onAxis: (axis: Axis, value: string) => void;
  onMovingChange: (moving: boolean) => void;
  onInput: () => void;
};

/**
 * Listens to the keyboard while `enabled` and reports axis / moving changes.
 * @param enabled only listen while true (i.e. the live world is generating)
 * @param callbacks see Callbacks (read through a ref, so they may change every render)
 */
export function useWasdControls(enabled: boolean, callbacks: Callbacks): void {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    log.info("useWasdControls", { enabled });
    if (!enabled) return;
    const held: string[] = [];
    let moving = false;

    /** Re-evaluates one axis and the moving flag after a key change. @param axis changed axis */
    const update = (axis: Axis) => {
      const last = [...held].reverse().find((k) => KEY_MAP[k].axis === axis);
      cbRef.current.onAxis(axis, last ? KEY_MAP[last].value : "idle");
      const nowMoving = held.some((k) => KEY_MAP[k].axis === "long" || KEY_MAP[k].axis === "lat");
      if (nowMoving !== moving) {
        moving = nowMoving;
        cbRef.current.onMovingChange(moving);
      }
    };

    /** True when focus is in a text field. @param e keyboard event */
    const isTyping = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");

    /** keydown handler. @param e keyboard event */
    const down = (e: KeyboardEvent) => {
      const m = KEY_MAP[e.code];
      if (!m || isTyping(e)) return;
      e.preventDefault();
      cbRef.current.onInput();
      if (e.repeat || held.includes(e.code)) return;
      held.push(e.code);
      update(m.axis);
    };
    /** keyup handler. @param e keyboard event */
    const up = (e: KeyboardEvent) => {
      const i = held.indexOf(e.code);
      if (i < 0) return;
      held.splice(i, 1);
      update(KEY_MAP[e.code].axis);
    };
    /** Releases all held keys (blur / disable). */
    const releaseAll = () => {
      const axes = new Set(held.map((k) => KEY_MAP[k].axis));
      held.length = 0;
      axes.forEach((a) => update(a));
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [enabled]);
}

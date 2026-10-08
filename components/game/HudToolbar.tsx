"use client";
/**
 * HudToolbar — the compact icon toolbar in the top-right of the round HUD (dark translucent box).
 *
 * How it fits the architecture: components/game/RoundScreen.tsx passes it into TopBar's `right` slot
 * and owns the state it toggles. Buttons:
 *  - Hint (lightbulb): opens a popover with one generic, answer-free observation tip from UI.hints
 *    (lib/config.ts), cycling on each press. Tips never mention the scene, so nothing can leak.
 *  - Hide UI (eye, shortcut H): hides every overlay so the player can study the full scene; the paid
 *    world / voice components stay mounted (only visually hidden).
 *  - Sound: mutes/unmutes the world's <video> elements (the Reactor stream). Voice chat audio is
 *    controlled in the local panel.
 *  - Help (?): popover listing the controls and keyboard shortcuts.
 * Popovers close on a second press or Esc (handled by the round screen's key hook).
 */
import { log } from "@/lib/log";
import { UI } from "@/lib/config";

export type ToolbarPopover = "hint" | "help" | null;

export type HudToolbarProps = {
  uiHidden: boolean;
  onToggleUi: () => void;
  muted: boolean;
  onToggleMute: () => void;
  popover: ToolbarPopover;
  onPopover: (p: ToolbarPopover) => void;
  /** Index into UI.hints for the hint popover. */
  hintIndex: number;
};

/**
 * One icon button of the toolbar.
 * @param props.label tooltip / aria label
 * @param props.active highlighted state
 * @param props.onClick click handler
 * @param props.children svg icon
 */
function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  log.info("HudToolbar.ToolButton", { label, active });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center transition hover:bg-cream/10 hover:text-cream ${active ? "bg-cream/15 text-cream" : "text-cream/70"}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

const SHORTCUTS: [string, string][] = [
  ["W A S D", "Walk (live world)"],
  ["← ↑ → ↓", "Look around"],
  ["Click map", "Drop / move your pin"],
  ["M", "Expand / collapse the map"],
  ["Drag ruler", "Pick a year (←/→ fine-tune when focused)"],
  ["Space / Enter", "Make your guess"],
  ["H", "Hide / show the interface"],
  ["Esc", "Close map or popovers"],
];

/**
 * Renders the toolbar and its popovers.
 * @param props see HudToolbarProps
 */
export function HudToolbar({ uiHidden, onToggleUi, muted, onToggleMute, popover, onPopover, hintIndex }: HudToolbarProps) {
  log.info("HudToolbar", { uiHidden, muted, popover });
  return (
    <div className="relative">
      <div className="flex items-center border border-cream/15 bg-black/45 p-0.5 backdrop-blur-md">
        <ToolButton label="Hint" active={popover === "hint"} onClick={() => onPopover(popover === "hint" ? null : "hint")}>
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
        </ToolButton>
        <ToolButton label={uiHidden ? "Show interface (H)" : "Hide interface (H)"} active={uiHidden} onClick={onToggleUi}>
          {uiHidden ? (
            <path d="M3 3l18 18M10.6 6.1A9.9 9.9 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          ) : (
            <>
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </ToolButton>
        <ToolButton label={muted ? "Unmute world" : "Mute world"} active={muted} onClick={onToggleMute}>
          <path d="M11 5L6 9H3v6h3l5 4V5z" />
          {muted ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
        </ToolButton>
        <ToolButton label="Help" active={popover === "help"} onClick={() => onPopover(popover === "help" ? null : "help")}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1v.5M12 17h.01" />
        </ToolButton>
      </div>

      {popover && (
        <div className="hg-rise absolute right-0 top-11 z-30 w-80 border border-cream/20 bg-[#0b0906]/90 p-5 shadow-2xl backdrop-blur-md">
          {popover === "hint" ? (
            <>
              <div className="hg-label mb-2 !text-brass">Hint {(hintIndex % UI.hints.length) + 1} / {UI.hints.length}</div>
              <p className="font-serif text-lg leading-snug text-cream/90">{UI.hints[hintIndex % UI.hints.length]}</p>
              <p className="hg-label mt-3 !text-[9px] !text-cream/40">Press the bulb again for another</p>
            </>
          ) : (
            <>
              <div className="hg-label mb-3 !text-cream">How to play</div>
              <dl className="space-y-2">
                {SHORTCUTS.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 border border-cream/20 px-1.5 py-0.5 font-mono text-[10px] text-cream/90">{k}</dt>
                    <dd className="text-right text-xs text-cream/60">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      )}
    </div>
  );
}

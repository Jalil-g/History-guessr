"use client";
/**
 * LazyGuessMap — the client-only entry point for the Leaflet guess / reveal map.
 *
 * Why it exists: Leaflet reads `window` when its module is evaluated, which crashes server rendering
 * in Next.js. Wrapping components/guess/GuessMap.tsx in next/dynamic with `ssr: false` defers the
 * import to the browser. Every screen that shows a map (MiniMap on the round screen for picking,
 * RevealScreen for the answer) imports `LazyGuessMap` from here instead of importing GuessMap directly.
 *
 * While the chunk loads, a parchment-coloured placeholder of the same size is shown.
 */
import dynamic from "next/dynamic";

/** Placeholder rendered while Leaflet loads. */
function MapLoading() {
  return <div className="hg-label flex h-full w-full items-center justify-center bg-[#2a2016] !text-cream/50">Unrolling the map…</div>;
}

/** The GuessMap component, loaded only in the browser. Same props as GuessMapProps. */
export const LazyGuessMap = dynamic(() => import("./GuessMap"), { ssr: false, loading: MapLoading });

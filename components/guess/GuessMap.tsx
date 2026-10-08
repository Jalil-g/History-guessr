"use client";
/**
 * GuessMap — the Leaflet world map used both to place a guess and to show the reveal.
 *
 * How it fits the architecture: the round screen (components/game/RoundScreen.tsx) renders it in
 * "pick" mode — the player clicks anywhere to drop (or move) their pin, reported via `onPick`. The
 * reveal screen (components/game/RevealScreen.tsx) renders it in "reveal" mode by also passing
 * `answer`: it then shows the guess pin, the true location and a dashed line between them, and fits
 * both into view.
 *
 * Leaflet touches `window` at import time, so this module must never be server-rendered. Always
 * import it through components/guess/LazyGuessMap.tsx (next/dynamic with ssr: false).
 *
 * Details:
 *  - tiles: keyless Esri World Street Map (URL, attribution, zooms and colours in lib/config.ts MAP)
 *  - markers are CircleMarkers, which avoids Leaflet's broken default image-icon paths under bundlers
 *  - clicks are wrapped to −180..180 longitude so panning across the date line still scores right
 *  - a ResizeObserver calls invalidateSize so the map renders correctly in flexible layouts
 */
import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { MAP } from "@/lib/config";
import { log } from "@/lib/log";
import type { LatLng } from "@/lib/scoring";

export type GuessMapProps = {
  /** The player's current pin, if any. */
  pin: LatLng | null;
  /** Called when the player clicks the map (omit for a read-only map). */
  onPick?: (p: LatLng) => void;
  /** The true location — when given, the map is in reveal mode. */
  answer?: LatLng;
};

/**
 * Listens for map clicks and reports the wrapped coordinates.
 * @param props.onPick click callback
 */
function ClickHandler({ onPick }: { onPick: (p: LatLng) => void }) {
  log.info("GuessMap.ClickHandler", {});
  useMapEvents({
    click(e) {
      const w = e.latlng.wrap();
      onPick({ lat: w.lat, lng: w.lng });
    },
  });
  return null;
}

/**
 * Keeps Leaflet's size in sync with its container and, in reveal mode, fits guess + answer.
 * @param props.pin guess pin
 * @param props.answer true location (reveal mode only)
 */
function MapSync({ pin, answer }: { pin: LatLng | null; answer?: LatLng }) {
  log.info("GuessMap.MapSync", { pin, answer });
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  useEffect(() => {
    if (!answer) return;
    const pts: [number, number][] = [[answer.lat, answer.lng]];
    if (pin) pts.push([pin.lat, pin.lng]);
    if (pts.length === 1) map.setView(pts[0], 5);
    else map.fitBounds(pts, { padding: [MAP.revealPadding, MAP.revealPadding], maxZoom: 8 });
  }, [map, pin, answer]);
  return null;
}

/**
 * Renders the world map with the guess pin and (in reveal mode) the answer + connecting line.
 * @param props see GuessMapProps
 */
export default function GuessMap({ pin, onPick, answer }: GuessMapProps) {
  log.info("GuessMap", { pin, answer: answer ? "set" : undefined, interactive: !!onPick });
  return (
    <MapContainer
      center={MAP.initialCenter}
      zoom={MAP.initialZoom}
      minZoom={MAP.minZoom}
      maxZoom={MAP.maxZoom}
      worldCopyJump
      className={`h-full w-full ${onPick ? "cursor-crosshair" : ""}`}
      style={{ background: "#1c1610" }}
    >
      <TileLayer url={MAP.tileUrl} attribution={MAP.attribution} />
      {onPick && <ClickHandler onPick={onPick} />}
      <MapSync pin={pin} answer={answer} />
      {pin && (
        <CircleMarker
          center={[pin.lat, pin.lng]}
          radius={8}
          pathOptions={{ color: "#1c1610", weight: 2, fillColor: MAP.guessColor, fillOpacity: 1 }}
        >
          {answer && <Tooltip permanent direction="top">Your guess</Tooltip>}
        </CircleMarker>
      )}
      {answer && (
        <CircleMarker
          center={[answer.lat, answer.lng]}
          radius={9}
          pathOptions={{ color: "#1c1610", weight: 2, fillColor: MAP.answerColor, fillOpacity: 1 }}
        >
          <Tooltip permanent direction="top">Answer</Tooltip>
        </CircleMarker>
      )}
      {answer && pin && (
        <Polyline
          positions={[
            [pin.lat, pin.lng],
            [answer.lat, answer.lng],
          ]}
          pathOptions={{ color: MAP.lineColor, weight: 2, dashArray: "6 6" }}
        />
      )}
    </MapContainer>
  );
}

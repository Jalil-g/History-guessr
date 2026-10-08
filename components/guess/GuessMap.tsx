"use client";
/**
 * GuessMap — the parchment Leaflet world map used both to place a guess and to show the reveal.
 *
 * How it fits the architecture: the round screen's mini-map (components/guess/MiniMap.tsx) renders it
 * in "pick" mode — the player clicks anywhere to drop (or move) their pin, reported via `onPick`. The
 * reveal screen (components/game/RevealScreen.tsx) renders it in "reveal" mode by also passing
 * `answer`: it then shows the guess pin, the true location and a dashed line between them, and fits
 * both into view.
 *
 * Leaflet touches `window` at import time, so this module must never be server-rendered. Always
 * import it through components/guess/LazyGuessMap.tsx (next/dynamic with ssr: false).
 *
 * Details:
 *  - tiles: keyless Esri World Terrain Base, sepia-filtered into parchment (`.hg-parchment-tiles` in
 *    app/globals.css), plus Esri's transparent boundaries & places overlay for orientation
 *    (URLs, attribution, zooms and pin colours in lib/config.ts MAP)
 *  - pins are crisp SVG divIcons (no broken default image icons under bundlers)
 *  - Leaflet's own zoom control is off; MiniMap draws its own +/− buttons using the map instance it
 *    receives through `onMapReady`
 *  - clicks are wrapped to −180..180 longitude so panning across the date line still scores right
 *  - a ResizeObserver calls invalidateSize so expanding / collapsing the mini-map re-renders tiles
 */
import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
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
  /** Receives the Leaflet map instance once (used for custom zoom buttons). */
  onMapReady?: (map: L.Map) => void;
};

/**
 * Builds an SVG teardrop pin as a Leaflet divIcon.
 * @param color fill colour
 * @param star draw a star in the head (answer pin) instead of a dot
 * @returns the icon
 */
function pinIcon(color: string, star: boolean): L.DivIcon {
  log.info("GuessMap.pinIcon", { color, star });
  const [w, h] = MAP.pinSize;
  const head = star
    ? `<path d="M12 6.2l1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 14.4l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#0b0906"/>`
    : `<circle cx="12" cy="11" r="3.2" fill="#0b0906"/>`;
  return L.divIcon({
    className: "hg-pin",
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    tooltipAnchor: [0, -h + 4],
    html: `<svg width="${w}" height="${h}" viewBox="0 0 24 34"><path d="M12 1C6 1 1.5 5.4 1.5 11.2 1.5 19 12 33 12 33s10.5-14 10.5-21.8C22.5 5.4 18 1 12 1z" fill="${color}" stroke="#0b0906" stroke-width="1.4"/>${head}</svg>`,
  });
}

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
 * Keeps Leaflet's size in sync with its container, hands out the map instance and, in reveal mode,
 * fits guess + answer.
 * @param props.pin guess pin
 * @param props.answer true location (reveal mode only)
 * @param props.onMapReady receives the map instance
 */
function MapSync({ pin, answer, onMapReady }: { pin: LatLng | null; answer?: LatLng; onMapReady?: (map: L.Map) => void }) {
  log.info("GuessMap.MapSync", { pin, answer });
  const map = useMap();
  useEffect(() => {
    onMapReady?.(map);
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map, onMapReady]);
  useEffect(() => {
    if (!answer) return;
    const pts: [number, number][] = [[answer.lat, answer.lng]];
    if (pin) pts.push([pin.lat, pin.lng]);
    if (pts.length === 1) map.setView(pts[0], 5);
    else map.flyToBounds(pts, { padding: [MAP.revealPadding * 2, MAP.revealPadding * 2], maxZoom: MAP.revealMaxZoom, duration: 1.6 });
  }, [map, pin, answer]);
  return null;
}

/**
 * Renders the parchment world map with the guess pin and (in reveal mode) the answer + connecting line.
 * @param props see GuessMapProps
 */
export default function GuessMap({ pin, onPick, answer, onMapReady }: GuessMapProps) {
  log.info("GuessMap", { pin, answer: answer ? "set" : undefined, interactive: !!onPick });
  const guessIcon = useMemo(() => pinIcon(MAP.pinGuessColor, false), []);
  const answerIcon = useMemo(() => pinIcon(MAP.pinAnswerColor, true), []);
  return (
    <MapContainer
      center={MAP.initialCenter}
      zoom={MAP.initialZoom}
      minZoom={MAP.minZoom}
      maxZoom={MAP.maxZoom}
      zoomControl={false}
      worldCopyJump
      className={`h-full w-full ${onPick ? "cursor-crosshair" : ""}`}
    >
      <TileLayer
        url={MAP.parchmentTileUrl}
        attribution={MAP.parchmentAttribution}
        maxNativeZoom={MAP.parchmentMaxNativeZoom}
        className="hg-parchment-tiles"
      />
      <TileLayer url={MAP.labelsTileUrl} className="hg-labels-tiles" />
      {onPick && <ClickHandler onPick={onPick} />}
      <MapSync pin={pin} answer={answer} onMapReady={onMapReady} />
      {answer && pin && (
        <Polyline
          positions={[
            [pin.lat, pin.lng],
            [answer.lat, answer.lng],
          ]}
          pathOptions={{ color: "#0b0906", weight: 2, dashArray: "2 7", lineCap: "round" }}
        />
      )}
      {pin && (
        <Marker position={[pin.lat, pin.lng]} icon={guessIcon} interactive={false}>
          {answer && <Tooltip permanent direction="top">You</Tooltip>}
        </Marker>
      )}
      {answer && (
        <Marker position={[answer.lat, answer.lng]} icon={answerIcon} interactive={false}>
          <Tooltip permanent direction="top">Answer</Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}

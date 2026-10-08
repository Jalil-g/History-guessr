/**
 * Scoring — EraGuessr-style points for one round, plus small display formatters.
 *
 * How it fits the architecture: after the player drops a pin and picks a year on the round screen
 * (components/game/RoundScreen.tsx), the game loop (components/game/Game.tsx) calls `scoreRound`
 * with the guess and the scene's hidden `answer` (lib/scene.ts). The resulting `RoundResult` drives
 * the reveal screen (distance, year difference, points per axis) and the summary table.
 *
 * Scoring model (all constants live in lib/config.ts GAME):
 *  - distance: great-circle (haversine) distance in km between pin and answer;
 *    location points = round(max * exp(-km / GAME.locationDecayKm))
 *  - year:     |guess year − answer year|;
 *    year points     = round(max * exp(-Δyears / GAME.yearDecayYears))
 *  - each axis is worth up to GAME.maxPointsPerAxis (5000), so a perfect round is 10 000.
 *
 * Use cases:
 *  - `scoreRound`     the game loop, once per submitted guess
 *  - `formatYear`     year slider readout, reveal and summary ("2560 BC", "AD 410")
 *  - `formatKm`       reveal and summary distance readouts
 *  - `haversineKm`    anywhere a distance between two lat/lng points is needed
 * Pure functions, no I/O — safe on server and client.
 */
import { GAME } from "./config";
import { log } from "./log";
import type { Scene } from "./scene";

/** A point on the globe in degrees. */
export type LatLng = { lat: number; lng: number };

/** What the player submits for a round. */
export type Guess = LatLng & { year: number };

/** Outcome of one round, kept for the reveal and summary screens. */
export type RoundResult = {
  scene: Scene;
  guess: Guess;
  distanceKm: number;
  /** Absolute difference in years. */
  yearDiff: number;
  locationPoints: number;
  yearPoints: number;
  total: number;
};

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two points (haversine formula).
 * @param a first point
 * @param b second point
 * @returns distance in kilometres
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  log.info("haversineKm", { a, b });
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Location points for a given distance.
 * @param km distance between guess and answer
 * @returns 0..GAME.maxPointsPerAxis
 */
export function locationPoints(km: number): number {
  log.info("locationPoints", { km });
  return Math.round(GAME.maxPointsPerAxis * Math.exp(-km / GAME.locationDecayKm));
}

/**
 * Year points for a given year difference.
 * @param yearDiff absolute difference in years
 * @returns 0..GAME.maxPointsPerAxis
 */
export function yearPoints(yearDiff: number): number {
  log.info("yearPoints", { yearDiff });
  return Math.round(GAME.maxPointsPerAxis * Math.exp(-Math.abs(yearDiff) / GAME.yearDecayYears));
}

/**
 * Scores one round.
 * @param scene the scene that was played (its `answer` is the truth)
 * @param guess the player's pin and year
 * @returns the full round result
 */
export function scoreRound(scene: Scene, guess: Guess): RoundResult {
  log.info("scoreRound", { sceneId: scene.id, guess });
  const distanceKm = haversineKm(guess, scene.answer);
  const yearDiff = Math.abs(guess.year - scene.answer.year);
  const loc = locationPoints(distanceKm);
  const yr = yearPoints(yearDiff);
  return { scene, guess, distanceKm, yearDiff, locationPoints: loc, yearPoints: yr, total: loc + yr };
}

/**
 * Formats a signed year (negative = BC) for display.
 * @param year e.g. -2560 or 410
 * @returns e.g. "2560 BC" or "AD 410"
 */
export function formatYear(year: number): string {
  log.info("formatYear", { year });
  return year < 0 ? `${-year} BC` : `AD ${year}`;
}

/**
 * Formats a distance in km for display.
 * @param km distance
 * @returns e.g. "12 km", "1,234 km"
 */
export function formatKm(km: number): string {
  log.info("formatKm", { km });
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/**
 * Formats a point total with thousands separators.
 * @param points score
 * @returns e.g. "7,412"
 */
export function formatPoints(points: number): string {
  log.info("formatPoints", { points });
  return points.toLocaleString("en-US");
}

/**
 * Browser-side Reactor JWT resolver for the walkable world.
 *
 * Passed as `jwtToken` to the world provider. It calls GET /api/reactor/token?model=… (which holds the
 * API key server-side, see lib/reactor-token.ts) and memoizes the JWT in module scope until
 * REACTOR.tokenRefreshSkewMs before it expires. Memoizing matters: a Reactor session is bound to the
 * exact token that created it, and one token may create several sessions (one per round), so every
 * round reuses the same token instead of minting a new one.
 *
 * Tokens are cached per model: the main world (MODELS.reactorWorld) and the backup world
 * (MODELS.reactorWorldFallback, opened when the main one is at capacity) each get their own.
 * Concurrent callers share one in-flight request. The JWT itself is never logged.
 */
import { MODELS, REACTOR } from "@/lib/config";
import { log } from "@/lib/log";

/** One memoized token per Reactor model (a session only works with the exact token that created it). */
const cache = new Map<string, { jwt: string; expiresAtMs: number }>();
const inflight = new Map<string, Promise<string>>();

/**
 * Returns a cached session-scoped JWT for `model`, minting one via GET /api/reactor/token?model=… when
 * missing or close to expiry. Parallel calls share one request.
 * @param model Reactor model the token is scoped to (default: the main world model)
 * @returns the JWT
 */
export async function fetchReactorTokenFor(model: string = MODELS.reactorWorld): Promise<string> {
  log.info("fetchReactorTokenFor", { model, cached: cache.has(model) });
  const hit = cache.get(model);
  if (hit && Date.now() < hit.expiresAtMs - REACTOR.tokenRefreshSkewMs) return hit.jwt;
  const running = inflight.get(model);
  if (running) return running;
  const p = (async () => {
    try {
      const r = await fetch(`/api/reactor/token?model=${encodeURIComponent(model)}`, { cache: "no-store" });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Token fetch failed: ${r.status}`);
      }
      const { jwt, expires_at } = (await r.json()) as { jwt: string; expires_at: number };
      cache.set(model, { jwt, expiresAtMs: expires_at * 1000 });
      return jwt;
    } finally {
      inflight.delete(model);
    }
  })();
  inflight.set(model, p);
  return p;
}

/**
 * Token resolver for the main world model — the `jwtToken` the world provider gets by default.
 * @returns the JWT
 */
export function fetchReactorToken(): Promise<string> {
  return fetchReactorTokenFor(MODELS.reactorWorld);
}

/**
 * Browser-side Reactor JWT resolver for the walkable world.
 *
 * WorldView passes `() => fetchReactorToken(model.reactorModel)` as `jwtToken` to the chosen world
 * model's adapter Provider (components/world/adapters/*). It calls GET /api/reactor/token?model=…
 * (which holds the API key server-side and only allows REACTOR_TOKEN_MODELS, see
 * lib/reactor-token.ts) and memoizes one JWT PER MODEL in module scope until
 * REACTOR.tokenRefreshSkewMs before it expires. Memoizing matters: a Reactor session is bound to the
 * exact token that created it, and one token may create several sessions (one per round), so every
 * round reuses the same token instead of minting a new one. Tokens are model-scoped, so switching the
 * world model in the picker mints a separate one.
 *
 * Concurrent callers for the same model share one in-flight request. The JWT itself is never logged.
 */
import { MODELS, REACTOR } from "@/lib/config";
import { log } from "@/lib/log";

const cached = new Map<string, { jwt: string; expiresAtMs: number }>();
const inflight = new Map<string, Promise<string>>();

/**
 * Returns a cached session-scoped Reactor JWT for `model`, minting one via /api/reactor/token when needed.
 * @param model Reactor model name the token is scoped to (default MODELS.reactorWorld)
 * @returns the JWT string
 * @throws Error when the token route fails
 */
export async function fetchReactorToken(model: string = MODELS.reactorWorld): Promise<string> {
  const hit = cached.get(model);
  log.info("fetchReactorToken", { model, cached: !!hit });
  if (hit && Date.now() < hit.expiresAtMs - REACTOR.tokenRefreshSkewMs) return hit.jwt;
  const pending = inflight.get(model);
  if (pending) return pending;
  const p = (async () => {
    try {
      const r = await fetch(`/api/reactor/token?model=${encodeURIComponent(model)}`, { cache: "no-store" });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Token fetch failed: ${r.status}`);
      }
      const { jwt, expires_at } = (await r.json()) as { jwt: string; expires_at: number };
      cached.set(model, { jwt, expiresAtMs: expires_at * 1000 });
      return jwt;
    } finally {
      inflight.delete(model);
    }
  })();
  inflight.set(model, p);
  return p;
}

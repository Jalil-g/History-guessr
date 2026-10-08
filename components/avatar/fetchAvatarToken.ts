/**
 * Browser-side Reactor JWT resolver for the talking avatar (Reactor vidu-s2-avatar).
 *
 * The avatar opens its own Reactor session straight from the browser, separate from the walkable
 * world. Reactor JWTs are down-scoped to one model (lib/reactor-token.ts), so the avatar cannot reuse
 * the world's token; it asks GET /api/reactor/token?model=<MODELS.reactorAvatar> instead. The API
 * key never leaves the server.
 *
 * Like components/world/fetchReactorToken.ts, the JWT is memoized in module scope until
 * REACTOR.tokenRefreshSkewMs before expiry: one token can create several sessions (one per round),
 * and a session stays bound to the token that created it. Concurrent callers share one request.
 * The JWT itself is never logged.
 *
 * Use cases: useAvatarSession (connect) and scripts/manual checks of the token route.
 */
import { MODELS, REACTOR } from "@/lib/config";
import { log } from "@/lib/log";

let cached: { jwt: string; expiresAtMs: number } | null = null;
let inflight: Promise<string> | null = null;

/**
 * Returns a cached avatar-scoped Reactor JWT, minting one via /api/reactor/token when needed.
 * @returns the JWT string
 * @throws Error when the token route fails
 */
export async function fetchAvatarToken(): Promise<string> {
  log.info("fetchAvatarToken", { cached: !!cached, model: MODELS.reactorAvatar });
  if (cached && Date.now() < cached.expiresAtMs - REACTOR.tokenRefreshSkewMs) return cached.jwt;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(`/api/reactor/token?model=${encodeURIComponent(MODELS.reactorAvatar)}`, { cache: "no-store" });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Token fetch failed: ${r.status}`);
      }
      const { jwt, expires_at } = (await r.json()) as { jwt: string; expires_at: number };
      cached = { jwt, expiresAtMs: expires_at * 1000 };
      return jwt;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

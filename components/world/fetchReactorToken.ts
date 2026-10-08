/**
 * Browser-side Reactor JWT resolver for the walkable world.
 *
 * Passed as `jwtToken` to <LingbotWorld2Provider>. It calls GET /api/reactor/token (which holds the
 * API key server-side, see lib/reactor-token.ts) and memoizes the JWT in module scope until
 * REACTOR.tokenRefreshSkewMs before it expires. Memoizing matters: a Reactor session is bound to the
 * exact token that created it, and one token may create several sessions (one per round), so every
 * round reuses the same token instead of minting a new one.
 *
 * Concurrent callers share one in-flight request. The JWT itself is never logged.
 */
import { REACTOR } from "@/lib/config";
import { log } from "@/lib/log";

let cached: { jwt: string; expiresAtMs: number } | null = null;
let inflight: Promise<string> | null = null;

/**
 * Returns a cached session-scoped Reactor JWT, minting one via /api/reactor/token when needed.
 * @returns the JWT string
 * @throws Error when the token route fails
 */
export async function fetchReactorToken(): Promise<string> {
  log.info("fetchReactorToken", { cached: !!cached });
  if (cached && Date.now() < cached.expiresAtMs - REACTOR.tokenRefreshSkewMs) return cached.jwt;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch("/api/reactor/token", { cache: "no-store" });
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

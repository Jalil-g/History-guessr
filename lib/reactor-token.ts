/**
 * Reactor token minting — SERVER ONLY.
 *
 * The walkable world (components/world/*) opens a Reactor LingBot World 2 session straight from the
 * browser over WebRTC. The browser must never see REACTOR_API_KEY, so the server exchanges the key
 * for a short-lived, down-scoped JWT (POST {REACTOR.apiUrl}/tokens) and hands only that JWT to the
 * client via app/api/reactor/token/route.ts.
 *
 * Down-scoping: the `authorization_details` block restricts the JWT to sessions of
 * MODELS.reactorWorld only, at most REACTOR.maxSessionsPerToken sessions, for
 * REACTOR.tokenLifetimeSeconds. A leaked token is therefore a bounded loss, not an account key.
 *
 * Use cases:
 *  - GET /api/reactor/token (the only caller) → `{ jwt, expires_at }` for the browser.
 *  - The browser memoizes the JWT (components/world/fetchReactorToken.ts) because a Reactor session
 *    is bound to the exact token that created it.
 *
 * Logging: the call is logged with its non-secret parameters and outcome; the API key and the JWT
 * are never logged.
 */
import { MODELS, REACTOR } from "@/lib/config";
import { log, logGenAI } from "@/lib/log";

/** Result of minting: the JWT plus its expiry in unix seconds. */
export type ReactorToken = { jwt: string; expires_at: number };

/** Error carrying an HTTP status the route should answer with. */
export class ReactorTokenError extends Error {
  /** @param message human-readable reason @param status HTTP status for the route */
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Exchanges REACTOR_API_KEY for a session-scoped Reactor JWT.
 * @returns the JWT and its expiry (unix seconds)
 * @throws ReactorTokenError when the key is missing or Reactor rejects the request
 */
export async function mintReactorToken(): Promise<ReactorToken> {
  log.info("mintReactorToken", { model: MODELS.reactorWorld, apiUrl: REACTOR.apiUrl });
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) throw new ReactorTokenError("REACTOR_API_KEY is not set on the server", 500);

  const body = {
    expires_after: REACTOR.tokenLifetimeSeconds,
    authorization_details: [
      {
        type: "session",
        resources: { models: { match: [MODELS.reactorWorld] } },
        constraints: { max_sessions: REACTOR.maxSessionsPerToken },
      },
    ],
  };
  const res = await fetch(`${REACTOR.apiUrl}/tokens`, {
    method: "POST",
    headers: { "Reactor-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    logGenAI("reactor.mintToken", body, { ok: false, status: res.status });
    throw new ReactorTokenError(`Reactor /tokens returned ${res.status}`, 502);
  }
  const { jwt, expires_at } = (await res.json()) as ReactorToken;
  logGenAI("reactor.mintToken", body, { ok: true, expires_at });
  return { jwt, expires_at };
}

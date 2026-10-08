/**
 * GET /api/reactor/token — mints a short-lived Reactor JWT for the browser.
 *
 * Part of the walkable world feature: components/world/fetchReactorToken.ts calls this before
 * connecting to Reactor LingBot World 2. The heavy lifting (and the API key) stays in
 * lib/reactor-token.ts on the server; this route only translates the result into HTTP.
 *
 * Query: `?model=<reactor model>` (optional, default MODELS.reactorWorld) scopes the token to one
 * model from REACTOR_TOKEN_MODELS — the talking avatar (components/avatar) asks for
 * MODELS.reactorAvatar. Unknown models → 400.
 *
 * Responses:
 *  - 200 `{ jwt, expires_at }` with `Cache-Control: private, no-store` (the client memoizes it itself)
 *  - 500 when REACTOR_API_KEY is missing, 502 when Reactor rejects the request → `{ error }`
 * Never logs or echoes the key or the token.
 */
import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { mintReactorToken, ReactorTokenError } from "@/lib/reactor-token";

export const dynamic = "force-dynamic";

/**
 * Handles GET: mint a token scoped to `?model=` (default: the world model) and return it uncached.
 * @param req incoming request
 * @returns JSON response
 */
export async function GET(req: Request) {
  const model = new URL(req.url).searchParams.get("model") ?? undefined;
  log.info("GET /api/reactor/token", { model });
  try {
    const token = await mintReactorToken(model);
    return NextResponse.json(token, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const status = e instanceof ReactorTokenError ? e.status : 502;
    const message = e instanceof Error ? e.message : "token mint failed";
    log.error("GET /api/reactor/token failed", { status, message });
    return NextResponse.json({ error: message }, { status });
  }
}

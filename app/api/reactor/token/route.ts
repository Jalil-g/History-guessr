/**
 * GET /api/reactor/token — mints a short-lived Reactor JWT for the browser.
 *
 * Part of the walkable world feature: components/world/fetchReactorToken.ts calls this before
 * connecting to Reactor LingBot World 2. The heavy lifting (and the API key) stays in
 * lib/reactor-token.ts on the server; this route only translates the result into HTTP.
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

/** Handles GET: mint a token and return it uncached. @returns JSON response */
export async function GET() {
  log.info("GET /api/reactor/token");
  try {
    const token = await mintReactorToken();
    return NextResponse.json(token, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const status = e instanceof ReactorTokenError ? e.status : 502;
    const message = e instanceof Error ? e.message : "token mint failed";
    log.error("GET /api/reactor/token failed", { status, message });
    return NextResponse.json({ error: message }, { status });
  }
}

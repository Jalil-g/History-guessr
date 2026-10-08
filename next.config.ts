/**
 * Next.js configuration. Strict mode is off so dev doesn't double-mount components, which would
 * open two paid Reactor sessions / two Gemini Live sessions per round.
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = { reactStrictMode: false };

export default nextConfig;

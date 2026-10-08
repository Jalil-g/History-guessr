/**
 * Root layout: html shell, global styles, fonts and page metadata for History Guesser.
 * Every page (currently just the game at `/`) renders inside it.
 * Fonts (next/font/google, self-hosted at build time): Cinzel for display headings (`font-display`)
 * and Cormorant Garamond for literary text such as book quotes (`font-serif`); see app/globals.css.
 */
import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const cinzel = Cinzel({ subsets: ["latin"], variable: "--font-cinzel", display: "swap" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-cormorant", display: "swap" });

export const metadata: Metadata = {
  title: "History Guesser",
  description: "Walk through AI-generated moments in history and guess where and when you are.",
};

/** Wraps every page in the html/body shell. @param children the page */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${cormorant.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

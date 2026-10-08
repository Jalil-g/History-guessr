/**
 * Root layout: html shell, global styles and page metadata for History Guesser.
 * Every page (currently just the game at `/`) renders inside it.
 */
import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "History Guesser",
  description: "Walk through AI-generated moments in history and guess where and when you are.",
};

/** Wraps every page in the html/body shell. @param children the page */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Archivo, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["700", "800", "900"], // heavy weights only — Archivo at 400 is off-brand
  variable: "--font-archivo",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-public-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Rx Search & Rescue",
  description: "Medicare drug-coverage analysis — find every drug, rescue every plan choice.",
};

export const viewport: Viewport = {
  themeColor: "#0e1d2f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${publicSans.variable} ${plexMono.variable}`}>
      {/* suppressHydrationWarning: browser extensions inject attributes into <body> before React hydrates */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

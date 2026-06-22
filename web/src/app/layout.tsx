import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display: high-contrast variable serif (true italics) — editorial/judicial gravitas.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
  style: ["normal", "italic"],
});

// Body/UI: a warm, distinctive grotesque — not Inter/Geist.
const hanken = Hanken_Grotesk({ variable: "--font-sans", subsets: ["latin"] });

// Mono: the case record — citations, claim IDs, timestamps, the audit log.
const jbmono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Juro — both sides heard, one ruling",
  description:
    "Juro convenes a tribunal of four AI advocates to argue a denied health-insurance claim — for and against. A human rules, grounded in real law, fully auditable.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${hanken.variable} ${jbmono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}

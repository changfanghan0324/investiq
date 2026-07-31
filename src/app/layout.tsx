import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { LanguageProvider } from "@/i18n/language";
import "./globals.css";

const uiSans = IBM_Plex_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const uiMono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "InvestIQ — Investment Research & Portfolio Analytics",
    template: "%s — InvestIQ",
  },
  description:
    "Evidence-first company financial analysis, valuation, portfolio construction, and risk analytics for US-listed equities.",
  applicationName: "InvestIQ",
  keywords: [
    "investment analytics",
    "portfolio analysis",
    "stock comparison",
    "stock backtest",
    "recurring investment",
    "US equities",
  ],
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${uiSans.variable} ${uiMono.variable}`} data-scroll-behavior="smooth">
      <body><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}

import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
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
  title: "Stock Lens — Portfolio Backtest Lab",
  description:
    "Professional recurring-investment backtests for US stocks and ETFs, with exact trading-day execution, dividends, fees, taxes, and drawdown.",
  applicationName: "Stock Lens",
  keywords: ["stock backtest", "recurring investment", "portfolio analytics", "US equities"],
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${uiSans.variable} ${uiMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

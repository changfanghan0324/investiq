import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { ReadinessProvider } from "@/components/readiness-provider";
import { LanguageProvider } from "@/i18n/language";
import { rootMetadata } from "@/config/site-metadata";
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

export const metadata: Metadata = rootMetadata;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${uiSans.variable} ${uiMono.variable}`} data-scroll-behavior="smooth">
      <body>
        <LanguageProvider>
          <ReadinessProvider>{children}</ReadinessProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

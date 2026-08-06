import type { Metadata } from "next";
import { ReadinessProvider } from "@/components/readiness-provider";
import { LanguageProvider } from "@/i18n/language";
import { rootMetadata } from "@/config/site-metadata";
import "./globals.css";

export const metadata: Metadata = rootMetadata;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <LanguageProvider>
          <ReadinessProvider>{children}</ReadinessProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

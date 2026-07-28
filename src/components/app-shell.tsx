"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Type } from "lucide-react";

import { isActiveRoute, type NavRouteId, primaryRoutes } from "@/config/navigation";
import { fontScaleOptions, languageOptions, type FontScale, useLanguage } from "@/i18n/language";

import styles from "./app-shell.module.css";

export function AppShell({
  children,
  actions,
  status,
}: {
  children: ReactNode;
  /** Page-specific header buttons, rendered after the display controls. */
  actions?: ReactNode;
  /** Compact service/data status indicator for pages that read live data. */
  status?: ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">{t("shell.skipToContent")}</a>

      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <BrandMark />
          <strong>InvestIQ</strong>
        </Link>

        <nav className={styles.desktopNav} aria-label={t("nav.primary")}>
          {primaryRoutes.map((route) => {
            const active = isActiveRoute(pathname, route.href);
            return (
              <Link
                key={route.id}
                href={route.href}
                className={active ? styles.navItemActive : styles.navItem}
                aria-current={active ? "page" : undefined}
              >
                {t(route.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className={styles.headerRight}>
          {status ? <div className={styles.statusSlot}>{status}</div> : null}
          <LanguageControl />
          <FontScaleControl />
          {actions ? <div className={styles.actionSlot}>{actions}</div> : null}
        </div>
      </header>

      <main className={styles.main} id="main-content">
        {children}
      </main>

      <nav className={styles.bottomNav} aria-label={t("nav.primaryCompact")}>
        {primaryRoutes.map((route) => {
          const active = isActiveRoute(pathname, route.href);
          return (
            <Link
              key={route.id}
              href={route.href}
              className={active ? styles.bottomItemActive : styles.bottomItem}
              aria-current={active ? "page" : undefined}
            >
              <NavIcon id={route.id} />
              <span>{t(route.shortLabelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function ShellDisclaimer() {
  const { t } = useLanguage();
  return <p className={styles.disclaimer}>{t("shell.disclaimer")}</p>;
}

function LanguageControl() {
  const { language, setLanguage, t } = useLanguage();
  const active = languageOptions.find((option) => option.code === language) ?? languageOptions[0];
  return (
    <label className={styles.selectControl} title={t("language.label")}>
      <span className={styles.visuallyHidden}>{t("language.label")}</span>
      <span className={styles.controlValue} aria-hidden="true">
        <span className={styles.flag}>{active.flag}</span>
        <b>{active.shortLabel}</b>
      </span>
      <select
        value={language}
        aria-label={t("language.label")}
        onChange={(event) => setLanguage(event.target.value as typeof language)}
      >
        {languageOptions.map((option) => (
          <option key={option.code} value={option.code}>{option.flag} {option.label}</option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}

function FontScaleControl() {
  const { fontScale, setFontScale, t } = useLanguage();
  return (
    <label className={styles.selectControl} title={t("display.fontSize")}>
      <span className={styles.visuallyHidden}>{t("display.fontSize")}</span>
      <span className={styles.controlValue} aria-hidden="true">
        <Type size={13} />
        <b className={styles.mono}>{fontScale}%</b>
      </span>
      <select
        value={fontScale}
        aria-label={t("display.fontSize")}
        onChange={(event) => setFontScale(event.target.value as FontScale)}
      >
        {fontScaleOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown size={12} aria-hidden="true" />
    </label>
  );
}

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <svg viewBox="0 0 24 24" role="presentation">
        <circle cx="12" cy="12" r="10" />
        <path d="M5.5 15.5 L10 10.5 L13.5 13.5 L18.5 7.5" />
      </svg>
    </span>
  );
}

/** Inline outline icons keep the bottom navigation legible at 18px without extra dependencies. */
function NavIcon({ id }: { id: NavRouteId }) {
  const paths: Record<NavRouteId, ReactNode> = {
    market: <path d="M3 15.5 L8 9.5 L12 13 L21 4.5" />,
    stock: (
      <>
        <path d="M5 20 L5 11" />
        <path d="M12 20 L12 5" />
        <path d="M19 20 L19 14" />
      </>
    ),
    compare: (
      <>
        <path d="M12 4 L12 20" />
        <path d="M4 8 L20 8" />
        <path d="M4 8 L1.5 14 L6.5 14 Z" />
        <path d="M20 8 L17.5 14 L22.5 14 Z" />
      </>
    ),
    portfolio: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="1.5" />
        <path d="M9 7 L9 4.5 L15 4.5 L15 7" />
      </>
    ),
    dca: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5 L12 16.5" />
        <path d="M14.5 9.75 A2.5 2.5 0 0 0 9.5 10.5 A2.2 2.2 0 0 0 12 12.4 A2.2 2.2 0 0 1 14.5 14.3 A2.5 2.5 0 0 1 9.5 15" />
      </>
    ),
  };
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[id]}
    </svg>
  );
}

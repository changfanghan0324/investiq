"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

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
          <LanguageControl />
          <FontScaleControl />
        </div>
      </header>

      {status || actions ? (
        <div className={styles.pageTools}>
          {status ? <div className={styles.statusSlot}>{status}</div> : null}
          {actions ? <div className={styles.actionSlot}>{actions}</div> : null}
        </div>
      ) : null}

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
        <b>{active.shortLabel}</b>
      </span>
      <select
        value={language}
        aria-label={t("language.label")}
        onChange={(event) => setLanguage(event.target.value as typeof language)}
      >
        {languageOptions.map((option) => (
          <option key={option.code} value={option.code}>{option.label}</option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}

function FontScaleControl() {
  const { fontScale, setFontScale, t } = useLanguage();
  const active = fontScaleOptions.find((option) => option.value === fontScale) ?? fontScaleOptions[0];
  return (
    <label className={styles.selectControl} title={t("display.fontSize")}>
      <span className={styles.visuallyHidden}>{t("display.fontSize")}</span>
      <span className={styles.controlValue} aria-hidden="true">
        <b>{active.label}</b>
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
    research: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5 L21 21" />
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
    tools: (
      <>
        <path d="M4 7 L20 7" />
        <path d="M4 17 L20 17" />
        <circle cx="9" cy="7" r="2" />
        <circle cx="15" cy="17" r="2" />
      </>
    ),
  };
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[id]}
    </svg>
  );
}

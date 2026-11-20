"use client";

import { useEffect } from "react";
import styles from "./ThemeToggle.module.css";

// Which icon shows is decided in CSS from data-theme / prefers-color-scheme, so it is right from first paint.
function toggleTheme() {
  const root = document.documentElement;
  const current =
    root.getAttribute("data-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try {
    localStorage.setItem("kagumi-theme", next);
  } catch {
    // Storage blocked: the theme still applies for this page view.
  }
}

/** `label` shows a visible text beside the icon, as the admin sidebar's "Ganti tema" item (M2 plan D22). */
export default function ThemeToggle({ label }: { label?: string }) {
  // A notFound() page is sent as an error shell and rendered in the browser, where the <head> theme script never
  // runs (Next 16, dev and production). Every page with a toggle then applies the stored theme after hydration.
  useEffect(() => {
    const root = document.documentElement;
    if (root.hasAttribute("data-theme")) return;
    try {
      const stored = localStorage.getItem("kagumi-theme");
      if (stored === "light" || stored === "dark") root.setAttribute("data-theme", stored);
    } catch {
      // Storage blocked: the system theme stays.
    }
  }, []);

  return (
    <button
      type="button"
      className={label ? styles.labeled : styles.toggle}
      aria-label="Ganti tema terang/gelap"
      onClick={toggleTheme}
    >
      <svg className={styles.sun} data-icon="sun" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
      </svg>
      <svg className={styles.moon} data-icon="moon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
        <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
      </svg>
      {label}
    </button>
  );
}

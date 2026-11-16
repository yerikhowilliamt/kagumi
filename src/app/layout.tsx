import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "@/styles/tokens.css";

// Fonts are self-hosted (design.md §3): --head and --body are declared here, not in tokens.css.
const switzer = localFont({
  src: [
    { path: "./fonts/Switzer-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Switzer-Semibold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--head",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--body",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

// Applies the stored theme before first paint (design.md §2.6). A constant string: never put user or admin content here.
const themeScript = `try{var t=localStorage.getItem("kagumi-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export const metadata: Metadata = {
  title: "Kagumi Dough",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme before hydration.
    <html lang="id" className={`${switzer.variable} ${figtree.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

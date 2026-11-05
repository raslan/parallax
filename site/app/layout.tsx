import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEFAULT_THEME, THEMES } from "@/lib/themes.generated";
import { THEME_STORAGE_KEY } from "@/lib/theme-storage";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Parallax", template: "%s | Parallax" },
  description: "A self-hosted media library manager.",
};

// Applies the saved theme before first paint so a static page doesn't flash the default.
const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var ok=${JSON.stringify(THEMES.map((x) => x.id))};document.documentElement.dataset.theme=ok.indexOf(t)>=0?t:${JSON.stringify(DEFAULT_THEME)}}catch(e){document.documentElement.dataset.theme=${JSON.stringify(DEFAULT_THEME)}}`;

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider
          theme={{ forcedTheme: "dark", defaultTheme: "dark" }}
          search={{ options: { type: "static", api: "/api/search" } }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}

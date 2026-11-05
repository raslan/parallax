import type { BaseLayoutProps, LinkItemType } from "fumadocs-ui/layouts/shared";
import { ThemePicker } from "@/components/theme-picker";

const secondaryLinks: LinkItemType[] = [
  { type: "custom", secondary: true, children: <ThemePicker /> },
];

/**
 * `includeDocsLink`: adds a "Docs" nav link — home layout only; DocsLayout already
 * shows the docs index in its sidebar.
 */
export function baseOptions(includeDocsLink = false): BaseLayoutProps {
  return {
    nav: { title: "Parallax" },
    githubUrl: "https://github.com/raslan/parallax",
    // Dark only; the Parallax-set theme picker (secondary link) replaces the light/dark toggle.
    themeSwitch: { enabled: false },
    links: includeDocsLink ? [{ text: "Docs", url: "/docs" }, ...secondaryLinks] : secondaryLinks,
  };
}

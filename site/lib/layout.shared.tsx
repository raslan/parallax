import type { BaseLayoutProps, LinkItemType } from "fumadocs-ui/layouts/shared";
import { ThemePicker } from "@/components/theme-picker";

const GITHUB_URL = "https://github.com/raslan/parallax";

const GithubIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.38.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.76.12 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.42.36.78 1.07.78 2.16 0 1.56-.01 2.81-.01 3.19 0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
  </svg>
);

/** Bottom of the docs sidebar: the theme picker and a full-width GitHub button. */
export function SidebarFooter() {
  return (
    <div className="flex flex-col gap-2">
      <ThemePicker />
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-fd-border bg-fd-secondary/50 px-3 py-2 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent"
      >
        <GithubIcon className="size-4" />
        GitHub
      </a>
    </div>
  );
}

// Used by the home layout, which has no sidebar: the same two controls in the top bar.
const homeLinks: LinkItemType[] = [
  { type: "custom", secondary: true, children: <ThemePicker /> },
  {
    type: "custom",
    secondary: true,
    children: (
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
      >
        <GithubIcon className="size-4" />
        GitHub
      </a>
    ),
  },
];

/**
 * `includeDocsLink` is true for the home layout only. The docs layout gets no top links,
 * because its theme picker and GitHub button live in the sidebar footer.
 */
export function baseOptions(includeDocsLink = false): BaseLayoutProps {
  return {
    nav: { title: "Parallax" },
    // Dark only; the theme picker replaces the light/dark toggle.
    themeSwitch: { enabled: false },
    links: includeDocsLink ? [{ text: "Docs", url: "/docs" }, ...homeLinks] : [],
  };
}

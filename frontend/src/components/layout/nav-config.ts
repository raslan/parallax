import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, imageApi, qk } from "@/lib/api";
import {
  Library,
  Film,
  Copy,
  Scissors,
  Minimize2,
  Wrench,
  Archive,
  Images,
  ShieldAlert,
  FolderX,
  Wand2,
  Captions,
  Download,
  type LucideIcon,
} from "lucide-react";

/** @public */
export type NavItem = { to: string; icon: LucideIcon; label: string };
export type SectionId = "videos" | "images" | "tools";
export type Section = { id: SectionId; label: string; icon: LucideIcon; items: NavItem[] };

export const SECTIONS: Section[] = [
  {
    id: "videos",
    label: "Videos",
    icon: Film,
    items: [
      { to: "/libraries", icon: Library, label: "Libraries" },
      { to: "/files", icon: Film, label: "Files" },
      { to: "/duplicates", icon: Copy, label: "Duplicates" },
      { to: "/cleanup", icon: Scissors, label: "Cleanup" },
      { to: "/compress", icon: Minimize2, label: "Compress" },
      { to: "/toolbox", icon: Wrench, label: "Toolbox" },
      { to: "/originals", icon: Archive, label: "Originals" },
    ],
  },
  {
    id: "images",
    label: "Images",
    icon: Images,
    items: [
      { to: "/image-libraries", icon: Library, label: "Libraries" },
      { to: "/images", icon: Images, label: "Images" },
      { to: "/image-duplicates", icon: Copy, label: "Duplicates" },
      { to: "/content-review", icon: ShieldAlert, label: "Content Review" },
      { to: "/image-quarantined", icon: FolderX, label: "Quarantined" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    items: [
      { to: "/identify", icon: Wand2, label: "Identify" },
      { to: "/subtitles", icon: Captions, label: "Subtitles" },
      { to: "/downloads", icon: Download, label: "Downloads" },
    ],
  },
];

/** Longest-prefix match so `/image-libraries` beats `/images` etc. */
export function routeToTab(pathname: string): SectionId | null {
  let best: { id: SectionId; len: number } | null = null;
  for (const section of SECTIONS) {
    for (const item of section.items) {
      const hit = pathname === item.to || pathname.startsWith(item.to + "/");
      if (hit && (!best || item.to.length > best.len)) {
        best = { id: section.id, len: item.to.length };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * The video/image pages other than Libraries are useless without a library of
 * that type, so hide them until one exists. The first item of each media
 * section is its Libraries entry.
 *
 * @public
 */
export function filterSectionItems(
  section: Section,
  hasVideoLibraries: boolean,
  hasImageLibraries: boolean,
): NavItem[] {
  if (section.id === "videos" && !hasVideoLibraries) return section.items.slice(0, 1);
  if (section.id === "images" && !hasImageLibraries) return section.items.slice(0, 1);
  return section.items;
}

/** @public */
export function useSectionNav(): {
  activeTab: SectionId | null;
  section: Section;
  items: NavItem[];
} {
  const { pathname } = useLocation();
  const activeTab = routeToTab(pathname);
  // SECTIONS is a statically non-empty literal, so SECTIONS[0] is always defined.
  const section = SECTIONS.find((s) => s.id === activeTab) ?? SECTIONS[0]!;

  const { data: videoLibraries = [] } = useQuery({
    queryKey: qk.libraries(),
    queryFn: () => api.getLibraries(),
    staleTime: 30_000,
  });
  const { data: imageLibraries = [] } = useQuery({
    queryKey: qk.imageLibraries(),
    queryFn: () => imageApi.listLibraries(),
    staleTime: 30_000,
  });

  const items = filterSectionItems(section, videoLibraries.length > 0, imageLibraries.length > 0);
  return { activeTab, section, items };
}

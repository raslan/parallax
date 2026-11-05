import { FileIcon, Film, ImageIcon, Music } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { OrganizeFile } from "@/types/organize";

/** The one icon per Organize file kind (file thumbnails' fallback, folder count chips). */
export const KIND_ICON: Record<OrganizeFile["kind"], LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  other: FileIcon,
};

import { FileIcon, Film, ImageIcon, Music } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PruneFile } from "@/types/prune";

/** The one icon per Prune file kind (file thumbnails' fallback, folder count chips). */
export const KIND_ICON: Record<PruneFile["kind"], LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  other: FileIcon,
};

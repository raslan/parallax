import type { FC } from "react";
import type { LucideIcon } from "lucide-react";

export interface Leftovers {
  has_leftovers: boolean;
  dir_name: string;
  count: number;
  total_bytes: number;
}

/** Fields both `Library` and `ImageLibrary` share, enough for the generic UI. */
export interface LibraryBase {
  id: number;
  name: string;
  path: string;
  last_scanned_at: string | null;
}

export interface ScanControlProps {
  libraryId: number;
  scanning: boolean;
  onScanned: () => void;
}

export interface AddDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}

/**
 * Everything that differs between the video (`Libraries`) and image
 * (`ImageLibraries`) manager pages. `LibraryManagerPage` renders the shared
 * skeleton; the two `pages/*.tsx` files each pass one of these.
 */
export interface LibraryKind<T extends LibraryBase> {
  // page copy
  title: string;
  subtitle: (libs: T[]) => string;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyBody: string;

  // library card
  countNoun: string;
  getCount: (lib: T) => number;
  isScanned: (lib: T) => boolean;
  notScannedHint: string;

  // job filtering
  jobType: string;

  // delete-dialog vocabulary
  entityLabel: string; // "library" | "image library"
  entityPlural: string; // "libraries" | "image libraries"
  recordNoun: string; // "file records" | "image records"
  leftoverDir: string; // "_originals/" | "_quarantine/"
  leftoverFoundNoun: string; // "original backups" | "quarantined images"
  leftoverReviewRoute: string; // "/originals" | "/image-quarantined"
  leftoverButtons: {
    reviewFirst: string;
    keepOnDisk: string;
    deleteWith: string;
    deleteAllWith: string;
  };

  // data
  listKey: () => readonly unknown[];
  leftoversKey: (id: number) => readonly unknown[];
  list: () => Promise<T[]>;
  leftovers: (id: number) => Promise<Leftovers>;
  remove: (id: number, deleteLeftovers: boolean) => Promise<unknown>;

  // slots — the genuinely divergent pieces
  ScanControl: FC<ScanControlProps>;
  AddDialog: FC<AddDialogProps>;
}

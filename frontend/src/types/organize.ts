type OrganizeKind = "image" | "video" | "audio" | "other";

/** @public — consumed by the folder-card and file-list tasks. */
export interface Counts {
  files: number;
  images: number;
  videos: number;
  audio: number;
  other: number;
  bytes: number;
}

interface Crumb {
  name: string;
  path: string;
}

/**
 * One child folder card: its own files (`direct`) and the whole subtree (`total`).
 *
 * @public
 */
export interface FolderNodeInfo {
  name: string;
  path: string;
  direct: Counts;
  total: Counts;
}

export interface OrganizeFolder {
  path: string;
  name: string;
  parent: string | null;
  breadcrumbs: Crumb[];
  direct: Counts;
  total: Counts;
  subfolders: FolderNodeInfo[];
}

export interface OrganizeFile {
  name: string;
  path: string;
  kind: OrganizeKind;
  size: number;
  mtime: number;
}

export interface FileDetails {
  duration: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  bitrate: number | null;
}

export interface ScanState {
  status: "idle" | "running" | "done" | "error";
  folders_scanned: number;
  root: string | null;
}

export interface OrganizeDeleteResult {
  deleted: string[];
  failed: { path: string; error: string }[];
  /** Folders left with nothing in them; never includes the root. */
  empty_folders: string[];
}

export interface OrganizeMoveResult {
  /** The subfolder the files went into. */
  folder: string;
  /** Original paths of the files that moved. */
  moved: string[];
  failed: { path: string; error: string }[];
}

export interface OrganizeRenameResult {
  renamed: { path: string; new_path: string }[];
  failed: { path: string; error: string }[];
}

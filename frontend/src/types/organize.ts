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

/** A file's embedded tags (`POST /organize/tags`). */
export interface OrganizeTagInfo {
  /** Canonical fields (title, description, artist, ...); only those the file has. */
  fields: Record<string, string>;
  /** Every tag as stored, keyed by its own name. */
  raw: Record<string, string>;
  /** One line per stream, e.g. "audio mp3 2ch 44100 Hz". */
  streams: string[];
  /** A value was cut to 500 characters (batch requests only). */
  truncated: boolean;
}

/** How a file's tags get written: in place (mkv/webm), or by rewriting a copy. */
export type TagWriteHow = "in_place" | "rewrite";

/** Whether and how one file's tags can be written (`POST /organize/tags/plan`). */
export interface TagPlan {
  writable: boolean;
  how: TagWriteHow | null;
  /** Why it cannot be written, when it cannot. */
  reason: string | null;
  /** Fields that can be edited: canonical names, `raw:<name>` for tags the file has. */
  fields: string[];
  /** Free space a rewrite needs next to the file (0 in place). */
  bytes_needed: number;
  /** A caution to show beside how it is written. */
  note: string | null;
  /** Any other tag name can be added. */
  can_add_raw: boolean;
}

export interface TagPlansResult {
  plans: Record<string, TagPlan>;
  /** Free bytes on the folder of each file. */
  free_bytes: Record<string, number>;
}

/** One file's edits for `POST /organize/tags/apply`; `null` clears a field. */
export interface TagApplyItem {
  path: string;
  set: Record<string, string | null>;
}

export interface TagApplyResult {
  results: Record<string, { status: "written" | "failed"; message: string }>;
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

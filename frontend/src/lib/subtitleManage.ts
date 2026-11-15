import { splitExtension } from "@/lib/organizeRename";
import type { SubtitleFileInfo, TidyMode, UnmatchedSubtitle } from "@/types/subtitle";
import type { SyncEngine } from "@/lib/subtitleRunDock";

/** What the Manage panel asks the page to do. Paths are the video's own subtitle files. */
export type ManageAction =
  | { type: "compare"; file: SubtitleFileInfo }
  | { type: "sync"; path: string; engine: SyncEngine }
  | { type: "make_main"; path: string }
  /** `path` is the subtitle the backup belongs to (the file the backup is swapped back over). */
  | { type: "restore"; path: string }
  | { type: "rename"; file: SubtitleFileInfo }
  | { type: "delete"; paths: string[] }
  | { type: "tidy"; what: TidyMode; count: number }
  /** Subtitles found beside no video: the folder-scoped calls, never the video's own. */
  | { type: "stray_compare"; file: UnmatchedSubtitle }
  | { type: "stray_rename"; file: UnmatchedSubtitle }
  | { type: "stray_delete"; paths: string[] }
  | { type: "find" }
  | { type: "translate" }
  | { type: "generate" };

export const RENAME_WARNING =
  "This name does not start with the video's name, so this page will no longer list it as a subtitle for this video.";

/** Make main swaps a labelled real subtitle with the plain one: nothing else can be made main. */
export function canMakeMain(file: SubtitleFileInfo): boolean {
  return (file.kind === "real" || file.kind === "hearing_impaired") && !!file.label;
}

/** The subtitle a `.original` backup belongs to (`X.en.original.srt` → `X.en.srt`). */
export function mainPathOfOriginal(path: string): string {
  return path.replace(/\.original(\.[^./\\]+)$/i, "$1");
}

/** Which files a tidy-up would delete. Mirrors the server (`_tidy_targets`), which is the authority. */
export function tidyTargets(files: SubtitleFileInfo[], what: TidyMode): SubtitleFileInfo[] {
  if (what === "generated_translated")
    return files.filter((f) => f.kind === "generated" || f.kind === "translated");
  if (what === "originals") return files.filter((f) => f.kind === "original");
  const plain = new Set(files.filter((f) => f.kind === "real" && !f.label).map((f) => f.language));
  return files.filter(
    (f) => (f.kind === "real" || f.kind === "hearing_impaired") && f.label && plain.has(f.language),
  );
}

/** The server lists a subtitle for a video by `<video stem>.`; a name without it falls out of view. */
export function startsWithVideoName(videoName: string, newName: string): boolean {
  const [stem] = splitExtension(videoName);
  return newName.startsWith(`${stem}.`);
}

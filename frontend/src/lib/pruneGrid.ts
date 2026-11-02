/** Folder cards carry a lot of text, so they never get narrower/wider than this. */
const FOLDER_MIN_WIDTH = 200;
const FOLDER_MAX_WIDTH = 400;

/**
 * Folder-card column width for the shared card-size setting. The clamp is local to
 * the folder cards: the stored setting (shared by every page) keeps the slider's own
 * value, so moving the slider here behaves like it does everywhere else.
 */
export function folderCardWidth(size: number): number {
  if (!Number.isFinite(size)) return FOLDER_MIN_WIDTH;
  return Math.min(FOLDER_MAX_WIDTH, Math.max(FOLDER_MIN_WIDTH, size));
}

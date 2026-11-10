/**
 * Organize's tag view helpers: which tag columns the list shows (remembered per viewer),
 * plain counts for a long text, and how one field reads across several selected files.
 * Pure; no interpretation of values.
 */

const TAG_COLUMN_IDS = [
  "title",
  "description",
  "artist",
  "album",
  "genre",
  "date",
  "comment",
  "synopsis",
] as const;

export type TagColumnId = (typeof TAG_COLUMN_IDS)[number];

export const TAG_COLUMNS_KEY = "parallax-organize-tag-columns";

const DEFAULT_COLUMNS: TagColumnId[] = ["title", "description"];

const isColumn = (v: unknown): v is TagColumnId =>
  typeof v === "string" && (TAG_COLUMN_IDS as readonly string[]).includes(v);

/**
 * The saved column list: known ids in their saved order, repeats dropped. Nothing saved,
 * unreadable data or a storage that throws gives the default; a saved empty list stays empty.
 */
export function loadTagColumns(storage: Pick<Storage, "getItem">): TagColumnId[] {
  try {
    const raw = storage.getItem(TAG_COLUMNS_KEY);
    if (raw === null) return [...DEFAULT_COLUMNS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_COLUMNS];
    return [...new Set(parsed.filter(isColumn))];
  } catch {
    return [...DEFAULT_COLUMNS];
  }
}

/** Remembers the column list; a blocked or full storage is not an error. */
export function saveTagColumns(storage: Pick<Storage, "setItem">, cols: TagColumnId[]): void {
  try {
    storage.setItem(TAG_COLUMNS_KEY, JSON.stringify(cols));
  } catch {
    // The page works without remembering.
  }
}

/** A `#` that starts a word and is followed by at least one letter, digit or underscore. */
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

/** Plain facts about a text: how many characters (not UTF-16 units) and hashtags. */
export function describeText(text: string): { chars: number; hashtags: number } {
  return { chars: Array.from(text).length, hashtags: text.match(HASHTAG)?.length ?? 0 };
}

export type MixedValue =
  | { kind: "empty" }
  | { kind: "same"; value: string }
  | { kind: "mixed"; distinct: number; empties: number };

/** How one field reads across files: nothing anywhere, one shared value, or mixed. */
export function mixedValue(values: (string | undefined)[]): MixedValue {
  const present = values.filter((v): v is string => v !== undefined);
  const empties = values.length - present.length;
  const distinct = new Set(present);
  if (distinct.size === 0) return { kind: "empty" };
  if (distinct.size === 1 && empties === 0) return { kind: "same", value: [...distinct][0]! };
  return { kind: "mixed", distinct: distinct.size, empties };
}

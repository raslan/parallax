// Grouping for the Duplicates pages' audio criterion. The server measured, per file, which
// other files share its audio (backend/app/services/shared_audio.py) and stored it in
// `shared_audio`: a JSON array of [otherFileId, share] pairs, where share (0-1) is how much
// of the shorter of the two tracks is found in the other.

/** "Sounds alike" range in percent: the server refuses anything outside it. Below ~65% unrelated
 * music starts to count as the same audio. */
export const SIMILARITY_MIN_PCT = 65;
export const SIMILARITY_MAX_PCT = 95;
/** The largest "Shared for at least" the server accepts, in seconds. */
export const MAX_STRETCH_SECONDS = 3600;

/** A "Sounds alike" percentage held inside the range the server accepts. */
export function clampSimilarityPct(pct: number): number {
  return Math.min(SIMILARITY_MAX_PCT, Math.max(SIMILARITY_MIN_PCT, pct));
}

/**
 * What a typed "Shared for at least" means: whole seconds held inside 0..MAX_STRETCH_SECONDS, or
 * null while the text is not a number yet (an empty field mid-edit must not become 0).
 */
export function parseStretchSeconds(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_STRETCH_SECONDS, Math.max(0, n));
}

/** The ids in `json` whose share is at or above `minShare`. */
function sharedAudioWith(json: string | null, minShare: number): number[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is [number, number] =>
          Array.isArray(e) &&
          typeof e[0] === "number" &&
          typeof e[1] === "number" &&
          e[1] >= minShare,
      )
      .map((e) => e[0]);
  } catch {
    return [];
  }
}

/**
 * Splits each group into the files joined by shared audio at or above `minShare`. Files are
 * grouped by chains of such matches rather than anchor-and-sweep, because the file the others
 * are inside of (the longer cut) is usually not the first one in the list.
 */
export function splitBySharedAudio<T extends { id: number; shared_audio: string | null }>(
  groups: T[][],
  minShare: number,
): T[][] {
  const next: T[][] = [];
  for (const group of groups) {
    const index = new Map(group.map((f, i) => [f.id, i]));
    const links = group.map((f) =>
      sharedAudioWith(f.shared_audio, minShare).filter((id) => index.has(id)),
    );
    const seen = new Set<number>();
    for (let start = 0; start < group.length; start++) {
      if (seen.has(start)) continue;
      seen.add(start);
      const component: number[] = [];
      const stack = [start];
      while (stack.length > 0) {
        const i = stack.pop()!;
        component.push(i);
        for (const id of links[i]!) {
          const j = index.get(id)!;
          if (seen.has(j)) continue;
          seen.add(j);
          stack.push(j);
        }
      }
      if (component.length > 1) next.push(component.sort((a, b) => a - b).map((i) => group[i]!));
    }
  }
  return next;
}

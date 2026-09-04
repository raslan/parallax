export interface FileGuess {
  file_path: string;
  season: number | null;
  episode: number | null;
}

const POOL = "__pool__";

export function slotKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

export function distinctSeasons(fileGuesses: FileGuess[]): number[] {
  const seasons = new Set<number>();
  for (const g of fileGuesses) {
    if (g.season != null) seasons.add(g.season);
  }
  return [...seasons].sort((a, b) => a - b);
}

/**
 * Auto-place files whose guessed season+episode matches an available slot.
 * A slot already claimed by an earlier file in `files` is left alone
 * (first-match-wins) rather than being overwritten by a later duplicate guess.
 */
export function buildInitialAssignments(
  files: string[],
  fileGuesses: FileGuess[],
  slotKeys: Set<string>,
): Record<string, string> {
  const guessByPath = new Map(fileGuesses.map((g) => [g.file_path, g]));
  const assignments: Record<string, string> = {};
  for (const file of files) {
    const guess = guessByPath.get(file);
    if (!guess || guess.season == null || guess.episode == null) continue;
    const key = slotKey(guess.season, guess.episode);
    if (slotKeys.has(key) && !assignments[key]) {
      assignments[key] = file;
    }
  }
  return assignments;
}

export function poolFiles(files: string[], assignments: Record<string, string>): string[] {
  const assigned = new Set(Object.values(assignments));
  return files.filter((f) => !assigned.has(f));
}

export function placeFile(
  assignments: Record<string, string>,
  filePath: string,
  target: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(assignments)) {
    if (value !== filePath) next[key] = value;
  }
  if (target !== POOL) {
    next[target] = filePath;
  }
  return next;
}

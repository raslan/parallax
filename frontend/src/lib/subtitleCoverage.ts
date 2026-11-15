import type {
  LanguageCoverage,
  LengthInfo,
  ScanFile,
  SubtitleFileInfo,
  SubtitleKind,
} from "@/types/subtitle";

/**
 * Everything the Subtitles page says about a folder comes from what is on disk right now:
 * nothing is remembered between visits. These are the pure rules behind the coverage bars,
 * the summary strip and the "needs attention" filters.
 */

const isReal = (kind: SubtitleKind) => kind === "real" || kind === "hearing_impaired";

const sameLanguage = (s: SubtitleFileInfo, lang: string) =>
  s.language.toLowerCase() === lang.toLowerCase();

/** The kinds of subtitle a file has for one language (`.original` backups never count). */
function kindsFor(file: ScanFile, lang: string) {
  let real = false;
  let generated = false;
  let translated = false;
  for (const s of file.subtitles) {
    if (!sameLanguage(s, lang)) continue;
    if (isReal(s.kind)) real = true;
    else if (s.kind === "generated") generated = true;
    else if (s.kind === "translated") translated = true;
  }
  return { real, generated, translated };
}

/** Per wanted language, how many files have a real, a generated and a translated subtitle. */
export function coverage(files: ScanFile[], wanted: string[]): Record<string, LanguageCoverage> {
  const out: Record<string, LanguageCoverage> = {};
  for (const lang of wanted) {
    const c = { real: 0, generated: 0, translated: 0, total: files.length };
    for (const f of files) {
      const k = kindsFor(f, lang);
      if (k.real) c.real++;
      if (k.generated) c.generated++;
      if (k.translated) c.translated++;
    }
    out[lang] = c;
  }
  return out;
}

/**
 * Files worth a look, as filters over the folder: missing a real subtitle in a wanted
 * language, having only a generated or translated one there, a subtitle that ends well
 * before the video (from the length check), and a pre-sync `.original` backup.
 */
export function attention(
  files: ScanFile[],
  wanted: string[],
  lengths?: Record<string, LengthInfo | null>,
) {
  const missing = new Set<string>();
  const machineOnly = new Set<string>();
  const looksShort = new Set<string>();
  const hasBackup = new Set<string>();
  for (const f of files) {
    for (const lang of wanted) {
      const k = kindsFor(f, lang);
      if (!k.real) missing.add(f.path);
      if (!k.real && (k.generated || k.translated)) machineOnly.add(f.path);
    }
    if (f.subtitles.some((s) => s.kind === "original")) hasBackup.add(f.path);
    if (lengths?.[f.path]?.subtitles.some((s) => s.length === "short")) looksShort.add(f.path);
  }
  return { missing, machineOnly, looksShort, hasBackup };
}

/**
 * What the length check's cache keys a video on. The scan has no size or time for the
 * video itself, and the result depends on its subtitle files, so they stand in: the total
 * subtitle size, and a hash of every subtitle's name and size. A new, removed or rewritten
 * subtitle (a sync changes the size) then reads the lengths again.
 */
export function lengthKey(file: ScanFile) {
  let size = 0;
  let hash = 0;
  for (const s of file.subtitles) {
    size += s.size;
    for (const ch of `${s.path}\u0000${s.size}\u0001`) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  }
  return { path: file.path, size, mtime: hash };
}

const GENERATE_BLOCKED = "Install or choose a speech model in Settings → Subtitles";
const TRANSLATE_BLOCKED = "Install a language pack in Settings → Subtitles";

/**
 * Why Translate or Generate cannot work at all, else null. Only what is installed counts:
 * what a file already has never disables an action. `null` means not known (the list is
 * still loading or could not be read); unknown is never taken for "none installed", so it
 * blocks nothing and the server answers if the action really cannot run.
 */
export function blockedReasons({
  speechModelReady,
  packsInstalled,
}: {
  speechModelReady: boolean | null;
  packsInstalled: number | null;
}) {
  return {
    translate: packsInstalled === 0 ? TRANSLATE_BLOCKED : null,
    generate: speechModelReady === false ? GENERATE_BLOCKED : null,
  };
}

/** Whether a video has a subtitle to check or sync (a `.original` backup is not one). */
export function hasSubtitle(file: ScanFile): boolean {
  return file.subtitles.some((s) => s.kind !== "original");
}

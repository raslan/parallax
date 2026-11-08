import type { AudioFile } from "@/types/audio";
import type { VideoFile } from "@/types/file";
import type { ImageFile } from "@/types/image";

/**
 * Which copy in a duplicate group to keep.
 *
 * Copies are compared tier by tier; the first tier that tells two files apart
 * decides, and later tiers only break ties. A tier calls two files a tie when
 * they are within its tolerance, so noise (a second of duration, 2% of pixels)
 * never decides on its own. Files that tie on every tier fall back to the
 * lowest id, so the result never depends on the order the group was built in.
 *
 * Uses only data already on the file rows — nothing extra is probed.
 */

/** Positive when the first file is better, negative when the second is, 0 for a tie. */
type Verdict = -1 | 0 | 1;
type Tier<T> = (a: T, b: T) => Verdict;

function sign(n: number): Verdict {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Relative difference of two positive numbers; a tie when within `tie`. */
function byDiff(a: number | null | undefined, b: number | null | undefined, tie: number): Verdict {
  if (a == null || b == null || a <= 0 || b <= 0) return 0;
  const rel = (a - b) / Math.max(a, b);
  return Math.abs(rel) <= tie ? 0 : sign(rel);
}

/**
 * Narrow the group one tier at a time: find the best copy under that tier, then
 * keep only the copies that tie with it. Tolerance ties are not transitive, so
 * ranking everything head to head could let a copy that a later tier would have
 * ruled out slip through. Whatever is left after the last tier is a perfect
 * tie, and the lowest id wins.
 */
function pick<T extends { id: number }>(files: T[], tiers: Tier<T>[]): number {
  let candidates = [...files].sort((x, y) => x.id - y.id);
  for (const tier of tiers) {
    if (candidates.length === 1) break;
    let best = candidates[0]!;
    for (const c of candidates.slice(1)) {
      if (tier(c, best) > 0) best = c;
    }
    candidates = candidates.filter((c) => c === best || tier(best, c) === 0);
  }
  return candidates[0]!.id;
}

/** Completeness: the longer copy wins, ignoring a second or 0.5% of rounding noise. */
function durationTier<T extends { duration: number | null }>(): Tier<T> {
  return (a, b) => {
    if (a.duration != null && b.duration != null && Math.abs(a.duration - b.duration) <= 1) {
      return 0;
    }
    return byDiff(a.duration, b.duration, 0.005);
  };
}

/** Last resort before the id: the bigger file. */
function sizeTier<T extends { size: number }>(): Tier<T> {
  return (a, b) => sign(a.size - b.size);
}

// ── video ──

// How much picture quality a codec delivers per bit, relative to H.264.
const VIDEO_CODEC_EFFICIENCY: Record<string, number> = {
  av1: 1.9,
  hevc: 1.6,
  h265: 1.6,
  vp9: 1.4,
  h264: 1,
  vp8: 0.9,
  mpeg4: 0.6,
  msmpeg4v3: 0.5,
  wmv3: 0.6,
  vc1: 0.8,
  mpeg2video: 0.5,
  mpeg1video: 0.35,
};

function videoEfficiency(codec: string | null): number {
  return (codec && VIDEO_CODEC_EFFICIENCY[codec.toLowerCase()]) || 1;
}

const videoTiers: Tier<VideoFile>[] = [
  durationTier(),
  // Resolution: more pixels is detail that cannot be recovered.
  (a, b) =>
    byDiff(
      a.file_width != null && a.file_height != null ? a.file_width * a.file_height : null,
      b.file_width != null && b.file_height != null ? b.file_width * b.file_height : null,
      0.02,
    ),
  // Codec-normalised bitrate. If either file lacks a video bitrate, both fall
  // back to the whole-file average so the two sides stay comparable.
  (a, b) => {
    const direct = !!a.video_bitrate && !!b.video_bitrate;
    const rate = (f: VideoFile) =>
      direct ? f.video_bitrate : f.duration ? (f.size * 8) / f.duration : null;
    const ra = rate(a);
    const rb = rate(b);
    if (ra == null || rb == null) return 0;
    return byDiff(ra * videoEfficiency(a.codec_name), rb * videoEfficiency(b.codec_name), 0.03);
  },
  (a, b) => byDiff(a.file_fps, b.file_fps, 0.02),
  sizeTier(),
];

/** The id of the copy to keep. `files` must not be empty. */
export function pickVideoKeep(files: VideoFile[]): number {
  return pick(files, videoTiers);
}

// ── audio ──

const LOSSLESS_AUDIO = new Set(["flac", "alac", "ape", "wavpack", "tta", "wmalossless"]);

function isLosslessAudio(codec: string | null): boolean {
  if (!codec) return false;
  const c = codec.toLowerCase();
  return c.startsWith("pcm_") || LOSSLESS_AUDIO.has(c);
}

const AUDIO_CODEC_EFFICIENCY: Record<string, number> = {
  opus: 1.7,
  aac: 1.3,
  vorbis: 1.2,
  eac3: 1.1,
  mp3: 1,
  wmav1: 0.9,
  wmav2: 0.9,
  ac3: 0.8,
  mp2: 0.7,
};

function audioEfficiency(codec: string | null): number {
  return (codec && AUDIO_CODEC_EFFICIENCY[codec.toLowerCase()]) || 1;
}

const audioTiers: Tier<AudioFile>[] = [
  durationTier(),
  (a, b) => sign(+isLosslessAudio(a.codec_name) - +isLosslessAudio(b.codec_name)),
  (a, b) =>
    byDiff(
      a.bitrate ? a.bitrate * audioEfficiency(a.codec_name) : null,
      b.bitrate ? b.bitrate * audioEfficiency(b.codec_name) : null,
      0.03,
    ),
  (a, b) => byDiff(a.sample_rate, b.sample_rate, 0.02),
  (a, b) => (a.channels != null && b.channels != null ? sign(a.channels - b.channels) : 0),
  sizeTier(),
];

/** The id of the copy to keep. `files` must not be empty. */
export function pickAudioKeep(files: AudioFile[]): number {
  return pick(files, audioTiers);
}

// ── images ──

const LOSSLESS_IMAGE = new Set(["png", "bmp", "tif", "tiff"]);

// Bytes-per-pixel go further in the newer formats.
const IMAGE_FORMAT_EFFICIENCY: Record<string, number> = {
  avif: 1.9,
  heic: 1.6,
  heif: 1.6,
  webp: 1.3,
};

function imageExt(f: ImageFile): string {
  return f.extension.replace(/^\./, "").toLowerCase();
}

function pixels(f: ImageFile): number | null {
  return f.width != null && f.height != null ? f.width * f.height : null;
}

// Metadata (EXIF) is deliberately not a tier: the keeper is the better piece of
// media, and a stripped copy can win.
const imageTiers: Tier<ImageFile>[] = [
  (a, b) => byDiff(pixels(a), pixels(b), 0.02),
  (a, b) => sign(+LOSSLESS_IMAGE.has(imageExt(a)) - +LOSSLESS_IMAGE.has(imageExt(b))),
  (a, b) => {
    const pa = pixels(a);
    const pb = pixels(b);
    if (!pa || !pb) return 0;
    return byDiff(
      (a.size / pa) * (IMAGE_FORMAT_EFFICIENCY[imageExt(a)] ?? 1),
      (b.size / pb) * (IMAGE_FORMAT_EFFICIENCY[imageExt(b)] ?? 1),
      0.03,
    );
  },
  sizeTier(),
];

/** The id of the copy to keep. `files` must not be empty. */
export function pickImageKeep(files: ImageFile[]): number {
  return pick(files, imageTiers);
}

/** `files` with the suggested keeper first; the others keep their order. */
export function keeperFirst<T extends { id: number }>(files: T[], keepId: number): T[] {
  const keeper = files.find((f) => f.id === keepId);
  return keeper ? [keeper, ...files.filter((f) => f !== keeper)] : files;
}

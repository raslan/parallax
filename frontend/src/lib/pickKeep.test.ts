import { describe, expect, it } from "vitest";
import { pickAudioKeep, pickImageKeep, pickVideoKeep } from "./pickKeep";
import type { AudioFile } from "@/types/audio";
import type { VideoFile } from "@/types/file";
import type { ImageFile } from "@/types/image";

function video(id: number, over: Partial<VideoFile> = {}): VideoFile {
  return {
    id,
    library_id: 1,
    path: `/m/${id}.mp4`,
    filename: `${id}.mp4`,
    size: 1000,
    duration: 3600,
    codec_name: "h264",
    video_bitrate: 5_000_000,
    status: "done",
    scanned_at: null,
    transcoded_at: null,
    created_at: "",
    has_thumbnail: false,
    file_width: 1920,
    file_height: 1080,
    file_fps: 24,
    file_date: null,
    file_mtime: null,
    phash: null,
    phash_frames: null,
    byte_hash: null,
    audio_fingerprint: null,
    ...over,
  };
}

function audio(id: number, over: Partial<AudioFile> = {}): AudioFile {
  return {
    id,
    library_id: 1,
    path: `/a/${id}.mp3`,
    filename: `${id}.mp3`,
    extension: ".mp3",
    size: 1000,
    duration: 200,
    codec_name: "mp3",
    bitrate: 128_000,
    sample_rate: 44100,
    channels: 2,
    channel_layout: "stereo",
    file_date: null,
    file_mtime: null,
    status: "done",
    scan_error: null,
    scanned_at: null,
    compressed_at: null,
    created_at: "",
    ...over,
  };
}

function image(id: number, over: Partial<ImageFile> = {}): ImageFile {
  return {
    id,
    library_id: 1,
    path: `/i/${id}.jpg`,
    filename: `${id}.jpg`,
    extension: ".jpg",
    size: 500_000,
    width: 4000,
    height: 3000,
    exif_date: null,
    exif_gps: null,
    exif_camera: null,
    file_mtime: null,
    status: "done",
    scan_error: null,
    scanned_at: null,
    created_at: "",
    has_thumbnail: false,
    detections: [],
    ...over,
  };
}

describe("pickVideoKeep", () => {
  it("prefers the longer copy over a truncated one, even at higher quality", () => {
    expect(
      pickVideoKeep([
        video(1, { duration: 3000, video_bitrate: 20_000_000 }),
        video(2, { duration: 3600 }),
      ]),
    ).toBe(2);
  });

  it("prefers more pixels over a higher bitrate", () => {
    expect(
      pickVideoKeep([
        video(1, { file_width: 1280, file_height: 720, video_bitrate: 12_000_000 }),
        video(2),
      ]),
    ).toBe(2);
  });

  it("weighs bitrate by codec: a lean HEVC beats a bloated H.264 when it is better per bit", () => {
    expect(
      pickVideoKeep([
        video(1, { codec_name: "h264", video_bitrate: 5_000_000 }),
        video(2, { codec_name: "hevc", video_bitrate: 4_000_000 }), // 4 × 1.6 = 6.4 vs 5
      ]),
    ).toBe(2);
  });

  it("falls back to whole-file average rate when a bitrate is missing, for both sides", () => {
    expect(
      pickVideoKeep([
        video(1, { video_bitrate: null, size: 1_000_000_000 }),
        video(2, { video_bitrate: 1_000_000, size: 500_000_000 }),
      ]),
    ).toBe(1);
  });

  it("uses fps when everything else ties", () => {
    expect(pickVideoKeep([video(1, { file_fps: 30 }), video(2, { file_fps: 60 })])).toBe(2);
  });

  it("treats a small quality gap as a tie and falls through to the next tier", () => {
    // Within 3% on weighted bitrate, so fps decides.
    expect(
      pickVideoKeep([
        video(1, { video_bitrate: 5_000_000, file_fps: 60 }),
        video(2, { video_bitrate: 5_100_000, file_fps: 24 }),
      ]),
    ).toBe(1);
  });

  it("does not let a tolerance tie hide a copy that a later tier would rule out", () => {
    // Durations 101.8 / 100 / 100.9 s (ids 1 / 2 / 3). Copy 2 is the shortest by
    // more than the tolerance, so it can never win even with the most pixels.
    // Copies 1 and 3 tie on duration, and 3 has more pixels.
    expect(
      pickVideoKeep([
        video(1, { duration: 3600 * 1.0 + 1.8, file_width: 1280, file_height: 720 }),
        video(2, { duration: 3600 * 1.0 - 100, file_width: 3840, file_height: 2160 }),
        video(3, { duration: 3600 * 1.0 + 0.9, file_width: 1920, file_height: 1080 }),
      ]),
    ).toBe(3);
  });

  it("only ignores about half a percent of duration", () => {
    // 36 s short of an hour-long file is outside the tolerance.
    expect(pickVideoKeep([video(1, { duration: 3564, video_bitrate: 20_000_000 }), video(2)])).toBe(
      2,
    );
  });

  it("keeps the bigger file when everything else ties", () => {
    expect(pickVideoKeep([video(1, { size: 1000 }), video(2, { size: 1100 })])).toBe(2);
  });

  it("keeps the lowest id for perfect copies", () => {
    expect(pickVideoKeep([video(7), video(3), video(5)])).toBe(3);
  });

  it("ignores a tier when a value is unknown", () => {
    expect(
      pickVideoKeep([
        video(1, { file_width: null, file_height: null }),
        video(2, { video_bitrate: 9_000_000 }),
      ]),
    ).toBe(2);
  });

  it("does not depend on the order files arrive in", () => {
    const a = video(1, { video_bitrate: 2_000_000 });
    const b = video(2, { video_bitrate: 8_000_000 });
    expect(pickVideoKeep([a, b])).toBe(pickVideoKeep([b, a]));
  });
});

describe("pickAudioKeep", () => {
  it("prefers lossless over any lossy bitrate", () => {
    expect(
      pickAudioKeep([
        audio(1, { codec_name: "mp3", bitrate: 320_000 }),
        audio(2, { codec_name: "flac", bitrate: 200_000 }),
      ]),
    ).toBe(2);
  });

  it("weighs lossy bitrate by codec", () => {
    expect(
      pickAudioKeep([
        audio(1, { codec_name: "mp3", bitrate: 128_000 }),
        audio(2, { codec_name: "opus", bitrate: 128_000 }), // 1.7 × vs 1 ×
      ]),
    ).toBe(2);
  });

  it("uses sample rate and channels when bitrate ties", () => {
    expect(
      pickAudioKeep([audio(1, { sample_rate: 44100 }), audio(2, { sample_rate: 22050 })]),
    ).toBe(1);
    expect(pickAudioKeep([audio(1, { channels: 1 }), audio(2, { channels: 2 })])).toBe(2);
  });

  it("prefers the longer track", () => {
    expect(
      pickAudioKeep([audio(1, { duration: 180, bitrate: 320_000 }), audio(2, { duration: 200 })]),
    ).toBe(2);
  });

  it("keeps the lowest id for perfect copies", () => {
    expect(pickAudioKeep([audio(4), audio(2)])).toBe(2);
  });
});

describe("pickImageKeep", () => {
  it("prefers more pixels", () => {
    expect(pickImageKeep([image(1, { width: 2000, height: 1500 }), image(2)])).toBe(2);
  });

  it("prefers a lossless format at the same size", () => {
    expect(
      pickImageKeep([
        image(1),
        image(2, { extension: ".png", filename: "2.png", size: 9_000_000 }),
      ]),
    ).toBe(2);
  });

  it("ignores EXIF: a stripped copy can win on quality", () => {
    expect(
      pickImageKeep([
        image(1, {
          size: 200_000,
          exif_date: 1_700_000_000,
          exif_camera: "X100V",
          exif_gps: "1,2",
        }),
        image(2, { size: 900_000 }),
      ]),
    ).toBe(2);
  });

  it("falls back to compression density at the same pixels and format", () => {
    expect(pickImageKeep([image(1, { size: 200_000 }), image(2, { size: 900_000 })])).toBe(2);
  });

  it("keeps the lowest id for perfect copies", () => {
    expect(pickImageKeep([image(9), image(6)])).toBe(6);
  });
});

import { describe, expect, it } from "vitest";
import { clusterAudioDuplicates } from "./clusterAudioDuplicates";
import type { AudioDuplicateCriteria } from "@/types/audioDuplicate";
import type { AudioFile } from "@/types/audio";

const NONE: AudioDuplicateCriteria = {
  use_size: false,
  use_duration: false,
  duration_tolerance: 2,
  use_content_date: false,
  content_date_tolerance: 60,
  use_audio: false,
  audio_threshold: 0.85,
  audio_similarity: 0.75,
  audio_min_stretch: 10,
};

function f(over: Partial<AudioFile>): AudioFile {
  return {
    id: 1,
    library_id: 1,
    path: "/x",
    filename: "x.mp3",
    extension: ".mp3",
    size: 1000,
    duration: 60,
    codec_name: "mp3",
    bitrate: 128000,
    sample_rate: 44100,
    channels: 2,
    channel_layout: "stereo",
    file_date: 1000,
    file_mtime: null,
    status: "done",
    scan_error: null,
    scanned_at: null,
    compressed_at: null,
    created_at: "",
    shared_audio: null,
    ...over,
  };
}

describe("clusterAudioDuplicates", () => {
  it("returns no groups when no criteria enabled", () => {
    const groups = clusterAudioDuplicates([f({ id: 1 }), f({ id: 2 })], NONE);
    expect(groups).toEqual([]);
  });

  it("groups by exact size", () => {
    const files = [f({ id: 1, size: 500 }), f({ id: 2, size: 500 }), f({ id: 3, size: 999 })];
    const groups = clusterAudioDuplicates(files, { ...NONE, use_size: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.files.map((x) => x.id).sort()).toEqual([1, 2]);
  });

  it("groups by duration within tolerance, splits outside", () => {
    const files = [
      f({ id: 1, duration: 60 }),
      f({ id: 2, duration: 61 }),
      f({ id: 3, duration: 90 }),
    ];
    const groups = clusterAudioDuplicates(files, {
      ...NONE,
      use_duration: true,
      duration_tolerance: 2,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.files.map((x) => x.id).sort()).toEqual([1, 2]);
  });

  describe("shared audio", () => {
    const audio = { ...NONE, use_audio: true, audio_threshold: 0.8 };
    // Track 1 is the long one; 2 and 3 are pieces of it that share nothing with each other.
    const tracks = () => [
      f({
        id: 1,
        shared_audio: JSON.stringify([
          [2, 1.0],
          [3, 0.9],
          [4, 0.3],
        ]),
      }),
      f({ id: 2, shared_audio: JSON.stringify([[1, 1.0]]) }),
      f({ id: 3, shared_audio: JSON.stringify([[1, 0.9]]) }),
      f({ id: 4, shared_audio: JSON.stringify([[1, 0.3]]) }),
      f({ id: 5 }),
    ];

    it("groups tracks chained through the one they are inside of, at or above the threshold", () => {
      const groups = clusterAudioDuplicates(tracks(), audio);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.files.map((x) => x.id).sort()).toEqual([1, 2, 3]);
    });

    it("a lower threshold pulls in weaker matches", () => {
      const groups = clusterAudioDuplicates(tracks(), { ...audio, audio_threshold: 0.2 });
      expect(groups[0]!.files.map((x) => x.id).sort()).toEqual([1, 2, 3, 4]);
    });

    it("ignores a missing or malformed value", () => {
      const groups = clusterAudioDuplicates(
        [f({ id: 1, shared_audio: "nope" }), f({ id: 2 })],
        audio,
      );
      expect(groups).toEqual([]);
    });
  });

  it("lists the suggested keeper first, the others in their original order", () => {
    // 3 has the highest bitrate, so it is the keeper; 1, 2 and 4 follow as they came in.
    const files = [
      f({ id: 1, size: 500, bitrate: 128000 }),
      f({ id: 2, size: 500, bitrate: 128000 }),
      f({ id: 3, size: 500, bitrate: 256000 }),
      f({ id: 4, size: 500, bitrate: 128000 }),
    ];
    const groups = clusterAudioDuplicates(files, { ...NONE, use_size: true });
    expect(groups[0]!.keep_id).toBe(3);
    expect(groups[0]!.files.map((x) => x.id)).toEqual([3, 1, 2, 4]);
  });

  it("keep_id picks the higher-bitrate row", () => {
    const files = [
      f({ id: 1, size: 500, bitrate: 128000 }),
      f({ id: 2, size: 500, bitrate: 256000 }),
    ];
    const groups = clusterAudioDuplicates(files, { ...NONE, use_size: true });
    expect(groups[0]!.keep_id).toBe(2);
  });
});

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
    audio_fingerprint: null,
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

  it("groups by fingerprint distance under threshold", () => {
    const a = JSON.stringify([1, 2, 3, 4]);
    const near = JSON.stringify([1, 2, 3, 4]);
    const far = JSON.stringify([~0, ~0, ~0, ~0]);
    const files = [
      f({ id: 1, audio_fingerprint: a }),
      f({ id: 2, audio_fingerprint: near }),
      f({ id: 3, audio_fingerprint: far }),
    ];
    const groups = clusterAudioDuplicates(files, {
      ...NONE,
      use_audio: true,
      audio_threshold: 0.9,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.files.map((x) => x.id).sort()).toEqual([1, 2]);
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

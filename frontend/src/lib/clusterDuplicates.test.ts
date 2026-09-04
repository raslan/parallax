import { describe, expect, it } from "vitest";
import { clusterDuplicates } from "./clusterDuplicates";
import type { DuplicateCriteria } from "@/types/duplicate";
import type { VideoFile } from "@/types/file";

const BASE_CRITERIA: DuplicateCriteria = {
  use_size: false,
  use_duration: false,
  duration_tolerance: 1,
  use_resolution: false,
  use_content_date: false,
  content_date_tolerance: 86400,
  use_orientation: false,
  use_bitrate: false,
  bitrate_tolerance_pct: 10,
  use_filename: false,
  filename_threshold: 0.4,
  use_byte_hash: false,
  use_phash: false,
  phash_threshold: 10,
  phash_mode: "all_frames",
  phash_frames: 16,
  use_audio: false,
  audio_threshold: 0.9,
};

function file(id: number, overrides: Partial<VideoFile> = {}): VideoFile {
  return {
    id,
    library_id: 1,
    path: `/media/file${id}.mp4`,
    filename: `file${id}.mp4`,
    size: 1000,
    duration: 60,
    codec_name: "h264",
    video_bitrate: 5000,
    status: "done",
    scanned_at: null,
    transcoded_at: null,
    created_at: "2026-01-01T00:00:00Z",
    has_thumbnail: false,
    file_width: 1920,
    file_height: 1080,
    file_fps: 24,
    file_date: 0,
    file_mtime: 0,
    phash: null,
    phash_frames: null,
    byte_hash: null,
    audio_fingerprint: null,
    ...overrides,
  };
}

describe("clusterDuplicates", () => {
  it("zero criteria groups the whole library into one group", () => {
    const files = [file(1), file(2), file(3)];
    const groups = clusterDuplicates(files, BASE_CRITERIA);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2, 3]);
  });

  it("zero criteria with a single file still returns one group", () => {
    const groups = clusterDuplicates([file(1)], BASE_CRITERIA);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.files).toHaveLength(1);
  });

  it("size excludes files with a unique size", () => {
    const files = [file(1, { size: 100 }), file(2, { size: 100 }), file(3, { size: 999 })];
    const groups = clusterDuplicates(files, { ...BASE_CRITERIA, use_size: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("duration tolerance clusters within range only", () => {
    const files = [
      file(1, { duration: 60 }),
      file(2, { duration: 60.5 }),
      file(3, { duration: 200 }),
    ];
    const groups = clusterDuplicates(files, {
      ...BASE_CRITERIA,
      use_duration: true,
      duration_tolerance: 1,
    });
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("orientation groups by category not exact dimensions", () => {
    const files = [
      file(1, { file_width: 1920, file_height: 1080 }),
      file(2, { file_width: 1280, file_height: 720 }),
      file(3, { file_width: 1080, file_height: 1920 }),
    ];
    const groups = clusterDuplicates(files, { ...BASE_CRITERIA, use_orientation: true });
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("byte-hash is exact-match, no threshold", () => {
    const files = [
      file(1, { byte_hash: "aaa" }),
      file(2, { byte_hash: "aaa" }),
      file(3, { byte_hash: "bbb" }),
    ];
    const groups = clusterDuplicates(files, { ...BASE_CRITERIA, use_byte_hash: true });
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("byte-hash excludes files with no computed hash yet", () => {
    const files = [file(1, { byte_hash: null }), file(2, { byte_hash: null })];
    const groups = clusterDuplicates(files, { ...BASE_CRITERIA, use_byte_hash: true });
    expect(groups).toHaveLength(0);
  });

  it("pHash all_frames mode compares phash_frames via avg-of-minimums Hamming", () => {
    const framesA = JSON.stringify([0, 0, 0]);
    const framesB = JSON.stringify([1, 0, 0]); // 1 bit off in one frame
    const files = [
      file(1, { phash_frames: framesA }),
      file(2, { phash_frames: framesB }),
      file(3, { phash_frames: JSON.stringify([0xff, 0xff, 0xff]) }),
    ];
    const groups = clusterDuplicates(files, {
      ...BASE_CRITERIA,
      use_phash: true,
      phash_mode: "all_frames",
      phash_threshold: 2,
    });
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("pHash first_frame mode compares the single phash value", () => {
    const files = [
      file(1, { phash: 0b0000 }),
      file(2, { phash: 0b0001 }),
      file(3, { phash: 0b1111 }),
    ];
    const groups = clusterDuplicates(files, {
      ...BASE_CRITERIA,
      use_phash: true,
      phash_mode: "first_frame",
      phash_threshold: 1,
    });
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("filename similarity uses bigramSimilarity", () => {
    const files = [
      file(1, { filename: "Movie.2020.1080p.mkv" }),
      file(2, { filename: "Movie.2020.720p.mkv" }),
      file(3, { filename: "Totally.Unrelated.mkv" }),
    ];
    const groups = clusterDuplicates(files, {
      ...BASE_CRITERIA,
      use_filename: true,
      filename_threshold: 0.5,
    });
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("stages combine as AND — a pair must survive every enabled stage", () => {
    const files = [
      file(1, { size: 100, duration: 60 }),
      file(2, { size: 100, duration: 60.2 }), // matches size AND duration
      file(3, { size: 100, duration: 200 }), // matches size only
    ];
    const groups = clusterDuplicates(files, {
      ...BASE_CRITERIA,
      use_size: true,
      use_duration: true,
      duration_tolerance: 1,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.files.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("singleton groups (no match) are excluded from the result", () => {
    const files = [file(1, { size: 100 }), file(2, { size: 200 })];
    const groups = clusterDuplicates(files, { ...BASE_CRITERIA, use_size: true });
    expect(groups).toHaveLength(0);
  });

  it("picks the highest-bitrate file as keep_id within a group", () => {
    const files = [
      file(1, { size: 100, video_bitrate: 3000 }),
      file(2, { size: 100, video_bitrate: 8000 }),
    ];
    const groups = clusterDuplicates(files, { ...BASE_CRITERIA, use_size: true });
    expect(groups[0]!.keep_id).toBe(2);
  });
});

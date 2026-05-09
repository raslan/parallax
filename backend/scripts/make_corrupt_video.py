#!/usr/bin/env python3
"""
Generate intentionally corrupt video files for testing Refract's corruption
detection and transcoding pipeline.

Creates a valid synthetic video (colour bars + tone via ffmpeg lavfi), then
overwrites random chunks inside the video stream to produce real decode errors.

Usage (from inside the container):
    python3 /app/scripts/make_corrupt_video.py [output_path] [--count N]

Examples:
    python3 /app/scripts/make_corrupt_video.py /media/test_corrupt.mp4
    python3 /app/scripts/make_corrupt_video.py /media/corrupt_ --count 5
"""
import argparse
import os
import random
import shutil
import subprocess
import sys
import tempfile


def make_valid_video(path: str, duration: int = 10) -> None:
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"testsrc=duration={duration}:size=1280x720:rate=25",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
            "-c:v", "libx264", "-crf", "23", "-preset", "fast",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest", path,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("ffmpeg error:", result.stderr[-500:], file=sys.stderr)
        sys.exit(1)


def corrupt_file(path: str, seed: int = 0) -> int:
    """Overwrite random chunks inside the stream data. Returns number of bytes corrupted."""
    size = os.path.getsize(path)
    rng = random.Random(seed)
    total = 0

    with open(path, "r+b") as f:
        # Skip the first 8 KB (container header) and last 4 KB
        safe_start = 8192
        safe_end   = size - 4096

        if safe_end <= safe_start:
            # File too small — corrupt from 20% in
            safe_start = size // 5
            safe_end   = size - 1024

        # Corrupt 4–6 separate regions spread through the stream
        num_regions = rng.randint(4, 6)
        for i in range(num_regions):
            pos = rng.randint(
                safe_start + (safe_end - safe_start) * i // num_regions,
                safe_start + (safe_end - safe_start) * (i + 1) // num_regions,
            )
            length = rng.randint(256, 1024)
            f.seek(pos)
            f.write(bytes(rng.randint(0, 255) for _ in range(length)))
            total += length

    return total


def check_corruption(path: str) -> list[str]:
    """Run the same check as Refract's corruption scanner."""
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostats", "-i", path, "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    return [
        line for line in result.stderr.splitlines()
        if line.startswith("[") and not line.startswith("[null ")
    ]


def make_one(output: str, seed: int) -> bool:
    print(f"  Creating {output} …", end=" ", flush=True)

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        make_valid_video(tmp_path)
        size = os.path.getsize(tmp_path)
        corrupted_bytes = corrupt_file(tmp_path, seed=seed)
        shutil.move(tmp_path, output)
    except Exception as e:
        print(f"FAILED ({e})")
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return False

    errors = check_corruption(output)
    if errors:
        print(f"OK  ({size // 1024:,} KB, {corrupted_bytes} bytes corrupted, {len(errors)} error lines)")
        for e in errors[:2]:
            print(f"         {e.strip()}")
        if len(errors) > 2:
            print(f"         … and {len(errors) - 2} more")
        return True
    else:
        print("WARNING: file created but no errors detected — ffmpeg may not catch this one")
        return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate corrupt test videos for Refract")
    parser.add_argument("output", nargs="?", default="/media/corrupt_test.mp4",
                        help="Output path. With --count, treated as a prefix.")
    parser.add_argument("--count", type=int, default=1,
                        help="Number of files to generate (default: 1)")
    args = parser.parse_args()

    print(f"Generating {args.count} corrupt video file(s)…\n")

    for i in range(args.count):
        if args.count == 1:
            path = args.output
            # Ensure it has an extension
            if not os.path.splitext(path)[1]:
                path += ".mp4"
        else:
            path = f"{args.output}{i + 1:02d}.mp4"

        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        make_one(path, seed=i * 1337)

    print("\nDone. Scan the library in Refract to pick up the new file(s).")


if __name__ == "__main__":
    main()

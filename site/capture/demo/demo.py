#!/usr/bin/env python3
"""Manage the temporary demo library.

    python3 -P site/capture/demo/demo.py reset    # build library/ from pristine/ (clean copy, ~320 MB)
    python3 -P site/capture/demo/demo.py clean    # delete library/ (steady state: only pristine/ on disk)
    python3 -P site/capture/demo/demo.py status   # sizes + whether library/ exists
    python3 -P site/capture/demo/demo.py reset-auth  # forget the demo account (auth shots only)

pristine/ is the single source of truth (derived once by derive.py, whose sources are deleted; see
FIXTURES.md / CREDITS.md for provenance). library/ is what the demo instance mounts; capture runs
may modify it (Compress, Cleanup...), so reset before every run and clean afterwards.
"""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

# The tooling is committed (site/capture/demo/); the media, .env and data/ stay in the gitignored docs/demo/.
HERE = Path(__file__).resolve().parents[3] / "docs" / "demo"
PRISTINE = HERE / "pristine"
LIBRARY = HERE / "library"


def size(p: Path) -> str:
    if not p.exists():
        return "absent"
    out = subprocess.run(["du", "-sh", str(p)], capture_output=True, text=True, check=True).stdout
    return out.split()[0]


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "reset":
        if not PRISTINE.exists():
            sys.exit("pristine/ missing")
        LIBRARY.mkdir(exist_ok=True)
        # No -H: hard links in pristine/ become real separate files, as a scanner expects.
        subprocess.run(["rsync", "-a", "--delete", "--exclude", ".placeholder.mkv",
                        f"{PRISTINE}/", f"{LIBRARY}/"], check=True)
        print(f"library/ ready ({size(LIBRARY)}) at {LIBRARY}")
    elif cmd == "clean":
        shutil.rmtree(LIBRARY, ignore_errors=True)
        print("library/ removed")
    elif cmd == "reset-auth":
        # Forget the demo account (and its sessions) so the setup page can be filmed again.
        db = HERE / "data" / "transcoder.db"
        if not db.exists():
            sys.exit("demo data/transcoder.db missing")
        con = sqlite3.connect(db, timeout=30)
        try:
            con.execute("DELETE FROM auth_sessions")
            con.execute("DELETE FROM users")
            con.commit()
        except sqlite3.OperationalError as e:
            sys.exit(f"nothing to reset ({e}); start the demo with the current image once first")
        finally:
            con.close()
        print("demo account removed")
    elif cmd == "status":
        print(f"pristine/ {size(PRISTINE)}   library/ {size(LIBRARY)}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()

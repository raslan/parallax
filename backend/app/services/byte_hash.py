"""Fast exact-copy detection: hash a couple of byte ranges rather than the
whole file. Two files with the same first + last 1MB are, in practice,
either byte-identical or differ only in a middle region no re-encode would
ever touch — good enough for an opt-in "exact copy" criterion, at a tiny
fraction of the cost of hashing the whole file.
"""

import hashlib
import os

_CHUNK = 1024 * 1024


def compute_byte_hash(path: str) -> str | None:
    try:
        size = os.path.getsize(path)
        h = hashlib.blake2b(digest_size=16)
        with open(path, "rb") as f:
            h.update(f.read(_CHUNK))
            if size > _CHUNK:
                f.seek(max(0, size - _CHUNK))
                h.update(f.read(_CHUNK))
        return h.hexdigest()
    except OSError:
        return None

"""Validate a CTranslate2 OPUS-MT language pack before it goes into the registry.

Three of seven conversions tested during the RAS-72 evaluation were broken (Korean x2, Japanese:
the vocabulary lacked the source language). This script catches that class of defect.

Standalone developer tool, not shipped in the app image. Needs ctranslate2, sentencepiece and
sacrebleu (`pip install ctranslate2 sentencepiece sacrebleu`).

usage:
  python backend/tools/validate_pack.py <pack_dir> --lang ar [--manifest sha256.txt] [--device cpu]

Checks (exit code 1 when any fails):
  files      every file needed at run time exists (and matches --manifest when given)
  vocab      the source language's pieces are present in the model vocabulary, and the
             sentencepiece model does not map ordinary source text to <unk>
  unknown    no unknown-token marker (U+2047) in any translation, including accented/curly-quote
             probes the model's vocabulary may not cover
  script     the output is mostly in the target script
  quality    chrF++ against known reference translations is above the fixture's floor
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "pack_fixtures"
REQUIRED = ("model.bin", "source.spm", "target.spm", "config.json")
UNK_MARK = "⁇"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_manifest(path: Path) -> dict[str, str]:
    """`sha256sum` format: '<hash>  <name>' per line."""
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) == 2:
            out[parts[1].lstrip("*")] = parts[0].lower()
    return out


def load_vocab(pack: Path) -> set[str]:
    for name in ("shared_vocabulary.json", "source_vocabulary.json"):
        p = pack / name
        if p.exists():
            return set(json.loads(p.read_text(encoding="utf-8")))
    raise FileNotFoundError("no shared_vocabulary.json or source_vocabulary.json")


class Report:
    def __init__(self) -> None:
        self.failed = False

    def check(self, name: str, ok: bool, detail: str) -> None:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")
        self.failed |= not ok


def check_files(pack: Path, manifest: Path | None, r: Report) -> bool:
    missing = [f for f in (*REQUIRED,) if not (pack / f).exists()]
    r.check("files", not missing, f"missing {missing}" if missing else "all required files present")
    if missing:
        return False
    if manifest:
        want = parse_manifest(manifest)
        bad = [n for n, h in want.items() if (pack / n).exists() and sha256_of(pack / n) != h]
        absent = [n for n in want if not (pack / n).exists()]
        r.check(
            "sha256",
            not bad and not absent,
            f"mismatch {bad} absent {absent}"
            if bad or absent
            else f"{len(want)} files match the manifest",
        )
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("pack", type=Path)
    ap.add_argument("--lang", required=True, help="fixture name in backend/tools/pack_fixtures/")
    ap.add_argument("--manifest", type=Path)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    fx = json.loads((FIXTURES / f"{args.lang}.json").read_text(encoding="utf-8"))
    r = Report()
    if not check_files(args.pack, args.manifest, r):
        return 1

    import ctranslate2
    import sentencepiece as spm
    from sacrebleu.metrics import CHRF

    sp_src = spm.SentencePieceProcessor(model_file=str(args.pack / "source.spm"))
    sp_tgt = spm.SentencePieceProcessor(model_file=str(args.pack / "target.spm"))
    vocab = load_vocab(args.pack)
    src_texts = [p[0] for p in fx["pairs"]]

    # vocab: the pieces the source model produces must exist in the model's vocabulary
    pieces = [pc for t in src_texts for pc in sp_src.encode(t, out_type=str)]
    absent = sorted({pc for pc in pieces if pc not in vocab})
    unk_ids = sum(i == sp_src.unk_id() for t in src_texts for i in sp_src.encode(t, out_type=int))
    r.check(
        "vocab",
        not absent and unk_ids == 0,
        f"{len(pieces)} source pieces, {len(absent)} not in vocabulary {absent[:5]}, "
        f"{unk_ids} map to <unk>",
    )
    if "</s>" not in vocab or (fx["target_token"] and fx["target_token"] not in vocab):
        r.check("vocab-tokens", False, f"</s> or {fx['target_token']} missing from vocabulary")

    tr = ctranslate2.Translator(str(args.pack), device=args.device)
    tag = [fx["target_token"]] if fx.get("target_token") else []

    def translate(texts: list[str]) -> list[str]:
        batch = [tag + sp_src.encode(t, out_type=str) + ["</s>"] for t in texts]
        res = tr.translate_batch(batch, beam_size=4, max_batch_size=32, max_decoding_length=300)
        return [sp_tgt.decode(x.hypotheses[0]) for x in res]

    hyp = translate(src_texts)
    probes = translate(fx.get("unicode_probes", []))

    # unknown markers, on the clean sentences and on the accented probes after folding
    bad = [h for h in hyp if UNK_MARK in h]
    r.check("unknown", not bad, f"{len(bad)} of {len(hyp)} translations carry U+2047")
    if probes:
        pbad = [h for h in probes if UNK_MARK in h]
        print(
            f"[INFO] unicode probes with U+2047 before folding: {len(pbad)} of {len(probes)} "
            "(the app folds such characters before translating)"
        )

    rx = re.compile(fx["script_regex"])
    ratios = []
    for h in hyp:
        letters = [c for c in h if c.isalpha()]
        ratios.append(sum(bool(rx.match(c)) for c in letters) / max(len(letters), 1))
    mean_ratio = sum(ratios) / len(ratios)
    floor = fx["min_script_ratio"]
    r.check(
        "script",
        mean_ratio >= floor,
        f"{mean_ratio:.0%} of letters in the target script (floor {floor:.0%})",
    )

    chrf = CHRF(word_order=2).corpus_score(hyp, [[p[1] for p in fx["pairs"]]]).score
    r.check("quality", chrf >= fx["min_chrf"], f"chrF++ {chrf:.1f} (floor {fx['min_chrf']})")

    for s, h in zip(src_texts, hyp):
        print(f"   {s}\n   -> {h}")
    print("RESULT:", "FAIL" if r.failed else "PASS")
    return 1 if r.failed else 0


if __name__ == "__main__":
    sys.exit(main())

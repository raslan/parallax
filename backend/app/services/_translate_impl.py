"""Runs inside the translation worker process: loads a CTranslate2 OPUS-MT model and translates.

Kept apart from `translator.py` (the main-process proxy) so importing the app never imports
ctranslate2. Models are cached per (pack folder, device, device index) for the life of the
worker; dropping the worker is what frees the memory (and any GPU context).
"""

import os

_models: dict[tuple, tuple] = {}


def _load(pack_dir: str, device: str, device_index: int) -> tuple:
    key = (pack_dir, device, device_index)
    if key not in _models:
        import ctranslate2
        import sentencepiece as spm

        _models[key] = (
            ctranslate2.Translator(
                pack_dir,
                device=device,
                device_index=device_index,
                intra_threads=os.cpu_count() or 4,
            ),
            spm.SentencePieceProcessor(model_file=os.path.join(pack_dir, "source.spm")),
            spm.SentencePieceProcessor(model_file=os.path.join(pack_dir, "target.spm")),
        )
    return _models[key]


def translate_batch(
    pack_dir: str,
    target_token: str | None,
    texts: list[str],
    beam_size: int = 4,
    device: str = "cpu",
    device_index: int = 0,
) -> list[str]:
    """Translate one batch of English lines. The target-language token goes in as a single
    token (as text, sentencepiece would split it and the output would start with garbage)."""
    from app.services.translate_text import fold_unknown

    translator, sp_src, sp_tgt = _load(pack_dir, device, device_index)
    unk = sp_src.unk_id()

    def is_unknown(s: str) -> bool:
        return unk in sp_src.encode(s, out_type=int)

    batch = [
        # a model with one target language (en-de, en-fr, ...) takes no language token
        ([target_token] if target_token else [])
        + sp_src.encode(fold_unknown(t, is_unknown), out_type=str)
        + ["</s>"]
        for t in texts
    ]
    results = translator.translate_batch(
        batch, beam_size=beam_size, max_batch_size=32, max_decoding_length=300
    )
    return [sp_tgt.decode(r.hypotheses[0]) for r in results]

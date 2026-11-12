import os

import pytest

from app.services import translate_packs as tp
from app.services import translator as tr

PACK = {"lang": "xx", "target_token": ">>xx<<"}


class FakePool:
    def __init__(self):
        self.batches = []

    def submit_cancellable(self, fn, pack_dir, token, texts, beam, device, index, *, is_cancelled):
        self.batches.append(list(texts))
        return [t.upper() for t in texts]

    def release(self):
        pass


@pytest.fixture
def pool(monkeypatch, tmp_path):
    p = FakePool()
    monkeypatch.setattr(tr, "_pool", p)
    monkeypatch.setattr(tp, "PACKS_DIR", str(tmp_path))
    return p


def test_order_is_kept_blank_cues_skipped_and_batches_are_32(pool):
    texts = [f"line {i}" for i in range(70)] + ["", "  "]
    out = tr.translate_texts(PACK, texts, lambda: False)
    assert out[:70] == [t.upper() for t in texts[:70]]
    assert out[70:] == ["", ""]
    assert [len(b) for b in pool.batches] == [32, 32, 6]


def test_progress_counts_translated_lines(pool):
    seen = []
    tr.translate_texts(
        PACK, ["a", "b", ""], lambda: False, on_progress=lambda d, t: seen.append((d, t))
    )
    assert seen == [(2, 2)]


def test_cancel_lands_between_batches(pool):
    calls = {"n": 0}

    def cancelled():
        calls["n"] += 1
        return calls["n"] > 1  # lets the first batch through (the fake pool never polls)

    with pytest.raises(tr.TranslationCancelled):
        tr.translate_texts(PACK, [f"t{i}" for i in range(100)], cancelled)
    assert len(pool.batches) == 1


def test_a_terminated_worker_becomes_a_cancel(monkeypatch, tmp_path):
    from app.services.worker_common import WorkerCancelled

    class Dying(FakePool):
        def submit_cancellable(self, *a, **k):
            raise WorkerCancelled()

    monkeypatch.setattr(tr, "_pool", Dying())
    monkeypatch.setattr(tp, "PACKS_DIR", str(tmp_path))
    with pytest.raises(tr.TranslationCancelled):
        tr.translate_texts(PACK, ["a"], lambda: False)


@pytest.mark.skipif(
    not os.path.exists("/packs/ar/model.bin"), reason="Arabic pack not available offline"
)
def test_real_arabic_model_translates_without_unknown_markers():
    from app.services import _translate_impl as impl

    out = impl.translate_batch(
        "/packs/ar", ">>ara<<", ["Where are you going?", "I don't know what to do."]
    )
    assert all("⁇" not in t for t in out)
    assert all(any("؀" <= c <= "ۿ" for c in t) for t in out)

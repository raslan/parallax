import threading
import time

from app.services import item_runner as ir
from app.services.gpu_pool import GPUDevice


def cards(n: int) -> list[GPUDevice]:
    return [GPUDevice("nvidia", str(i), f"GPU {i}", "nvenc") for i in range(n)]


def run(items, work, devices=(), cancelled=lambda: False, **kw):
    logs, progress = [], {}
    out = ir.run_items(
        items,
        work,
        list(devices),
        cancelled,
        on_progress=lambda i, f: progress.__setitem__(i, f),
        on_log=lambda m, lvl: logs.append((lvl, m)),
        poll=0.02,
        **kw,
    )
    return out, logs, progress


def test_cpu_runs_one_after_another_in_order():
    seen = []

    def work(i, item, ctx):
        seen.append((i, ctx.device, ctx.device_index))
        ctx.progress(100.0)
        return {"n": i}

    out, _, progress = run([{}, {}, {}], work)
    assert seen == [(0, "cpu", 0), (1, "cpu", 0), (2, "cpu", 0)]
    assert [o.status for o in out] == ["done"] * 3 and out[2].result == {"n": 2}
    assert progress == {0: 100.0, 1: 100.0, 2: 100.0}


def test_two_files_run_at_once_on_two_cards_and_one_card_each():
    both_started = threading.Barrier(2, timeout=5)
    used = {}

    def work(i, item, ctx):
        used[i] = (ctx.device, ctx.device_index)
        both_started.wait()  # only passes if both run side by side
        return {}

    out, _, _ = run([{}, {}], work, cards(2))
    assert [o.status for o in out] == ["done", "done"]
    assert sorted(used.values()) == [("cuda", 0), ("cuda", 1)]


def test_slider_at_one_uses_only_that_card_and_never_two_files_at_once():
    active, peak, devs = 0, 0, set()
    lock = threading.Lock()

    def work(i, item, ctx):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            devs.add(ctx.device_index)
        time.sleep(0.05)
        with lock:
            active -= 1
        return {}

    out, _, _ = run([{}] * 4, work, cards(1))
    assert all(o.status == "done" for o in out)  # the card is released after every file
    assert peak == 1 and devs == {0}


def test_init_error_retries_on_the_other_card_and_degrades_the_first():
    attempts = []

    def work(i, item, ctx):
        attempts.append((i, ctx.device, ctx.device_index))
        if ctx.device_index == 0:
            raise RuntimeError("CUDA failed with error unknown error")
        return {}

    out, logs, _ = run([{}, {}], work, cards(2))
    assert all(o.status == "done" for o in out)
    # card 0 failed once; it is out of rotation, so the next file goes straight to card 1
    on_zero = [a for a in attempts if a[2] == 0 and a[1] == "cuda"]
    assert len(on_zero) == 1
    assert any("retrying on GPU 1" in m for _, m in logs)


def test_out_of_memory_falls_back_to_cpu_and_does_not_degrade_the_card():
    attempts = []

    def work(i, item, ctx):
        attempts.append((i, ctx.device))
        if ctx.device == "cuda" and i == 0:
            raise RuntimeError("CUDA failed with error out of memory")
        return {}

    out, logs, _ = run([{}, {}], work, cards(1))
    assert all(o.status == "done" for o in out)
    assert attempts == [(0, "cuda"), (0, "cpu"), (1, "cuda")]  # the card is still used afterwards
    assert any("out of memory" in m for _, m in logs)


def test_every_card_failing_ends_on_the_cpu():
    attempts = []

    def work(i, item, ctx):
        attempts.append(ctx.device)
        if ctx.device == "cuda":
            raise RuntimeError("Library libcudnn_ops.so.9 is not found or cannot be loaded")
        return {"ran": "cpu"}

    out, logs, _ = run([{}], work, cards(2))
    assert out[0].status == "done" and out[0].result == {"ran": "cpu"}
    assert attempts == ["cuda", "cuda", "cpu"]
    assert any("on the CPU" in m for _, m in logs)


def test_a_single_card_install_goes_straight_to_cpu_after_an_init_error():
    attempts = []

    def work(i, item, ctx):
        attempts.append(ctx.device)
        if ctx.device == "cuda":
            raise RuntimeError("cuda driver version is insufficient for cuda runtime version")
        return {}

    out, _, _ = run([{}], work, cards(1))
    assert out[0].status == "done" and attempts == ["cuda", "cpu"]


def test_an_expected_failure_is_not_retried_anywhere():
    attempts = []

    def work(i, item, ctx):
        attempts.append(ctx.device)
        raise ir.ItemFailed("No English subtitle found.")

    out, _, _ = run([{}], work, cards(2))
    assert out[0].status == "failed" and out[0].error == "No English subtitle found."
    assert attempts == ["cuda"]


def test_an_unexpected_crash_costs_one_file_only():
    def work(i, item, ctx):
        if i == 0:
            raise ValueError("boom")
        return {}

    out, _, _ = run([{}, {}], work, generic_error="Translation failed.")
    assert (out[0].status, out[0].error) == ("failed", "Translation failed.")
    assert out[1].status == "done"


def test_cancel_stops_running_work_and_drops_files_that_have_not_started():
    flag = {"cancel": False}
    started = []

    def work(i, item, ctx):
        started.append(i)
        flag["cancel"] = True  # the user cancels while file 0 runs
        while True:
            time.sleep(0.01)
            raise ir.ItemCancelled()

    out, _, _ = run([{}, {}, {}], work, cancelled=lambda: flag["cancel"])
    assert out[0].status == "cancelled"
    assert [o.status for o in out[1:]] == ["skipped", "skipped"]
    assert started == [0]


def test_a_running_file_on_each_of_two_cards_both_stop_on_cancel():
    flag = {"cancel": False}
    ready = threading.Barrier(2, timeout=5)

    def work(i, item, ctx):
        ready.wait()
        flag["cancel"] = True
        raise ir.ItemCancelled()

    out, _, _ = run([{}, {}, {}], work, cards(2), cancelled=lambda: flag["cancel"])
    assert [o.status for o in out[:2]] == ["cancelled", "cancelled"]
    assert out[2].status == "skipped"

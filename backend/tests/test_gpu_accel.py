import os

import pytest

from app.services import gpu_accel as ga
from app.services.gpu_pool import GPUDevice


def cards(n):
    return [GPUDevice("nvidia", str(i), f"GPU {i}", "nvenc") for i in range(n)]


def test_init_errors_are_told_apart_from_out_of_memory():
    for text in (
        "Library libcudnn_ops.so.9 is not found or cannot be loaded",
        "CUDA failed with error unknown error",
        "CUDA driver version is insufficient for CUDA runtime version",
        "no CUDA-capable device is detected",
        "Library libcublas.so.12 is not found or cannot be loaded",
    ):
        assert ga.is_device_init_error(text), text
        assert not ga.is_oom(text)
    oom = "CUDA failed with error out of memory"
    assert ga.is_oom(oom) and not ga.is_device_init_error(oom)
    assert not ga.is_device_init_error("ValueError: bad input")
    assert not ga.is_device_init_error("")


def test_no_cards_unless_installed_and_switched_on(monkeypatch):
    monkeypatch.setattr(ga, "nvidia_devices", lambda: cards(2))
    monkeypatch.setattr(ga, "installed", lambda: False)
    assert ga.job_devices(True, 0) == []
    monkeypatch.setattr(ga, "installed", lambda: True)
    assert ga.job_devices(False, 0) == []
    assert [d.index for d in ga.job_devices(True, 0)] == ["0", "1"]  # default: all cards


def test_the_slider_limits_jobs_to_the_first_cards(monkeypatch):
    monkeypatch.setattr(ga, "nvidia_devices", lambda: cards(3))
    monkeypatch.setattr(ga, "installed", lambda: True)
    assert [d.index for d in ga.job_devices(True, 1)] == ["0"]
    assert [d.index for d in ga.job_devices(True, 2)] == ["0", "1"]
    assert len(ga.job_devices(True, 9)) == 3


def test_apply_env_puts_the_libraries_on_the_path_once(tmp_path, monkeypatch):
    lib = tmp_path / "nvidia" / "cudnn" / "lib"
    lib.mkdir(parents=True)
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(tmp_path))
    monkeypatch.setenv("LD_LIBRARY_PATH", "/usr/lib")
    ga.apply_env()
    ga.apply_env()
    assert os.environ["LD_LIBRARY_PATH"] == f"{lib}:/usr/lib"
    assert ga.installed()


def test_install_swaps_in_only_a_complete_download(tmp_path, monkeypatch):
    target = tmp_path / "nvidia"
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(target))
    monkeypatch.setenv("LD_LIBRARY_PATH", "")
    script = (
        "import os,sys;t=sys.argv[sys.argv.index('--target')+1];"
        "d=os.path.join(t,'nvidia','cublas','lib');os.makedirs(d);open(os.path.join(d,'libx.so'),'w').write('x')"
    )
    import sys

    seen = []
    ga.install(
        seen.append,
        lambda: False,
        pip_cmd=[sys.executable, "-c", script, "--target", str(target) + ".installing"],
    )
    assert ga.installed() and seen[-1] == 100.0
    assert not os.path.exists(str(target) + ".installing")
    assert ga.remove() is True and not ga.installed()


def test_a_failed_download_leaves_the_old_install_alone(tmp_path, monkeypatch):
    target = tmp_path / "nvidia"
    (target / "nvidia" / "cublas" / "lib").mkdir(parents=True)
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(target))
    import sys

    with pytest.raises(ga.NvidiaInstallError, match="did not finish"):
        ga.install(
            lambda p: None, lambda: False, pip_cmd=[sys.executable, "-c", "raise SystemExit(3)"]
        )
    assert ga.installed()  # the previous install still works
    assert not os.path.exists(str(target) + ".installing")


def test_cancelling_an_install_leaves_nothing(tmp_path, monkeypatch):
    target = tmp_path / "nvidia"
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(target))
    import sys

    with pytest.raises(ga.NvidiaInstallCancelled):
        ga.install(
            lambda p: None,
            lambda: True,
            pip_cmd=[sys.executable, "-c", "import time; time.sleep(30)"],
        )
    assert not target.exists() and not os.path.exists(str(target) + ".installing")


def test_check_says_it_is_not_installed(tmp_path, monkeypatch):
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(tmp_path / "none"))
    r = ga.check()
    assert r["ok"] is False and "not installed" in r["message"]


def test_a_swap_that_fails_puts_the_old_install_back(tmp_path, monkeypatch):
    import sys

    target = tmp_path / "nvidia"
    (target / "nvidia" / "cublas" / "lib").mkdir(parents=True)
    (target / "nvidia" / "cublas" / "lib" / "old.so").write_text("old")
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(target))
    script = (
        "import os,sys;t=sys.argv[sys.argv.index('--target')+1];"
        "d=os.path.join(t,'nvidia','cublas','lib');os.makedirs(d);"
        "open(os.path.join(d,'new.so'),'w').write('x')"
    )
    real = os.replace

    def flaky(src, dst):
        if str(src).endswith(".installing"):
            raise OSError(28, "No space left on device")
        return real(src, dst)

    monkeypatch.setattr(os, "replace", flaky)
    with pytest.raises(ga.NvidiaInstallError, match="in place"):
        ga.install(
            lambda p: None,
            lambda: False,
            pip_cmd=[sys.executable, "-c", script, "--target", str(target) + ".installing"],
        )
    assert (target / "nvidia" / "cublas" / "lib" / "old.so").exists()
    assert ga.installed() and not os.path.exists(str(target) + ".old")


def test_the_check_environment_has_no_empty_library_path_entry(monkeypatch, tmp_path):
    lib = tmp_path / "nvidia" / "cudnn" / "lib"
    lib.mkdir(parents=True)
    monkeypatch.setattr(ga, "NVIDIA_DIR", str(tmp_path))
    monkeypatch.delenv("LD_LIBRARY_PATH", raising=False)
    seen = {}

    def fake_run(cmd, env, **kw):
        seen["path"] = env["LD_LIBRARY_PATH"]

        class R:
            returncode, stdout, stderr = 0, '{"devices": 1, "types": ["float16"]}', ""

        return R()

    monkeypatch.setattr(ga.subprocess, "run", fake_run)
    monkeypatch.setattr(ga, "nvidia_devices", lambda: cards(1))
    assert ga.check()["ok"] is True
    assert seen["path"] == str(lib)  # no trailing ":" (an empty entry means the current folder)

"""Optional NVIDIA acceleration for translation and speech-to-text (RAS-127).

The CTranslate2 wheel is the same for CPU and GPU; a GPU run only needs the CUDA 12 math
libraries (cuBLAS and cuDNN, about 2 GB, no torch) to be findable. They are installed on demand
into `DATA_DIR/nvidia` (pip `--target`, atomic swap, update = reinstall, remove = delete the
folder), exactly like the gallery-dl nightly, so the image stays one image. NVIDIA only; nothing
here detects a vendor for the user to guess: the Hardware tab shows what was found.

`apply_env()` puts the library folders on `LD_LIBRARY_PATH` of this process. The workers are
spawned (a fresh interpreter that inherits the environment at spawn time) so it must run before
the first worker starts; `main.py` calls it at boot and the installer calls it after an install.
"""

import glob
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from importlib import metadata

from app.database import DATA_DIR
from app.services.gpu_pool import GPUDevice, detect_gpus

logger = logging.getLogger(__name__)

NVIDIA_DIR = os.path.join(DATA_DIR, "nvidia")
# cuDNN 9 for CUDA 12 is what CTranslate2 4.x is built against; CUDA 12.9 libraries cover
# Blackwell (RTX 50 series, compute 12.0), which needs 12.8 or newer. Both versions exist on PyPI.
PACKAGES = ("nvidia-cublas-cu12==12.9.1.4", "nvidia-cudnn-cu12==9.10.2.21")
EXPECTED_BYTES = 2_100_000_000  # for the progress estimate only

SETTING_ENABLED = "gpu_accel_enabled"  # "true" (default) / "false"
SETTING_COUNT = "gpu_accel_count"  # how many cards to use; 0 or missing = all of them


class NvidiaInstallError(Exception):
    """The install failed (message is user-facing)."""


class NvidiaInstallCancelled(Exception):
    pass


def installed() -> bool:
    return bool(lib_dirs())


def lib_dirs() -> list[str]:
    """Every `nvidia/*/lib` folder of the installed package."""
    return sorted(glob.glob(os.path.join(NVIDIA_DIR, "nvidia", "*", "lib")))


def installed_bytes() -> int:
    total = 0
    for root, _dirs, files in os.walk(NVIDIA_DIR):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def installed_versions() -> dict[str, str]:
    """{'nvidia-cublas-cu12': '12.9.1.4', ...} from the install's own metadata."""
    out: dict[str, str] = {}
    for dist in metadata.distributions(path=[NVIDIA_DIR]):
        name = dist.metadata["Name"]
        if name and name.lower().startswith("nvidia-"):
            out[name.lower()] = dist.version
    return out


def apply_env() -> None:
    """Make the installed libraries findable by processes spawned from now on. Idempotent."""
    dirs = lib_dirs()
    if not dirs:
        return
    current = [p for p in os.environ.get("LD_LIBRARY_PATH", "").split(":") if p]
    missing = [d for d in dirs if d not in current]
    if missing:
        os.environ["LD_LIBRARY_PATH"] = ":".join([*missing, *current])


def nvidia_devices() -> list[GPUDevice]:
    return [d for d in detect_gpus() if d.vendor == "nvidia"]


def job_devices(enabled: bool, count: int) -> list[GPUDevice]:
    """The cards translation and speech jobs may use: none unless the package is installed and
    the switch is on; otherwise the first `count` NVIDIA cards (0 = all)."""
    if not enabled or not installed():
        return []
    cards = nvidia_devices()
    return cards[:count] if count > 0 else cards


def read_settings(db) -> tuple[bool, int]:
    from app.models.settings import get_setting

    enabled = get_setting(db, SETTING_ENABLED, "true") == "true"
    try:
        count = int(get_setting(db, SETTING_COUNT, "0"))
    except ValueError:
        count = 0
    return enabled, max(0, count)


# ---- failure classification (the same idea as gpu_pool.is_hwaccel_failure) -----------------

_OOM_RE = re.compile(r"out of memory|\boom\b|cudaErrorMemoryAllocation", re.IGNORECASE)
_INIT_RE = re.compile(
    r"cuda driver version is insufficient"
    r"|no cuda[- ]capable device"
    r"|cuda failed with error (?!out of memory)"
    r"|cudaErrorInitialization|cudaErrorNoDevice|cudaErrorInsufficientDriver"
    r"|lib(?:cudnn|cublas|cudart|nvrtc)\S* is not found or cannot be loaded"
    r"|cannot load \S*lib(?:cudnn|cublas|cudart)"
    r"|unsupported device cuda"
    r"|cuda\w* (?:initiali[sz]ation|init) (?:failed|error)",
    re.IGNORECASE,
)


def is_oom(text: str) -> bool:
    return bool(text) and bool(_OOM_RE.search(text))


def is_device_init_error(text: str) -> bool:
    """True when the error names a CUDA / device-initialisation problem specifically (a broken
    card or missing library), not an out-of-memory or an ordinary failure."""
    return bool(text) and not is_oom(text) and bool(_INIT_RE.search(text))


# ---- install / update / remove --------------------------------------------------------------


def remove() -> bool:
    if not os.path.isdir(NVIDIA_DIR):
        return False
    shutil.rmtree(NVIDIA_DIR)
    return True


def install(
    progress: Callable[[float], None],
    is_cancelled: Callable[[], bool],
    packages: tuple[str, ...] = PACKAGES,
    pip_cmd: list[str] | None = None,
) -> None:
    """`pip install --target` into a staging folder, then swap it into place (so an interrupted
    or failed install never leaves a half-installed package, and an update keeps working until
    the new one is complete). Progress is the staging folder's size against the known total."""
    staging = NVIDIA_DIR + ".installing"
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging)
    cmd = pip_cmd or [
        sys.executable, "-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check",
        "--target", staging, *packages,
    ]  # fmt: skip
    log_path = staging + ".log"
    try:
        with open(log_path, "w") as log_file:
            proc = subprocess.Popen(
                cmd, stdout=log_file, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL
            )
            try:
                while proc.poll() is None:
                    if is_cancelled():
                        proc.kill()
                        proc.wait()
                        raise NvidiaInstallCancelled()
                    done = sum(
                        os.path.getsize(os.path.join(r, f))
                        for r, _d, fs in os.walk(staging)
                        for f in fs
                        if os.path.exists(os.path.join(r, f))
                    )
                    progress(min(95.0, done / EXPECTED_BYTES * 100))
                    time.sleep(1.0)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
        if proc.returncode != 0:
            with open(log_path, errors="replace") as f:
                tail = " ".join(f.read().strip().splitlines()[-3:])
            raise NvidiaInstallError(f"The download did not finish: {tail[:300]}")
        if not glob.glob(os.path.join(staging, "nvidia", "*", "lib")):
            raise NvidiaInstallError("The download finished but contains no libraries.")
        # Swap with the old install set aside first, so a half-removed tree can never be left
        # in place, and the old one comes back if the swap fails.
        aside = NVIDIA_DIR + ".old"
        shutil.rmtree(aside, ignore_errors=True)
        had_old = os.path.isdir(NVIDIA_DIR)
        if had_old:
            os.replace(NVIDIA_DIR, aside)
        try:
            os.replace(staging, NVIDIA_DIR)
        except OSError as e:
            if had_old:
                os.replace(aside, NVIDIA_DIR)
            raise NvidiaInstallError(f"Could not put the new files in place: {e.strerror}") from e
        shutil.rmtree(aside, ignore_errors=True)
        apply_env()
        progress(100.0)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        if os.path.exists(log_path):
            os.remove(log_path)


# ---- the Check button -----------------------------------------------------------------------

_CHECK_SCRIPT = (
    "import json, ctranslate2 as c;"
    "n = c.get_cuda_device_count();"
    "t = c.get_supported_compute_types('cuda') if n else [];"
    "print(json.dumps({'devices': n, 'types': sorted(t)}))"
)


def check() -> dict:
    """A tiny CUDA test in a fresh process with the installed libraries on its path. Says what
    works, or what to fix (missing libraries, or the container not exposing the card)."""
    seen = len(nvidia_devices())
    if not installed():
        return {"ok": False, "devices": 0, "message": "The NVIDIA package is not installed."}
    env = dict(os.environ)
    old = [p for p in env.get("LD_LIBRARY_PATH", "").split(":") if p]  # an empty entry means "."
    env["LD_LIBRARY_PATH"] = ":".join([*lib_dirs(), *old])
    try:
        out = subprocess.run(
            [sys.executable, "-c", _CHECK_SCRIPT],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "devices": 0, "message": "The GPU test timed out."}
    if out.returncode != 0:
        tail = " ".join((out.stderr or out.stdout).strip().splitlines()[-2:])
        return {"ok": False, "devices": 0, "message": f"The GPU test failed: {tail[:300]}"}
    try:
        data = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"ok": False, "devices": 0, "message": "The GPU test gave no answer."}
    if data["devices"] == 0:
        hint = (
            " nvidia-smi sees a card, so the container is probably not exposing it to CUDA: add "
            "the `compute` capability to the NVIDIA device in the compose file."
            if seen
            else " No NVIDIA card was found."
        )
        return {"ok": False, "devices": 0, "message": "CUDA sees no card." + hint}
    return {
        "ok": True,
        "devices": data["devices"],
        "message": (
            f"CUDA works: {data['devices']} card(s), " f"compute types {', '.join(data['types'])}."
        ),
    }


def run_install_job(job_id: int) -> None:
    """Queue job body: install or update the NVIDIA package, with progress and cancel on the
    Jobs page. An update is the same call (the old install keeps working until the new one is
    complete)."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import arm_cancel, clear_cancel, fail_job, log, now, should_cancel

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None or job.status == JobStatus.CANCELLED:
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        job.current_file = "NVIDIA acceleration package"
        db.commit()
        arm_cancel(job_id)
        log(db, job_id, "Downloading the NVIDIA CUDA libraries (about 2 GB)")
        last = {"pct": 0.0}

        def on_progress(pct: float) -> None:
            if pct - last["pct"] >= 1.0 or pct >= 100.0:
                last["pct"] = pct
                job.progress = pct
                db.commit()

        try:
            install(on_progress, lambda: should_cancel(job_id))
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            log(db, job_id, "Installed. Press Check to test it.")
        except NvidiaInstallCancelled:
            job.status = JobStatus.CANCELLED
            log(db, job_id, "Cancelled; nothing was changed.")
        job.current_file = None
        job.finished_at = now()
        db.commit()
    except NvidiaInstallError as e:
        db.rollback()
        job = db.get(Job, job_id)
        if job:
            fail_job(db, job, e)
            log(db, job_id, str(e), "error")
    except Exception as e:
        logger.exception("NVIDIA package install failed")
        db.rollback()
        job = db.get(Job, job_id)
        if job:
            fail_job(db, job, e)
    finally:
        clear_cancel(job_id)
        db.close()

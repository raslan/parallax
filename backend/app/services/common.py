"""Shared state for background job workers."""

# job_id → True means "please stop at next checkpoint"
_cancel_flags: dict[int, bool] = {}


def request_cancel(job_id: int) -> None:
    _cancel_flags[job_id] = True


def should_cancel(job_id: int) -> bool:
    return _cancel_flags.get(job_id, False)


def clear_cancel(job_id: int) -> None:
    _cancel_flags.pop(job_id, None)


def arm_cancel(job_id: int) -> None:
    """Mark job as cancellable — only if a cancel hasn't already been requested."""
    if not _cancel_flags.get(job_id, False):
        _cancel_flags[job_id] = False

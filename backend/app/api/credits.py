from fastapi import APIRouter

from app.services.credits import credits_for

router = APIRouter(prefix="/credits", tags=["credits"])


@router.get("")
def get_credits():
    """Everything Parallax uses, ships or adapts, with licences. Shown in Settings → Credits."""
    return credits_for("app")

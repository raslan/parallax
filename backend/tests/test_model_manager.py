def test_nudenet_model_registry():
    from app.services.model_manager import NUDENET_MODELS

    assert "320n" in NUDENET_MODELS
    assert "640m" in NUDENET_MODELS
    assert NUDENET_MODELS["320n"]["bundled"] is True
    assert NUDENET_MODELS["640m"]["bundled"] is False
    assert NUDENET_MODELS["320n"]["inference_resolution"] == 320
    assert NUDENET_MODELS["640m"]["inference_resolution"] == 640


def test_is_nudenet_downloaded_bundled():
    from app.services.model_manager import is_nudenet_downloaded

    # 320n is bundled — always reports downloaded
    assert is_nudenet_downloaded("320n") is True

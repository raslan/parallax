import os, pytest

def test_clip_model_registry():
    from app.services.model_manager import CLIP_MODELS
    assert "clip-vit-base-patch32" in CLIP_MODELS
    assert "clip-vit-large-patch14" in CLIP_MODELS
    b32 = CLIP_MODELS["clip-vit-base-patch32"]
    assert b32["hf_repo"] == "Xenova/clip-vit-base-patch32"
    l14 = CLIP_MODELS["clip-vit-large-patch14"]
    assert l14["hf_repo"] == "Xenova/clip-vit-large-patch14"

def test_nudenet_model_registry():
    from app.services.model_manager import NUDENET_MODELS
    assert "320n" in NUDENET_MODELS
    assert "640m" in NUDENET_MODELS
    assert NUDENET_MODELS["320n"]["bundled"] is True
    assert NUDENET_MODELS["640m"]["bundled"] is False
    assert NUDENET_MODELS["320n"]["inference_resolution"] == 320
    assert NUDENET_MODELS["640m"]["inference_resolution"] == 640

def test_clip_path_helpers(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib, app.services.model_manager as mm
    importlib.reload(mm)
    p = mm.clip_vision_path("clip-vit-base-patch32")
    assert p.endswith("clip/clip-vit-base-patch32/vision.onnx")

def test_is_nudenet_downloaded_bundled():
    from app.services.model_manager import is_nudenet_downloaded
    # 320n is bundled — always reports downloaded
    assert is_nudenet_downloaded("320n") is True

def test_is_clip_downloaded_false(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib, app.services.model_manager as mm
    importlib.reload(mm)
    assert mm.is_clip_downloaded("clip-vit-large-patch14") is False

def test_migrate_legacy_clip_moves_files(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib, app.services.model_manager as mm
    importlib.reload(mm)

    legacy_clip = os.path.join(str(tmp_path), "models", "clip")
    os.makedirs(legacy_clip)
    open(os.path.join(legacy_clip, "vision.onnx"), "w").close()
    open(os.path.join(legacy_clip, "text.onnx"), "w").close()

    mm.migrate_legacy_clip()
    assert os.path.exists(mm.clip_vision_path("clip-vit-base-patch32"))
    assert os.path.exists(mm.clip_text_path("clip-vit-base-patch32"))
    assert not os.path.exists(os.path.join(legacy_clip, "vision.onnx"))
    assert not os.path.exists(os.path.join(legacy_clip, "text.onnx"))

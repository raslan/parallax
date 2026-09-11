from app.services.compressor import _build_compress_cmd, _resolve_encoder
from app.services.gpu_pool import GPUDevice


def _nvidia(index="0"):
    return GPUDevice(vendor="nvidia", index=index, label="card", family="nvenc")


def _amd(index="/dev/dri/renderD128"):
    return GPUDevice(vendor="amd", index=index, label="renderD128", family="vaapi")


def test_resolve_encoder_picks_by_codec():
    assert _resolve_encoder("h264") in (
        "h264_nvenc",
        "h264_qsv",
        "h264_amf",
        "h264_vaapi",
        "libx264",
    )
    assert _resolve_encoder("hevc") in (
        "hevc_nvenc",
        "hevc_qsv",
        "hevc_amf",
        "hevc_vaapi",
        "libx265",
    )


def test_build_cmd_nvenc_no_gpu_omits_device_pinning(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "h264_nvenc", "hevc": "hevc_nvenc"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=None)

    assert "-hwaccel_device" not in cmd
    assert "-gpu" not in cmd
    assert cmd[cmd.index("-hwaccel") + 1] == "cuda"


def test_build_cmd_nvenc_pins_device(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "h264_nvenc", "hevc": "hevc_nvenc"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=_nvidia("1"))

    assert cmd[cmd.index("-hwaccel_device") + 1] == "1"
    assert cmd[cmd.index("-gpu") + 1] == "1"
    # -hwaccel_device must precede -i to affect decode
    assert cmd.index("-hwaccel_device") < cmd.index("-i")


def test_build_cmd_vaapi_pins_device(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "h264_vaapi", "hevc": "hevc_vaapi"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=_amd())

    assert cmd[cmd.index("-hwaccel") + 1] == "vaapi"
    assert cmd[cmd.index("-hwaccel_device") + 1] == "/dev/dri/renderD128"


def test_build_cmd_vaapi_no_gpu_omits_hwaccel_entirely(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "h264_vaapi", "hevc": "hevc_vaapi"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=None)

    assert "-hwaccel" not in cmd


def test_build_cmd_software_encoder_ignores_gpu_param(monkeypatch):
    import app.services.compressor as c

    monkeypatch.setattr(c, "_get_encoders", lambda: {"h264": "libx264", "hevc": "libx265"})

    cmd = _build_compress_cmd("/in.mp4", "/out.mp4", "hevc", 28, "medium", gpu=_nvidia())

    assert "-hwaccel" not in cmd
    assert "-gpu" not in cmd

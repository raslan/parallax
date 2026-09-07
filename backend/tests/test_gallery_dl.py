import json

from app.schemas import GalleryOptions
from app.services.gallery_dl import (
    SENTINEL_ERROR,
    SENTINEL_FILE,
    SENTINEL_SKIP,
    build_gallerydl_cmd,
    classify_line,
    type_filter_expr,
)


def test_gallery_options_defaults():
    o = GalleryOptions()
    assert o.baseDir == ""
    assert o.maxParallel == 2
    assert o.retries == 3
    assert o.httpTimeout == 30
    assert o.typeVideo is True
    assert o.typeAudio is False
    assert o.typeAny is False
    assert o.maxSizeValue is None
    assert o.maxSizeUnit == "M"
    assert o.useArchive is True
    assert o.inputMode == "paste"


def test_gallery_options_parses_partial_blob():
    o = GalleryOptions.model_validate({"baseDir": "/media/g", "retries": 5, "typeImage": True})
    assert o.baseDir == "/media/g"
    assert o.retries == 5
    assert o.typeImage is True
    assert o.typeVideo is True  # untouched default
    assert json.loads(o.model_dump_json())["maxParallel"] == 2


def _opts(**kw):
    return GalleryOptions(baseDir="/media/g", **kw)


def test_type_filter_union_and_any():
    assert type_filter_expr(_opts(typeVideo=True, typeAudio=False, typeImage=True)) == (
        "extension in ('mp4','mkv','m4v','webm','mov','avi','wmv','flv','mpg','mpeg','3gp','ts',"
        "'jpg','jpeg','png','gif','webp','bmp','avif','heic','heif','tiff','svg')"
    )
    assert type_filter_expr(_opts(typeAny=True, typeVideo=True)) is None
    assert type_filter_expr(_opts(typeVideo=False, typeAudio=False, typeImage=False)) is None


def test_build_cmd_core_and_conditionals():
    opts = _opts(
        retries=5,
        httpTimeout=45,
        maxSizeValue=3,
        maxSizeUnit="G",
        stopAfterExisting=10,
        useArchive=True,
        range="30-50",
        browser="chrome:windows",
        userAgent="UA/1.0",
        limitRate="1M",
        sleepRequest="0.5-1.5",
        filenameTemplate="{id}.{extension}",
        extraArgs="--verbose",
    )
    cmd = build_gallerydl_cmd("https://x.com/g/1", opts, "/tmp/c.txt")

    assert cmd[0].endswith("gallery-dl")
    assert "--no-part" in cmd
    assert "--no-colors" in cmd
    assert cmd[cmd.index("-o") + 1] == "output.mode=null"
    assert f"file:{SENTINEL_FILE}{{_path}}" in cmd
    assert cmd[cmd.index("--retries") + 1] == "5"
    assert cmd[cmd.index("-d") + 1] == "/media/g"
    assert "downloader.http.timeout=45" in cmd
    assert cmd[cmd.index("--filter") + 1].startswith("extension in (")
    assert cmd[cmd.index("--filesize-max") + 1] == "3G"
    assert cmd[cmd.index("-T") + 1] == "10"
    assert "--download-archive" in cmd
    assert cmd[cmd.index("--range") + 1] == "30-50"
    assert "extractor.*.browser=chrome:windows" in cmd
    assert cmd[cmd.index("--user-agent") + 1] == "UA/1.0"
    assert cmd[cmd.index("--limit-rate") + 1] == "1M"
    assert cmd[cmd.index("--sleep-request") + 1] == "0.5-1.5"
    assert cmd[cmd.index("--filename") + 1] == "{id}.{extension}"
    assert cmd[cmd.index("--cookies") + 1] == "/tmp/c.txt"
    assert "--verbose" in cmd
    assert cmd[-1] == "https://x.com/g/1"


def test_build_cmd_file_mode_uses_input_file():
    cmd = build_gallerydl_cmd("ignored", _opts(inputMode="file"), None)
    assert cmd[-2] == "-i"
    assert cmd[-1].endswith("urls.txt")
    assert "--cookies" not in cmd


def test_build_cmd_omits_disabled_conditionals():
    cmd = build_gallerydl_cmd("https://x.com/g/1", _opts(useArchive=False, typeAny=True), None)
    assert "--filter" not in cmd
    assert "--filesize-max" not in cmd
    assert "--download-archive" not in cmd
    assert "-T" not in cmd
    assert "--range" not in cmd


def test_build_cmd_bad_extra_args_falls_back_to_raw():
    cmd = build_gallerydl_cmd("https://x.com/g/1", _opts(extraArgs='--foo "unbalanced'), None)
    assert '--foo "unbalanced' in cmd


def test_classify_line():
    assert classify_line(f"{SENTINEL_FILE}/media/g/x/001.jpg") == ("file", "/media/g/x/001.jpg")
    assert classify_line(f"{SENTINEL_SKIP}/media/g/x/002.jpg") == ("skip", "/media/g/x/002.jpg")
    assert classify_line(f"{SENTINEL_ERROR}/media/g/x/003.jpg") == ("error", "/media/g/x/003.jpg")
    assert classify_line("[extractor] some noise") is None
    assert classify_line("") is None

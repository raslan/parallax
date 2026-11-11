from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator


class DuplicateCriteriaRequest(BaseModel):
    use_size: bool = True
    use_duration: bool = True
    duration_tolerance: float = 1.0
    use_resolution: bool = False
    use_content_date: bool = False
    content_date_tolerance: float = 86400.0
    use_orientation: bool = False
    use_bitrate: bool = False
    bitrate_tolerance_pct: float = 10.0
    use_filename: bool = False
    filename_threshold: float = 0.4
    use_byte_hash: bool = False
    use_phash: bool = True
    phash_threshold: int = 10
    phash_mode: str = "first_frame"
    phash_frames: int = 16
    use_audio: bool = False
    audio_threshold: float = 0.9
    # Shared-audio matching (the browser's "Min shared" is audio_threshold; these two change
    # what the server measures, so they are part of the Extract request).
    # Below ~65% unrelated music starts to count as "the same audio" (measured on real files).
    audio_similarity: float = Field(default=0.75, ge=0.65, le=0.95)
    audio_min_stretch: float = Field(default=10.0, ge=0.0, le=3600.0)  # seconds


class AudioDuplicateCriteriaRequest(BaseModel):
    """The audio Duplicates page's criteria; the defaults mirror the page's own."""

    use_size: bool = False
    use_duration: bool = True
    duration_tolerance: float = 2.0
    use_content_date: bool = False
    content_date_tolerance: float = 60.0
    use_audio: bool = True
    audio_threshold: float = 0.85
    # Below ~65% unrelated music starts to count as "the same audio" (measured on real files).
    audio_similarity: float = Field(default=0.75, ge=0.65, le=0.95)
    audio_min_stretch: float = Field(default=10.0, ge=0.0, le=3600.0)  # seconds


class LibraryCreate(BaseModel):
    name: str = ""
    path: str
    split_into_sublibraries: bool = False


class LibraryRead(BaseModel):
    id: int
    name: str
    path: str
    created_at: datetime
    last_scanned_at: datetime | None = None
    file_count: int = 0

    model_config = {"from_attributes": True}


class LibraryUpdate(BaseModel):
    name: str | None = None


class OriginalEntry(BaseModel):
    path: str
    filename: str
    library_id: int
    library_name: str
    original_size: int
    current_path: str | None
    current_size: int | None
    savings_bytes: int | None  # negative means the transcode made it larger


class OriginalsSummary(BaseModel):
    entries: list[OriginalEntry]
    total_original_bytes: int
    total_current_bytes: int
    total_savings_bytes: int


class FileRead(BaseModel):
    id: int
    library_id: int
    path: str
    filename: str
    size: int
    duration: float | None = None
    codec_name: str | None = None
    video_bitrate: int | None = None
    status: str
    scan_error: str | None = None
    scanned_at: datetime | None = None
    transcoded_at: datetime | None = None
    created_at: datetime
    has_thumbnail: bool = False
    file_width: int | None = None
    file_height: int | None = None
    file_fps: float | None = None
    file_date: float | None = None
    file_mtime: float | None = None
    phash: str | None = None
    phash_frames: str | None = None
    byte_hash: str | None = None
    shared_audio: str | None = None

    model_config = {"from_attributes": True}

    @field_validator("phash", mode="before")
    @classmethod
    def _phash_to_str(cls, v: int | str | None) -> str | None:
        # Signed 64-bit pHash values lose precision as JSON numbers (JS
        # float64 can't exactly represent int64 beyond +-2^53) - always
        # serialize as a decimal string, same as phash_frames/byte_hash.
        if v is None:
            return None
        return str(v)


class FilesResponse(BaseModel):
    items: list[FileRead]
    total: int
    page: int
    page_size: int


class JobRead(BaseModel):
    id: int
    type: str
    status: str
    library_id: int | None = None
    progress: float
    total_files: int
    processed_files: int
    current_file: str | None = None
    error: str | None = None
    settings: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None

    model_config = {"from_attributes": True}


class BrowseResponse(BaseModel):
    path: str
    dirs: list[str]
    files: list[FileRead]


class StatsRead(BaseModel):
    total_libraries: int
    total_files: int
    transcoded_files: int
    total_size_bytes: int
    scanning: bool


class DeleteDuplicatesRequest(BaseModel):
    file_ids: list[int]


# ── Image library schemas ────────────────────────────────────────────────────


class ImageLibraryCreate(BaseModel):
    name: str = ""
    path: str


class ImageLibraryRead(BaseModel):
    id: int
    name: str
    path: str
    created_at: datetime
    last_scanned_at: datetime | None = None
    image_count: int = 0

    model_config = {"from_attributes": True}


class ImageDetectionRead(BaseModel):
    id: int
    image_id: int
    label: str
    confidence: float
    bbox_json: str | None = None

    model_config = {"from_attributes": True}


class ImageRead(BaseModel):
    id: int
    library_id: int
    path: str
    filename: str
    extension: str
    size: int
    width: int | None = None
    height: int | None = None
    exif_date: float | None = None
    exif_gps: str | None = None
    exif_camera: str | None = None
    file_mtime: float | None = None
    status: str
    scan_error: str | None = None
    scanned_at: datetime | None = None
    created_at: datetime
    has_thumbnail: bool = False
    detections: list[ImageDetectionRead] = []

    model_config = {"from_attributes": True}


class ImagesResponse(BaseModel):
    items: list[ImageRead]
    total: int
    page: int
    page_size: int


class ImageScanRequest(BaseModel):
    run_phash: bool = True
    run_nudenet: bool = True
    reset: bool = False


class GalleryOptions(BaseModel):
    baseDir: str = ""
    maxParallel: int = Field(default=2, ge=1, le=5)
    retries: int = Field(default=3, ge=0, le=20)
    httpTimeout: int = Field(default=30, ge=1, le=600)
    typeVideo: bool = True
    typeAudio: bool = False
    typeImage: bool = False
    typeAny: bool = False
    maxSizeValue: float | None = Field(default=None, ge=0)
    maxSizeUnit: Literal["K", "M", "G", "T"] = "M"
    minSizeValue: float | None = Field(default=None, ge=0)
    minSizeUnit: Literal["K", "M", "G", "T"] = "M"
    stopAfterExisting: int | None = Field(default=None, ge=1)
    useArchive: bool = True
    archivePath: str = ""
    range: str = ""
    browser: str = ""
    userAgent: str = ""
    limitRate: str = ""
    sleepRequest: str = ""
    filenameTemplate: str = ""
    extraArgs: str = ""
    inputMode: Literal["paste", "file"] = "paste"
    urlList: str = Field(default="default", max_length=64)  # selected list in file mode
    # yt-dlp (ytdl backend) options — same vocabulary as the Downloads page.
    ytAudioOnly: bool = False
    ytQuality: Literal["best", "2160", "1440", "1080", "720", "480", "360"] = "best"
    ytCodec: str = "auto"  # video: auto/h264/hevc/av1/vp9 · audio: mp3/m4a/opus
    ytConcurrentFragments: int = Field(default=4, ge=1, le=64)
    ytDownloadSubs: bool = False
    ytSubLangs: str = "en"
    ytImpersonate: str = ""
    ytRefererMode: Literal["none", "site", "url", "custom"] = "none"
    ytReferer: str = ""
    ytThrottledRateValue: str = Field(default="", pattern=r"^(\d+\.?\d*|\.\d+)?$")
    ytThrottledRateUnit: Literal["K", "M", "G"] = "M"
    ytExtraArgs: str = ""


class GalleryListTypes(BaseModel):
    """Per-URL-list content-type override: the four `GalleryOptions.type*` flags, atomically."""

    typeVideo: bool = True
    typeAudio: bool = False
    typeImage: bool = False
    typeAny: bool = False


class GalleryEnqueueRequest(BaseModel):
    urls: list[str] = []
    cookies: str = ""


class ClearGalleriesRequest(BaseModel):
    statuses: list[str]


class UrlFileBody(BaseModel):
    text: str = ""


class UrlListRename(BaseModel):
    name: str


# ── Audio library schemas ────────────────────────────────────────────────────


class AudioLibraryCreate(BaseModel):
    name: str = ""
    path: str
    split_into_sublibraries: bool = False


class AudioLibraryRead(BaseModel):
    id: int
    name: str
    path: str
    created_at: datetime
    last_scanned_at: datetime | None = None
    file_count: int = 0

    model_config = {"from_attributes": True}


class AudioLibraryUpdate(BaseModel):
    name: str | None = None
    scan_automatically: bool | None = None


class AudioFileRead(BaseModel):
    id: int
    library_id: int
    path: str
    filename: str
    extension: str | None = None
    size: int
    duration: float | None = None
    codec_name: str | None = None
    bitrate: int | None = None
    sample_rate: int | None = None
    channels: int | None = None
    channel_layout: str | None = None
    shared_audio: str | None = None
    file_date: float | None = None
    file_mtime: float | None = None
    status: str
    scan_error: str | None = None
    scanned_at: datetime | None = None
    compressed_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Organize schemas ────────────────────────────────────────────────────────────


class OrganizeRoot(BaseModel):
    root: str | None = None


class OrganizeRootBody(BaseModel):
    path: str


class OrganizeCounts(BaseModel):
    files: int = 0
    images: int = 0
    videos: int = 0
    audio: int = 0
    other: int = 0
    bytes: int = 0


class OrganizeScanState(BaseModel):
    status: Literal["idle", "running", "done", "error"]
    folders_scanned: int
    root: str | None = None


class OrganizeCrumb(BaseModel):
    name: str
    path: str


class OrganizeSubfolder(BaseModel):
    name: str
    path: str
    direct: OrganizeCounts
    total: OrganizeCounts


class OrganizeFolder(BaseModel):
    path: str
    name: str
    parent: str | None = None
    breadcrumbs: list[OrganizeCrumb]
    direct: OrganizeCounts
    total: OrganizeCounts
    subfolders: list[OrganizeSubfolder]


class OrganizeFile(BaseModel):
    name: str
    path: str
    kind: Literal["image", "video", "audio", "other"]
    size: int
    mtime: float


class OrganizeDeleteBody(BaseModel):
    # The client sends chunks of 500; the cap bounds one synchronous request.
    paths: list[str] = Field(max_length=5000)


class OrganizeDeleteFailure(BaseModel):
    path: str
    error: str


class OrganizeDeleteResult(BaseModel):
    deleted: list[str]
    failed: list[OrganizeDeleteFailure]
    empty_folders: list[str]


class OrganizeMoveBody(BaseModel):
    folder: str  # the open folder; every path must be a direct file of it
    paths: list[str] = Field(max_length=20000)
    name: str  # new (or existing) subfolder of ``folder``


class OrganizeMoveResult(BaseModel):
    folder: str  # the subfolder's path
    moved: list[str]  # original paths of the files that moved
    failed: list[OrganizeDeleteFailure]


class OrganizeMoveToFolderBody(BaseModel):
    folder: str  # the open folder; every path must be a direct file of it
    paths: list[str] = Field(max_length=20000)
    destination: str  # an existing folder inside the root


class OrganizeRenameItem(BaseModel):
    path: str
    name: str  # the new file name (a single component, extension included)


class OrganizeRenameBody(BaseModel):
    folder: str  # the open folder; every path must be a direct file of it
    items: list[OrganizeRenameItem] = Field(max_length=20000)


class OrganizeRenamed(BaseModel):
    path: str
    new_path: str


class OrganizeRenameResult(BaseModel):
    renamed: list[OrganizeRenamed]
    failed: list[OrganizeDeleteFailure]


class OrganizeRenameFolderBody(BaseModel):
    path: str
    name: str


class OrganizeRenameFolderResult(BaseModel):
    path: str  # the folder's new path


class OrganizeDeleteFolderBody(BaseModel):
    path: str
    only_if_empty: bool = False  # rmdir, 409 if the folder gained entries


class OrganizeDetailsBody(BaseModel):
    paths: list[str]


class OrganizeDetails(BaseModel):
    duration: float | None
    width: int | None
    height: int | None
    codec: str | None
    bitrate: int | None


class OrganizeStreamBody(BaseModel):
    path: str


class OrganizeTagsBody(BaseModel):
    paths: list[str]
    # False: values longer than 500 characters are cut and flagged (for lists and columns).
    full: bool = False


class OrganizeTagInfo(BaseModel):
    # Canonical fields (title, description, artist, ...); only those the file has.
    fields: dict[str, str]
    # Every tag as stored, keyed by its own name.
    raw: dict[str, str]
    streams: list[str]
    truncated: bool


class OrganizeTagsResult(BaseModel):
    tags: dict[str, OrganizeTagInfo | None]


# A canonical field, ``gps`` (images, clear only), or ``raw:<tag name>`` for any other tag.
_TAG_FIELD = (
    r"^(?:title|description|synopsis|comment|artist|album|album_artist|genre|date|track"
    r"|copyright|keywords|gps|raw:.{1,100})$"
)
# 30,000 characters keeps one value inside the operating system's per-argument limit.
_TAG_VALUE_MAX = 30_000


class OrganizeTagsPlanBody(BaseModel):
    paths: list[str]


class OrganizeTagPlan(BaseModel):
    # Whether the file's tags can be written, and how: in place, or by rewriting a copy.
    writable: bool
    how: Literal["in_place", "rewrite"] | None
    # Why not, when it cannot be written.
    reason: str | None
    # Canonical fields (and ``raw:<name>`` tags the file already has) that can be edited.
    fields: list[str]
    # Free space a rewrite needs next to the file (0 in place).
    bytes_needed: int
    # A caution to show beside how it is written, e.g. that some tags may not survive.
    note: str | None
    # Whether any other tag name can be added to this file.
    can_add_raw: bool


class OrganizeTagsPlanResult(BaseModel):
    plans: dict[str, OrganizeTagPlan]
    # Free bytes on the folder of each file that exists.
    free_bytes: dict[str, int]


class OrganizeTagEdit(BaseModel):
    path: str
    # Field -> new value; null clears it.
    set: dict[
        Annotated[str, StringConstraints(pattern=_TAG_FIELD)],
        Annotated[str, StringConstraints(max_length=_TAG_VALUE_MAX)] | None,
    ]


class OrganizeTagsApplyBody(BaseModel):
    items: list[OrganizeTagEdit] = Field(max_length=20)


class OrganizeTagResult(BaseModel):
    status: Literal["written", "failed"]
    # What went wrong, in plain words; empty when written.
    message: str


class OrganizeTagsApplyResult(BaseModel):
    results: dict[str, OrganizeTagResult]


class OrganizeDetailsResult(BaseModel):
    details: dict[str, OrganizeDetails | None]


# --- Image upscale ---------------------------------------------------------


class UpscaleStartRequest(BaseModel):
    file_ids: list[int]
    tier: Literal["fast", "sharp", "natural"]
    scale: Literal[1, 2, 4]
    # Percent of the original size to resize to *before* the model (100 = off); the model then runs
    # at its native scale, so the output is `prescaled × native`. Any value from 10 to 100 works.
    prescale: int = Field(100, ge=10, le=100)
    # True: the new file takes the original's path. The original then goes to `_quarantine/`
    # (restorable) when `keep_original`, or is overwritten when not.
    replace: bool = False
    keep_original: bool = True
    force_cpu: bool = False


class UpscaleSkipped(BaseModel):
    id: int
    reason: str


class UpscaleStartResponse(BaseModel):
    job_id: int
    skipped: list[UpscaleSkipped]


class UpscaleTierRead(BaseModel):
    id: str
    label: str
    scale: int
    speed: Literal["fast", "slow"]
    hint: str
    scales: list[int]


class UpscaleTiersResponse(BaseModel):
    tiers: list[UpscaleTierRead]
    gpu_available: bool

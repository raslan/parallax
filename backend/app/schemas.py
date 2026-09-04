from datetime import datetime

from pydantic import BaseModel, field_validator


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
    phash_mode: str = "all_frames"
    phash_frames: int = 16
    use_audio: bool = False
    audio_threshold: float = 0.9


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
    audio_fingerprint: str | None = None

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

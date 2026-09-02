from datetime import datetime

from pydantic import BaseModel


class DuplicateCriteriaRequest(BaseModel):
    use_size: bool = True
    use_duration: bool = True
    use_phash: bool = True
    duration_tolerance: float = 1.0
    phash_threshold: int = 10  # Hamming distance 0–64
    phash_mode: str = "all_frames"  # "first_frame" | "all_frames"
    phash_frames: int = 16  # frames to extract per video for pHash


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

    model_config = {"from_attributes": True}


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


class DuplicateFileRead(BaseModel):
    id: int
    library_id: int
    path: str
    filename: str
    size: int
    duration: float | None = None
    codec_name: str | None = None
    video_bitrate: int | None = None
    status: str
    has_thumbnail: bool = False

    model_config = {"from_attributes": True}


class DuplicateGroupRead(BaseModel):
    files: list[DuplicateFileRead]
    keep_id: int


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

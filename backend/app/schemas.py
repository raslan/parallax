from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel


class TranscodeRequest(BaseModel):
    preset: Literal["high", "medium", "low"] = "medium"


class DuplicateCriteriaRequest(BaseModel):
    use_size: bool = True
    use_duration: bool = True
    use_phash: bool = True
    duration_tolerance: float = 1.0
    phash_threshold: int = 10  # Hamming distance 0–64
    phash_mode: str = "all_frames"  # "first_frame" | "all_frames"


class LibraryCreate(BaseModel):
    name: str = ""
    path: str
    split_into_sublibraries: bool = False


class LibraryRead(BaseModel):
    id: int
    name: str
    path: str
    created_at: datetime
    last_scanned_at: Optional[datetime] = None
    file_count: int = 0
    corrupt_count: int = 0

    model_config = {"from_attributes": True}


class LibraryUpdate(BaseModel):
    name: Optional[str] = None


class FileRead(BaseModel):
    id: int
    library_id: int
    path: str
    filename: str
    size: int
    duration: Optional[float] = None
    codec_name: Optional[str] = None
    video_bitrate: Optional[int] = None
    status: str
    scan_error: Optional[str] = None
    scanned_at: Optional[datetime] = None
    transcoded_at: Optional[datetime] = None
    created_at: datetime
    has_thumbnail: bool = False
    file_width: Optional[int] = None
    file_height: Optional[int] = None
    file_fps: Optional[float] = None
    file_date: Optional[float] = None

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
    library_id: Optional[int] = None
    progress: float
    total_files: int
    processed_files: int
    current_file: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BrowseResponse(BaseModel):
    path: str
    dirs: list[str]
    files: list[FileRead]


class StatsRead(BaseModel):
    total_libraries: int
    total_files: int
    corrupt_files: int
    transcoded_files: int
    total_size_bytes: int
    scanning: bool


class DuplicateFileRead(BaseModel):
    id: int
    library_id: int
    path: str
    filename: str
    size: int
    duration: Optional[float] = None
    codec_name: Optional[str] = None
    video_bitrate: Optional[int] = None
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
    last_scanned_at: Optional[datetime] = None
    image_count: int = 0

    model_config = {"from_attributes": True}


class ImageDetectionRead(BaseModel):
    id: int
    image_id: int
    label: str
    confidence: float
    bbox_json: Optional[str] = None

    model_config = {"from_attributes": True}


class ImageRead(BaseModel):
    id: int
    library_id: int
    path: str
    filename: str
    extension: str
    size: int
    width: Optional[int] = None
    height: Optional[int] = None
    exif_date: Optional[float] = None
    exif_gps: Optional[str] = None
    exif_camera: Optional[str] = None
    status: str
    scan_error: Optional[str] = None
    scanned_at: Optional[datetime] = None
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
    run_clip: bool = True
    reset: bool = False


class ImageSearchResult(BaseModel):
    image: ImageRead
    score: float

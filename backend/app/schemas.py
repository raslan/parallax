from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel


class TranscodeRequest(BaseModel):
    preset: Literal["high", "medium", "low"] = "medium"


class LibraryCreate(BaseModel):
    name: str
    path: str
    scan_automatically: bool = False
    auto_transcode_corrupt: bool = False


class LibraryRead(BaseModel):
    id: int
    name: str
    path: str
    scan_automatically: bool
    auto_transcode_corrupt: bool
    created_at: datetime
    last_scanned_at: Optional[datetime] = None
    file_count: int = 0
    corrupt_count: int = 0

    model_config = {"from_attributes": True}


class LibraryUpdate(BaseModel):
    name: Optional[str] = None
    scan_automatically: Optional[bool] = None
    auto_transcode_corrupt: Optional[bool] = None


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

from pydantic import BaseModel


class IngestVideoRequest(BaseModel):
    url: str


class IngestPlaylistRequest(BaseModel):
    url: str


class AskRequest(BaseModel):
    question: str
    video_ids: list[str] | None = None  # scope to specific video(s); omit to search everything ingested
    answer_language: str | None = None  # "english" | "hindi" | "hinglish" | "auto" (default: match question)


class VideoOut(BaseModel):
    video_id: str
    title: str | None
    channel: str | None
    status: str
    duration_seconds: int | None

    class Config:
        from_attributes = True

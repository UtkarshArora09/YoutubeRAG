from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.db import init_db, get_db
from app.models import Video
from app.schemas import IngestVideoRequest, IngestPlaylistRequest, AskRequest, VideoOut
from app.pipeline import ingest_video, ingest_playlist
from app.rag_graph import ask

app = FastAPI(title="YouTube RAG")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


@app.post("/ingest/video", response_model=VideoOut)
def ingest_video_endpoint(payload: IngestVideoRequest, db: Session = Depends(get_db)):
    try:
        video = ingest_video(db, payload.url)
        return video
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/ingest/playlist", response_model=list[VideoOut])
def ingest_playlist_endpoint(
    payload: IngestPlaylistRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    # Playlists can be large; ingest synchronously for small ones, otherwise this
    # endpoint could be swapped to kick off `ingest_playlist` as a background task
    # and expose a status-polling endpoint instead.
    videos = ingest_playlist(db, payload.url)
    return videos


@app.get("/videos", response_model=list[VideoOut])
def list_videos(db: Session = Depends(get_db)):
    return db.query(Video).order_by(Video.created_at.desc()).all()


@app.delete("/videos/{video_id}")
def delete_video(video_id: str, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.video_id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    db.delete(video)
    db.commit()
    return {"message": f"Video {video_id} deleted successfully"}


@app.post("/ask")
def ask_endpoint(payload: AskRequest, db: Session = Depends(get_db)):
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    result = ask(db, payload.question, video_ids=payload.video_ids, answer_language=payload.answer_language)
    return result


@app.get("/health")
def health():
    return {"status": "ok"}

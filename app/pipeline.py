from sqlalchemy.orm import Session

from app import ingestion
from app.embeddings import embed_texts
from app.models import Video, Chunk


def ingest_video(db: Session, video_id_or_url: str, playlist_id: str = None) -> Video:
    video_id = ingestion.extract_video_id(video_id_or_url)

    existing = db.query(Video).filter_by(video_id=video_id).first()
    if existing and existing.status == "ready":
        return existing

    video = existing or Video(video_id=video_id, playlist_id=playlist_id)
    video.status = "ingesting"
    db.add(video)
    db.commit()

    try:
        meta = ingestion.get_video_metadata(video_id)
        video.title = meta["title"]
        video.channel = meta["channel"]
        video.duration_seconds = meta["duration_seconds"]

        segments = ingestion.get_transcript(video_id)
        raw_chunks = ingestion.chunk_transcript(segments)

        if not raw_chunks:
            raise RuntimeError("No transcript content produced from this video.")

        # Clear old chunks if re-ingesting
        db.query(Chunk).filter_by(video_id=video_id).delete()

        texts = [c["text"] for c in raw_chunks]
        vectors = embed_texts(texts)

        for chunk_data, vector in zip(raw_chunks, vectors):
            db.add(Chunk(
                video_id=video_id,
                text=chunk_data["text"],
                start_seconds=chunk_data["start_seconds"],
                end_seconds=chunk_data["end_seconds"],
                embedding=vector,
            ))

        video.status = "ready"
        video.error_message = None
        db.commit()
        return video

    except Exception as e:
        video.status = "failed"
        video.error_message = str(e)
        db.commit()
        raise


def ingest_playlist(db: Session, playlist_url: str) -> list[Video]:
    entries = ingestion.get_playlist_video_ids(playlist_url)
    videos = []
    for entry in entries:
        try:
            video = ingest_video(db, entry["video_id"], playlist_id=playlist_url)
            videos.append(video)
        except Exception:
            # Keep going even if one video in the playlist fails (private/deleted/no captions)
            continue
    return videos

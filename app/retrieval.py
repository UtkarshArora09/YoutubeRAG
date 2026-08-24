from sqlalchemy import text
from sqlalchemy.orm import Session
from langchain_core.documents import Document

from app.config import settings
from app.embeddings import embed_query


def retrieve_chunks(
    db: Session,
    query: str,
    video_ids: list[str] = None,
    k: int = None,
) -> list[Document]:
    """
    Cosine-similarity search against pgvector using the HNSW/IVFFlat index directly
    via raw SQL (faster and more transparent than an ORM round-trip for this hot path).
    Optionally scoped to a subset of video_ids (single video or a playlist's videos).
    """
    k = k or settings.top_k
    query_vector = embed_query(query)

    base_sql = """
        SELECT c.text, c.start_seconds, c.end_seconds, c.video_id, v.title, v.channel
        FROM chunks c
        JOIN videos v ON v.video_id = c.video_id
        {video_filter}
        ORDER BY c.embedding <=> (:query_vector)::vector
        LIMIT :k
    """

    params = {"query_vector": str(query_vector), "k": k}
    video_filter = ""
    if video_ids:
        video_filter = "WHERE c.video_id = ANY(:video_ids)"
        params["video_ids"] = video_ids

    sql = text(base_sql.format(video_filter=video_filter))
    rows = db.execute(sql, params).fetchall()

    documents = []
    for row in rows:
        documents.append(Document(
            page_content=row.text,
            metadata={
                "video_id": row.video_id,
                "title": row.title,
                "channel": row.channel,
                "start_seconds": row.start_seconds,
                "end_seconds": row.end_seconds,
                "url": f"https://youtu.be/{row.video_id}?t={int(row.start_seconds)}",
            },
        ))
    return documents

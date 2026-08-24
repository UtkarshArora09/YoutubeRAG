from functools import lru_cache

from sentence_transformers import SentenceTransformer

from app.config import settings


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    # Loaded once per process. paraphrase-multilingual-MiniLM-L12-v2 covers English,
    # Hindi, and handles Hinglish reasonably well since it's trained on 50+ languages
    # including code-mixed text patterns. Runs on CPU fine for this workload.
    return SentenceTransformer(settings.embedding_model)


def embed_texts(texts: list[str], batch_size: int = 64) -> list[list[float]]:
    """Batch-embeds a list of strings locally. No API calls, no cost."""
    model = get_model()
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    return embeddings.tolist()


def embed_query(text: str) -> list[float]:
    model = get_model()
    embedding = model.encode(
        [text],
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    return embedding[0].tolist()

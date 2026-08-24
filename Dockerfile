FROM python:3.11-slim

WORKDIR /code

# ffmpeg for yt-dlp fallback; build-essential for torch/sentence-transformers wheels
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg build-essential curl && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY . .
RUN uv sync --frozen

# Pre-download the embedding model into the image so first request isn't slow
RUN uv run python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

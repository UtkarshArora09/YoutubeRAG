from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    groq_api_key: str
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"
    embedding_dim: int = 384
    chat_model: str = "openai/gpt-oss-120b"
    chunk_seconds: int = 45
    chunk_overlap_seconds: int = 5
    top_k: int = 6
    proxy_url: str | None = None

    class Config:
        env_file = ".env"


settings = Settings()

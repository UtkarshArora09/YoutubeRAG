import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, String, Integer, Float, ForeignKey, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.config import settings
from app.db import Base


class Video(Base):
    __tablename__ = "videos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_id = Column(String, unique=True, index=True, nullable=False)  # YouTube video ID
    title = Column(String, nullable=True)
    channel = Column(String, nullable=True)
    playlist_id = Column(String, index=True, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    status = Column(String, default="pending")  # pending | ingesting | ready | failed
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    chunks = relationship("Chunk", back_populates="video", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_id = Column(String, ForeignKey("videos.video_id"), index=True, nullable=False)
    text = Column(Text, nullable=False)
    start_seconds = Column(Float, nullable=False)
    end_seconds = Column(Float, nullable=False)
    embedding = Column(Vector(settings.embedding_dim), nullable=False)

    video = relationship("Video", back_populates="chunks")

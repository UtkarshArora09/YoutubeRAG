import re
from typing import Optional

import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, IpBlocked, VideoUnplayable, YouTubeTranscriptApiException
from youtube_transcript_api.proxies import GenericProxyConfig

from app.config import settings


def extract_video_id(url_or_id: str) -> str:
    """Accepts a full URL or a bare video ID and returns the 11-char video ID."""
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11}).*",
        r"^([0-9A-Za-z_-]{11})$",
    ]
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
    raise ValueError(f"Could not extract a video ID from: {url_or_id}")


def get_playlist_video_ids(playlist_url: str) -> list[dict]:
    """Returns [{video_id, title}] for every video in a playlist, without downloading media."""
    ydl_opts = {"extract_flat": True, "quiet": True, "skip_download": True}
    if settings.proxy_url:
        ydl_opts["proxy"] = settings.proxy_url

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(playlist_url, download=False)
    except Exception as e:
        raise RuntimeError(
            "YouTube blocked the playlist metadata download. This usually indicates an IP block. "
            "Please configure a working proxy in your .env file to bypass this."
        ) from e

    entries = info.get("entries", []) or []
    return [{"video_id": e["id"], "title": e.get("title")} for e in entries if e.get("id")]


def get_video_metadata(video_id: str) -> dict:
    """Lightweight metadata pull (title, channel, duration) without downloading the video."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    ydl_opts = {"quiet": True, "skip_download": True}
    if settings.proxy_url:
        ydl_opts["proxy"] = settings.proxy_url

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise RuntimeError(
            "YouTube blocked the video metadata download. This usually indicates an IP block. "
            "Please configure a working proxy in your .env file to bypass this."
        ) from e
    return {
        "title": info.get("title"),
        "channel": info.get("uploader"),
        "duration_seconds": info.get("duration"),
    }


def get_transcript(video_id: str, languages: Optional[list[str]] = None) -> list[dict]:
    """
    Returns raw transcript segments: [{text, start, duration}].
    Tries English first. If not available natively, lists all transcripts and translates
    the best available transcript (such as Hindi or auto-generated tracks) to English
    to ensure highly efficient English-to-English retrieval.
    """
    proxy_config = None
    if settings.proxy_url:
        proxy_config = GenericProxyConfig(http_url=settings.proxy_url, https_url=settings.proxy_url)

    ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config)
    try:
        try:
            # Try to fetch native English transcript first
            return ytt_api.fetch(video_id, languages=["en"]).to_raw_data()
        except NoTranscriptFound:
            # If native English is not found, list available transcripts
            transcript_list = ytt_api.list(video_id)
            try:
                # Prefer manually created transcript in any language over auto-generated
                transcript = transcript_list.find_manually_created_transcript(
                    [t.language_code for t in transcript_list]
                )
            except Exception:
                transcript = next(iter(transcript_list))

            # Translate to English if the transcript is not natively in English and is translatable
            if transcript.language_code != "en" and transcript.is_translatable:
                try:
                    transcript = transcript.translate("en")
                except Exception:
                    pass
            return transcript.fetch().to_raw_data()
    except (IpBlocked, VideoUnplayable) as e:
        raise RuntimeError(
            "YouTube has blocked requests from your IP address or returned 'Content unavailable'. "
            "This usually happens when accessing YouTube timetext captions directly from a cloud provider "
            "or after sending too many requests. Please check the README and set a proxy using PROXY_URL "
            "in your .env file to bypass this block."
        ) from e
    except TranscriptsDisabled as e:
        raise RuntimeError(f"Transcripts are disabled for video {video_id}") from e
    except YouTubeTranscriptApiException as e:
        raise RuntimeError(f"YouTube Transcript API error: {str(e)}. If this persists, configure a proxy in your .env file.") from e


def chunk_transcript(
    segments: list[dict],
    chunk_seconds: int = None,
    overlap_seconds: int = None,
) -> list[dict]:
    """
    Groups raw caption segments into fixed-duration windows, preserving start/end
    timestamps so each chunk can be cited and deep-linked (?t=123s).
    """
    chunk_seconds = chunk_seconds or settings.chunk_seconds
    overlap_seconds = overlap_seconds or settings.chunk_overlap_seconds

    if not segments:
        return []

    chunks = []
    window_start = segments[0]["start"]
    buffer_text = []
    buffer_start = window_start

    for seg in segments:
        seg_start = seg["start"]
        seg_end = seg["start"] + seg.get("duration", 0)

        if seg_start - buffer_start >= chunk_seconds and buffer_text:
            chunks.append({
                "text": " ".join(buffer_text).strip(),
                "start_seconds": buffer_start,
                "end_seconds": seg_start,
            })
            # start next window `overlap_seconds` before this segment for context continuity
            buffer_start = max(seg_start - overlap_seconds, 0)
            buffer_text = []

        buffer_text.append(seg["text"])

    if buffer_text:
        chunks.append({
            "text": " ".join(buffer_text).strip(),
            "start_seconds": buffer_start,
            "end_seconds": segments[-1]["start"] + segments[-1].get("duration", 0),
        })

    return chunks

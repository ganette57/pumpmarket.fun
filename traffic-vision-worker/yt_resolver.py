"""YouTube live URL resolver utilities for Traffic Vision Worker."""

from __future__ import annotations

import os
import shutil
import time
from typing import Dict, Tuple


FFMPEG_BIN = (
    os.environ.get("FFMPEG_BIN", "")
    or shutil.which("ffmpeg")
    or (
        "/opt/homebrew/bin/ffmpeg"
        if os.path.isfile("/opt/homebrew/bin/ffmpeg")
        else ""
    )
    or (
        "/usr/local/bin/ffmpeg"
        if os.path.isfile("/usr/local/bin/ffmpeg")
        else ""
    )
    or "ffmpeg"
)
YT_DLP_CACHE_TTL = 5400  # 1.5h

_url_cache: Dict[str, Tuple[str, float]] = {}


def get_ffmpeg_bin() -> str:
    return FFMPEG_BIN


def resolve_youtube_stream_url(youtube_url: str) -> str:
    """Extract the direct stream URL from a YouTube live URL using yt-dlp."""
    now = time.time()
    cached = _url_cache.get(youtube_url)
    if cached and (now - cached[1]) < YT_DLP_CACHE_TTL:
        print(f"[youtube-live] yt-dlp cache hit for {youtube_url[:60]}...")
        return cached[0]

    print(f"[youtube-live] resolving YouTube URL via yt-dlp: {youtube_url[:80]}...")

    try:
        import yt_dlp  # type: ignore
    except ImportError as exc:
        raise RuntimeError("yt-dlp not installed. Run: pip install yt-dlp") from exc

    opts = {
        "format": "best[height<=480]/best[height<=720]/best",
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 15,
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
    except Exception as exc:
        raise RuntimeError(f"yt-dlp resolution failed: {exc}") from exc

    stream_url: str = str(info.get("url") or "")
    if not stream_url:
        formats = info.get("requested_formats")
        if isinstance(formats, list):
            for fmt in formats:
                candidate = str((fmt or {}).get("url") or "")
                if candidate:
                    stream_url = candidate
                    break

    if not stream_url:
        raise RuntimeError(f"yt-dlp returned no stream URL for {youtube_url}")

    _url_cache[youtube_url] = (stream_url, now)
    print(f"[youtube-live] resolved OK (length={len(stream_url)})")
    return stream_url

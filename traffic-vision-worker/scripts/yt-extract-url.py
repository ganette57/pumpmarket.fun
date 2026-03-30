#!/usr/bin/env python3
"""
Extract direct stream URL from a YouTube live stream.

Usage:
    python3 scripts/yt-extract-url.py "https://www.youtube.com/watch?v=XXXX"

Then set the output as TRAFFIC_STREAM_URL:
    export TRAFFIC_STREAM_URL=$(python3 scripts/yt-extract-url.py "https://www.youtube.com/watch?v=XXXX")

Requirements:
    pip install yt-dlp

This mode does NOT need ffmpeg installed - cv2 (with its built-in ffmpeg)
can read the extracted m3u8 URL directly.
"""

import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 yt-extract-url.py <youtube-url>", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]

    try:
        import yt_dlp
    except ImportError:
        print("ERROR: yt-dlp not installed. Run: pip install yt-dlp", file=sys.stderr)
        sys.exit(1)

    opts = {
        "format": "best[height<=480]/best[height<=720]/best",
        "quiet": True,
        "no_warnings": True,
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        stream_url = info.get("url")
        if not stream_url:
            # For some formats, the URL is in requested_formats
            formats = info.get("requested_formats")
            if formats:
                stream_url = formats[0].get("url")

        if not stream_url:
            print("ERROR: Could not extract stream URL. Is the video live?", file=sys.stderr)
            sys.exit(1)

        print(stream_url)


if __name__ == "__main__":
    main()

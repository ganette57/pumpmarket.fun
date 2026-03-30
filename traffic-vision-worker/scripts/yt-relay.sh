#!/usr/bin/env bash
# yt-relay.sh - YouTube Live to local stream relay for Traffic Vision Worker
#
# Prerequisites:
#   brew install yt-dlp ffmpeg    (macOS)
#
# Usage:
#   MODE 1 - Direct URL (simplest, no relay process):
#     export TRAFFIC_STREAM_URL=$(./scripts/yt-relay.sh --url-only "https://www.youtube.com/watch?v=XXXX")
#     # Then start worker and app normally
#
#   MODE 2 - Local TCP relay (more stable, auto-reconnect):
#     ./scripts/yt-relay.sh "https://www.youtube.com/watch?v=XXXX"
#     # In another terminal, set: TRAFFIC_STREAM_URL=tcp://127.0.0.1:9999
#     # Then start worker and app normally
#
#   MODE 3 - Local TCP relay on custom port:
#     ./scripts/yt-relay.sh "https://www.youtube.com/watch?v=XXXX" 8888
#     # TRAFFIC_STREAM_URL=tcp://127.0.0.1:8888
#
# Good YouTube live traffic cams:
#   https://www.youtube.com/watch?v=1EiC9bvVGnk   (NYC Times Square)
#   https://www.youtube.com/watch?v=AdUw5RdyZxI   (Jackson Hole Town Square)
#   https://www.youtube.com/watch?v=ByED80IKdIU   (Abbey Road London)
#   https://www.youtube.com/watch?v=gFRtAAmiFbE   (Shibuya Crossing Tokyo)
#
# The worker reads this as source_type="remote_stream" automatically
# when TRAFFIC_STREAM_URL is set (no local file override).

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
    echo -e "${CYAN}Usage:${NC}"
    echo "  $0 <youtube-url> [port]          Start local TCP relay (default port: 9999)"
    echo "  $0 --url-only <youtube-url>      Just print the direct stream URL"
    echo ""
    echo -e "${CYAN}Examples:${NC}"
    echo "  $0 'https://www.youtube.com/watch?v=1EiC9bvVGnk'"
    echo "  $0 'https://www.youtube.com/watch?v=1EiC9bvVGnk' 8888"
    echo "  export TRAFFIC_STREAM_URL=\$($0 --url-only 'https://www.youtube.com/watch?v=1EiC9bvVGnk')"
    exit 1
}

check_deps() {
    local missing=()
    command -v yt-dlp  >/dev/null 2>&1 || missing+=("yt-dlp")
    command -v ffmpeg  >/dev/null 2>&1 || missing+=("ffmpeg")

    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Missing dependencies: ${missing[*]}${NC}"
        echo "Install with:  brew install ${missing[*]}"
        exit 1
    fi
}

extract_stream_url() {
    local yt_url="$1"
    echo -e "${YELLOW}Extracting stream URL from YouTube...${NC}" >&2
    # Prefer 480p or lower for performance; fall back to best available
    local stream_url
    stream_url=$(yt-dlp \
        -f "best[height<=480]/best[height<=720]/best" \
        --get-url \
        --no-warnings \
        "$yt_url" 2>/dev/null | head -1)

    if [ -z "$stream_url" ]; then
        echo -e "${RED}Failed to extract stream URL. Is the video live?${NC}" >&2
        exit 1
    fi
    echo "$stream_url"
}

# --- URL-only mode ---
if [ "${1:-}" = "--url-only" ]; then
    [ -z "${2:-}" ] && usage
    check_deps
    extract_stream_url "$2"
    exit 0
fi

# --- Relay mode ---
[ -z "${1:-}" ] && usage
check_deps

YT_URL="$1"
PORT="${2:-9999}"
RELAY_ADDR="tcp://0.0.0.0:${PORT}"
WORKER_URL="tcp://127.0.0.1:${PORT}"

echo -e "${GREEN}=== YouTube Traffic Relay ===${NC}"
echo -e "YouTube URL : ${CYAN}${YT_URL}${NC}"
echo -e "Relay port  : ${CYAN}${PORT}${NC}"
echo -e "Worker URL  : ${CYAN}${WORKER_URL}${NC}"
echo ""
echo -e "${YELLOW}Set this in your .env or shell:${NC}"
echo -e "  export TRAFFIC_STREAM_URL=${WORKER_URL}"
echo ""

# Retry loop: auto-restart on disconnect or URL expiry
RETRY_COUNT=0
MAX_RETRIES=50

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))

    STREAM_URL=$(extract_stream_url "$YT_URL")
    echo -e "${GREEN}Stream URL extracted (attempt ${RETRY_COUNT})${NC}"
    echo -e "${YELLOW}Starting ffmpeg relay on ${RELAY_ADDR} ...${NC}"
    echo -e "${CYAN}Waiting for worker to connect...${NC}"

    # Relay: read YouTube stream, output as mpegts over TCP (listen mode).
    # -re: read at native framerate (prevents buffering entire stream)
    # -c:v copy: no re-encoding (fast, low CPU)
    # -an: drop audio (not needed for traffic vision)
    # -f mpegts: MPEG-TS container, compatible with cv2.VideoCapture
    ffmpeg \
        -hide_banner -loglevel warning \
        -re \
        -i "$STREAM_URL" \
        -c:v copy -an \
        -f mpegts \
        "${RELAY_ADDR}?listen=1" \
    || true

    echo -e "${YELLOW}Relay disconnected. Restarting in 3s... (${RETRY_COUNT}/${MAX_RETRIES})${NC}"
    sleep 3
done

echo -e "${RED}Max retries reached (${MAX_RETRIES}). Exiting.${NC}"
exit 1

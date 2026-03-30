const TRAFFIC_DEBUG_LOCAL_FILE =
  process.env.TRAFFIC_VISION_DEBUG_VIDEO_FILE || "/tmp/traffic_sample.mp4";
const TRAFFIC_DEBUG_LOCAL_FIRST =
  process.env.TRAFFIC_CAMERA_DEBUG_USE_LOCAL_FILE === "1" ||
  process.env.TRAFFIC_VISION_DEBUG_USE_LOCAL_FILE === "1";
const TRAFFIC_PRIMARY_STREAM =
  process.env.TRAFFIC_STREAM_URL ||
  process.env.TRAFFIC_CAMERA_NYC_1_STREAM_URL ||
  process.env.TRAFFIC_VISION_DEFAULT_STREAM_URL ||
  "http://64.191.148.57/mjpg/video.mjpg";
const TRAFFIC_LOCAL_VIDEO_ACTIVE = TRAFFIC_DEBUG_LOCAL_FIRST || !TRAFFIC_PRIMARY_STREAM;

export const TRAFFIC_CAMERAS = [
  {
    id: "nyc-1",
    name: "NYC Midtown",
    sourceType: TRAFFIC_LOCAL_VIDEO_ACTIVE ? "local_video" : "remote_stream",
    streamUrl: TRAFFIC_LOCAL_VIDEO_ACTIVE
      ? TRAFFIC_DEBUG_LOCAL_FILE
      : TRAFFIC_PRIMARY_STREAM || TRAFFIC_DEBUG_LOCAL_FILE,
    line: {
      x1: 80,
      y1: TRAFFIC_LOCAL_VIDEO_ACTIVE ? 900 : 860,
      x2: 1200,
      y2: TRAFFIC_LOCAL_VIDEO_ACTIVE ? 900 : 860,
    },
  },
] as const;

export type TrafficCamera = (typeof TRAFFIC_CAMERAS)[number];

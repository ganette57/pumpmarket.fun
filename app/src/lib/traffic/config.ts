const TRAFFIC_DEBUG_LOCAL_FILE =
  process.env.TRAFFIC_VISION_DEBUG_VIDEO_FILE || "/tmp/traffic_sample.mp4";
const TRAFFIC_DEBUG_LOCAL_FIRST =
  process.env.TRAFFIC_CAMERA_DEBUG_USE_LOCAL_FILE === "1" ||
  process.env.TRAFFIC_VISION_DEBUG_USE_LOCAL_FILE === "1";
const TRAFFIC_PRIMARY_STREAM =
  process.env.TRAFFIC_CAMERA_NYC_1_STREAM_URL || process.env.TRAFFIC_VISION_DEFAULT_STREAM_URL || "";

export const TRAFFIC_CAMERAS = [
  {
    id: "nyc-1",
    name: "NYC Midtown",
    streamUrl: TRAFFIC_DEBUG_LOCAL_FIRST
      ? TRAFFIC_DEBUG_LOCAL_FILE
      : TRAFFIC_PRIMARY_STREAM || TRAFFIC_DEBUG_LOCAL_FILE,
    line: {
      x1: 220,
      y1: 420,
      x2: 980,
      y2: 420,
    },
  },
] as const;

export type TrafficCamera = (typeof TRAFFIC_CAMERAS)[number];

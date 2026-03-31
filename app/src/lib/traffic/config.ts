const TRAFFIC_DEBUG_LOCAL_FILE =
  process.env.TRAFFIC_VISION_DEBUG_VIDEO_FILE || "/tmp/traffic_sample.mp4";
const TRAFFIC_DEBUG_LOCAL_FIRST =
  process.env.TRAFFIC_CAMERA_DEBUG_USE_LOCAL_FILE === "1" ||
  process.env.TRAFFIC_VISION_DEBUG_USE_LOCAL_FILE === "1";
const TRAFFIC_LOCAL_VIDEO_ACTIVE = TRAFFIC_DEBUG_LOCAL_FIRST;

const TRAFFIC_CAMERA_STREAMS = {
  cam1: "https://wink.njta.com/203/public/hls/WF05-24AF-4D42-C307-AA51_nj.m3u8",
  cam2: "https://wink.njta.com/203/public/hls/WF05-24AF-4D24-2558-F999_nj.m3u8",
  cam3: "https://wink.njta.com/204/public/hls/WF05-24B0-46EE-2155-1A86_nj.m3u8",
} as const;

export const TRAFFIC_CAMERAS = [
  {
    id: "cam1",
    name: "Highway Cam 1",
    sourceType: TRAFFIC_LOCAL_VIDEO_ACTIVE ? "local_video" : "remote_stream",
    streamUrl: TRAFFIC_LOCAL_VIDEO_ACTIVE
      ? TRAFFIC_DEBUG_LOCAL_FILE
      : TRAFFIC_CAMERA_STREAMS.cam1,
    line: {
      x1: 80,
      y1: TRAFFIC_LOCAL_VIDEO_ACTIVE ? 900 : 860,
      x2: 1200,
      y2: TRAFFIC_LOCAL_VIDEO_ACTIVE ? 900 : 860,
    },
  },
  {
    id: "cam2",
    name: "Highway Cam 2",
    sourceType: TRAFFIC_LOCAL_VIDEO_ACTIVE ? "local_video" : "remote_stream",
    streamUrl: TRAFFIC_LOCAL_VIDEO_ACTIVE
      ? TRAFFIC_DEBUG_LOCAL_FILE
      : TRAFFIC_CAMERA_STREAMS.cam2,
    line: {
      x1: 80,
      y1: TRAFFIC_LOCAL_VIDEO_ACTIVE ? 900 : 860,
      x2: 1200,
      y2: TRAFFIC_LOCAL_VIDEO_ACTIVE ? 900 : 860,
    },
  },
  {
    id: "cam3",
    name: "Highway Cam 3",
    sourceType: TRAFFIC_LOCAL_VIDEO_ACTIVE ? "local_video" : "remote_stream",
    streamUrl: TRAFFIC_LOCAL_VIDEO_ACTIVE
      ? TRAFFIC_DEBUG_LOCAL_FILE
      : TRAFFIC_CAMERA_STREAMS.cam3,
    line: {
      x1: 80,
      y1: TRAFFIC_LOCAL_VIDEO_ACTIVE ? 900 : 860,
      x2: 1200,
      y2: TRAFFIC_LOCAL_VIDEO_ACTIVE ? 900 : 860,
    },
  },
] as const;

export type TrafficCamera = (typeof TRAFFIC_CAMERAS)[number];

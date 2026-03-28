from dataclasses import dataclass
import os


@dataclass(frozen=True)
class WorkerSettings:
    host: str = os.getenv("TRAFFIC_VISION_HOST", "0.0.0.0")
    port: int = int(os.getenv("TRAFFIC_VISION_PORT", "8090"))
    model_name: str = os.getenv("TRAFFIC_VISION_MODEL", "yolov8n.pt")
    conf_threshold: float = float(os.getenv("TRAFFIC_VISION_CONF", "0.25"))
    iou_threshold: float = float(os.getenv("TRAFFIC_VISION_IOU", "0.45"))
    frame_log_interval: int = int(os.getenv("TRAFFIC_VISION_FRAME_LOG_INTERVAL", "120"))
    debug_video_file: str = os.getenv("TRAFFIC_VISION_DEBUG_VIDEO_FILE", "/tmp/traffic_sample.mp4")
    debug_use_local_file: bool = os.getenv("TRAFFIC_VISION_DEBUG_USE_LOCAL_FILE", "0") == "1"


SETTINGS = WorkerSettings()

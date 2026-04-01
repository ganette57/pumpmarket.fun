from __future__ import annotations

from dataclasses import dataclass, field
import os
import threading
import time
from typing import Dict, List, Optional, Set

import cv2
from ultralytics import YOLO

from config import SETTINGS


COCO_CLASS_NAME_TO_ID = {
    "car": 2,
    "motorcycle": 3,
    "bus": 5,
    "truck": 7,
}

COCO_CLASS_ID_TO_NAME = {v: k for k, v in COCO_CLASS_NAME_TO_ID.items()}
REMOTE_STREAM_LINE_X_RATIO = 0.50
REMOTE_STREAM_LINE_MARGIN_PX = 5.0
REMOTE_STREAM_MIN_SAMPLES = 2
REMOTE_STREAM_MIN_MOTION_PX = 8.0
REMOTE_STREAM_DIRECTION = "both"
REMOTE_STREAM_MIN_BBOX_AREA_PX = 0.0
REMOTE_STREAM_COUNTING_ZONE_HALF_WIDTH_PX = 40.0
DEBUG_CROSSING = os.environ.get("TRAFFIC_DEBUG_CROSSING", "1") == "1"
REMOTE_STREAM_HISTORY_SIZE = 10
REMOTE_STREAM_ROI_X_MIN_RATIO = 0.18
REMOTE_STREAM_ROI_X_MAX_RATIO = 0.95
REMOTE_STREAM_ROI_Y_MIN_RATIO = 0.24
REMOTE_STREAM_ROI_Y_MAX_RATIO = 0.90
HIGHWAY_STREAM_SIGNATURES = tuple(
    s.strip().lower()
    for s in os.environ.get(
        "TRAFFIC_HIGHWAY_STREAM_SIGNATURES",
        "highway,autoroute,motorway,freeway,trafficcam",
    ).split(",")
    if s.strip()
)
HIGHWAY_REMOTE_STREAM_LINE_X_RATIO = 0.72
HIGHWAY_REMOTE_STREAM_ROI_X_MIN_RATIO = 0.46
HIGHWAY_REMOTE_STREAM_ROI_X_MAX_RATIO = 0.94
HIGHWAY_REMOTE_STREAM_ROI_Y_MIN_RATIO = 0.58
HIGHWAY_REMOTE_STREAM_ROI_Y_MAX_RATIO = 0.92
HIGHWAY_REMOTE_STREAM_DIRECTION = os.environ.get(
    "TRAFFIC_HIGHWAY_DIRECTION",
    "right_to_left",
).strip().lower() or "right_to_left"
HIGHWAY_REMOTE_STREAM_MIN_SAMPLES = 4
HIGHWAY_REMOTE_STREAM_MIN_MOTION_PX = 18.0
HIGHWAY_REMOTE_STREAM_MIN_BBOX_AREA_PX = 2200.0
CAM1_REMOTE_STREAM_LINE_Y_RATIO = 0.43
CAM1_REMOTE_STREAM_MIN_MOTION_PX = 7.0
CAM1_REMOTE_STREAM_VERTICAL_DIRECTION = os.environ.get(
    "TRAFFIC_CAM1_VERTICAL_DIRECTION",
    "top_to_bottom",
).strip().lower() or "top_to_bottom"
if CAM1_REMOTE_STREAM_VERTICAL_DIRECTION not in ("top_to_bottom", "bottom_to_top"):
    CAM1_REMOTE_STREAM_VERTICAL_DIRECTION = "top_to_bottom"

CAM1_STREAM_SIGNATURE = "wf05-24af-4d42-c307-aa51_nj"
CAM2_STREAM_SIGNATURE = "wf05-24af-4d24-2558-f999_nj"
CAM3_STREAM_SIGNATURE = "wf05-24b0-46ee-2155-1a86_nj"

CAMERA_REMOTE_STREAM_PROFILES: Dict[str, Dict[str, object]] = {
    "cam1": {
        "line_x_ratio": 0.50,
        "roi_x_min_ratio": 0.46,
        "roi_x_max_ratio": 0.94,
        "roi_y_min_ratio": 0.58,
        "roi_y_max_ratio": 0.92,
        "direction": "right_to_left",
        "min_samples": 4,
        "min_motion_px": 18.0,
        "min_bbox_area_px": 2200.0,
        "counting_zone_half_width_px": 10.0,
    },
    "cam2": {
        "line_x_ratio": 0.64,
        "roi_x_min_ratio": 0.34,
        "roi_x_max_ratio": 0.90,
        "roi_y_min_ratio": 0.52,
        "roi_y_max_ratio": 0.90,
        "direction": "right_to_left",
        "min_samples": 3,
        "min_motion_px": 14.0,
        "min_bbox_area_px": 1800.0,
        "counting_zone_half_width_px": 34.0,
    },
    "cam3": {
        "line_x_ratio": 0.40,
        "roi_x_min_ratio": 0.18,
        "roi_x_max_ratio": 0.72,
        "roi_y_min_ratio": 0.50,
        "roi_y_max_ratio": 0.90,
        "direction": "left_to_right",
        "min_samples": 4,
        "min_motion_px": 16.0,
        "min_bbox_area_px": 2000.0,
        "counting_zone_half_width_px": 38.0,
    },
}


def _line_side(x: float, y: float, x1: float, y1: float, x2: float, y2: float) -> int:
    cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)
    if abs(cross) < 1e-6:
        return 0
    return 1 if cross > 0 else -1


def _clamp_int(value: int, low: int, high: int) -> int:
    if value < low:
        return low
    if value > high:
        return high
    return value


def _is_highway_remote_profile(stream_url: str, round_id: str) -> bool:
    forced = os.environ.get("TRAFFIC_REMOTE_PROFILE", "").strip().lower()
    if forced == "highway":
        return True
    source = f"{stream_url} {round_id}".lower()
    return any(signature in source for signature in HIGHWAY_STREAM_SIGNATURES)


def _normalize_camera_id(value: Optional[str]) -> str:
    camera_id = str(value or "").strip().lower()
    if camera_id in CAMERA_REMOTE_STREAM_PROFILES:
        return camera_id
    return ""


def _camera_id_from_stream(stream_url: str) -> str:
    source = str(stream_url or "").strip().lower()
    if not source:
        return ""
    if CAM1_STREAM_SIGNATURE in source:
        return "cam1"
    if CAM2_STREAM_SIGNATURE in source:
        return "cam2"
    if CAM3_STREAM_SIGNATURE in source:
        return "cam3"
    return ""


def _resolve_remote_profile(camera_id: Optional[str], stream_url: str, round_id: str) -> Dict[str, object]:
    normalized_camera_id = _normalize_camera_id(camera_id)
    if not normalized_camera_id:
        normalized_camera_id = _camera_id_from_stream(stream_url)

    if normalized_camera_id and normalized_camera_id in CAMERA_REMOTE_STREAM_PROFILES:
        profile = dict(CAMERA_REMOTE_STREAM_PROFILES[normalized_camera_id])
        profile["profile_id"] = normalized_camera_id
        profile["profile_source"] = "camera_id_or_stream_signature"
        return profile

    if _is_highway_remote_profile(stream_url, round_id):
        return {
            "profile_id": "highway_fallback",
            "profile_source": "highway_signature",
            "line_x_ratio": HIGHWAY_REMOTE_STREAM_LINE_X_RATIO,
            "roi_x_min_ratio": HIGHWAY_REMOTE_STREAM_ROI_X_MIN_RATIO,
            "roi_x_max_ratio": HIGHWAY_REMOTE_STREAM_ROI_X_MAX_RATIO,
            "roi_y_min_ratio": HIGHWAY_REMOTE_STREAM_ROI_Y_MIN_RATIO,
            "roi_y_max_ratio": HIGHWAY_REMOTE_STREAM_ROI_Y_MAX_RATIO,
            "direction": HIGHWAY_REMOTE_STREAM_DIRECTION,
            "min_samples": HIGHWAY_REMOTE_STREAM_MIN_SAMPLES,
            "min_motion_px": HIGHWAY_REMOTE_STREAM_MIN_MOTION_PX,
            "min_bbox_area_px": HIGHWAY_REMOTE_STREAM_MIN_BBOX_AREA_PX,
            "counting_zone_half_width_px": REMOTE_STREAM_COUNTING_ZONE_HALF_WIDTH_PX,
        }

    return {
        "profile_id": "default_remote",
        "profile_source": "default",
        "line_x_ratio": REMOTE_STREAM_LINE_X_RATIO,
        "roi_x_min_ratio": REMOTE_STREAM_ROI_X_MIN_RATIO,
        "roi_x_max_ratio": REMOTE_STREAM_ROI_X_MAX_RATIO,
        "roi_y_min_ratio": REMOTE_STREAM_ROI_Y_MIN_RATIO,
        "roi_y_max_ratio": REMOTE_STREAM_ROI_Y_MAX_RATIO,
        "direction": REMOTE_STREAM_DIRECTION,
        "min_samples": REMOTE_STREAM_MIN_SAMPLES,
        "min_motion_px": REMOTE_STREAM_MIN_MOTION_PX,
        "min_bbox_area_px": REMOTE_STREAM_MIN_BBOX_AREA_PX,
        "counting_zone_half_width_px": REMOTE_STREAM_COUNTING_ZONE_HALF_WIDTH_PX,
    }


@dataclass
class RoundSpec:
    round_id: str
    stream_url: str
    camera_id: Optional[str]
    source_type: str
    duration_sec: int
    line: Dict[str, float]
    classes: List[str]
    class_ids: List[int]
    tracker: str


@dataclass
class RoundRuntime:
    spec: RoundSpec
    started_at: float
    ends_at: float
    status: str = "running"
    current_count: int = 0
    stop_reason: Optional[str] = None
    stop_event: threading.Event = field(default_factory=threading.Event)
    thread: Optional[threading.Thread] = None
    counted_track_ids: Set[int] = field(default_factory=set)
    last_side_by_track: Dict[int, int] = field(default_factory=dict)
    source_opened: bool = False
    source_url: Optional[str] = None
    last_frame_at: Optional[float] = None
    detections_last_frame: int = 0
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    counting_line_x: Optional[int] = None
    counting_line_y: Optional[int] = None
    counting_direction: Optional[str] = None
    counting_zone_half_width: Optional[int] = None
    counting_roi_x1: Optional[int] = None
    counting_roi_y1: Optional[int] = None
    counting_roi_x2: Optional[int] = None
    counting_roi_y2: Optional[int] = None
    last_counted_track_id: Optional[int] = None
    last_crossing_direction: Optional[str] = None
    track_center_x_history: Dict[int, List[float]] = field(default_factory=dict)
    track_center_y_history: Dict[int, List[float]] = field(default_factory=dict)
    track_seen_right_ids: Set[int] = field(default_factory=set)
    track_seen_left_ids: Set[int] = field(default_factory=set)
    track_in_counting_zone_by_id: Dict[int, bool] = field(default_factory=dict)
    track_samples_by_id: Dict[int, int] = field(default_factory=dict)
    last_track_samples: Optional[int] = None
    last_reject_reason: Optional[str] = None
    last_debug_frame_jpeg: Optional[bytes] = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def snapshot(self) -> Dict[str, object]:
        with self.lock:
            return {
                "roundId": self.spec.round_id,
                "status": self.status,
                "currentCount": int(self.current_count),
                "startedAt": int(self.started_at),
                "endsAt": int(self.ends_at),
                "sourceOpened": bool(self.source_opened),
                "lastFrameAt": int(self.last_frame_at) if self.last_frame_at else None,
                "detectionsLastFrame": int(self.detections_last_frame),
                "frameWidth": int(self.frame_width) if self.frame_width is not None else None,
                "frameHeight": int(self.frame_height) if self.frame_height is not None else None,
                "countingLineX": int(self.counting_line_x) if self.counting_line_x is not None else None,
                "countingLineY": int(self.counting_line_y) if self.counting_line_y is not None else None,
                "countingDirection": self.counting_direction,
                "countingZoneHalfWidth": int(self.counting_zone_half_width)
                if self.counting_zone_half_width is not None
                else None,
                "countingRoi": (
                    {
                        "x1": int(self.counting_roi_x1),
                        "y1": int(self.counting_roi_y1),
                        "x2": int(self.counting_roi_x2),
                        "y2": int(self.counting_roi_y2),
                    }
                    if self.counting_roi_x1 is not None
                    and self.counting_roi_y1 is not None
                    and self.counting_roi_x2 is not None
                    and self.counting_roi_y2 is not None
                    else None
                ),
                "lastCountedTrackId": int(self.last_counted_track_id)
                if self.last_counted_track_id is not None
                else None,
                "lastCrossingDirection": self.last_crossing_direction,
                "lastTrackSamples": int(self.last_track_samples)
                if self.last_track_samples is not None
                else None,
                "lastRejectReason": self.last_reject_reason,
            }


class TrafficRoundManager:
    def __init__(self) -> None:
        self._rounds: Dict[str, RoundRuntime] = {}
        self._lock = threading.Lock()
        self._model_lock = threading.Lock()
        self._model: Optional[YOLO] = None

    def _get_model(self) -> YOLO:
        with self._model_lock:
            if self._model is None:
                self._model = YOLO(SETTINGS.model_name)
            return self._model

    def start_round(self, spec: RoundSpec) -> Dict[str, object]:
        now = time.time()
        runtime = RoundRuntime(
            spec=spec,
            started_at=now,
            ends_at=now + max(1, int(spec.duration_sec)),
        )

        with self._lock:
            previous = self._rounds.get(spec.round_id)
            if previous and previous.status == "running":
                return previous.snapshot()

            if previous and previous.thread and previous.thread.is_alive():
                previous.stop_event.set()

            thread = threading.Thread(
                target=self._run_round,
                args=(runtime,),
                daemon=True,
                name=f"traffic-round-{spec.round_id}",
            )
            runtime.thread = thread
            self._rounds[spec.round_id] = runtime
            thread.start()

        print(
            "[traffic-vision-worker] worker round started",
            {
                "roundId": spec.round_id,
                "streamUrl": spec.stream_url,
                "cameraId": spec.camera_id,
                "sourceType": spec.source_type,
                "durationSec": spec.duration_sec,
                "classes": spec.classes,
                "tracker": spec.tracker,
            },
        )
        print(
            "[Traffic] starting round",
            {
                "roundId": spec.round_id,
                "sourceType": spec.source_type,
                "url": spec.stream_url,
            },
        )
        return runtime.snapshot()

    def get_status(self, round_id: str) -> Optional[Dict[str, object]]:
        with self._lock:
            runtime = self._rounds.get(round_id)
        if not runtime:
            return None
        return runtime.snapshot()

    def get_debug_frame_jpeg(self, round_id: str) -> Optional[bytes]:
        with self._lock:
            runtime = self._rounds.get(round_id)
        if not runtime:
            return None
        with runtime.lock:
            if runtime.last_debug_frame_jpeg is None:
                return None
            return bytes(runtime.last_debug_frame_jpeg)

    def stop_round(self, round_id: str, reason: str = "manual_stop") -> Optional[Dict[str, object]]:
        with self._lock:
            runtime = self._rounds.get(round_id)
        if not runtime:
            return None

        print(
            "[Traffic][STOP_ROUND]",
            {
                "roundId": round_id,
                "reason": reason,
            },
        )

        with runtime.lock:
            if runtime.status != "running":
                return {"roundId": round_id, "finalCount": int(runtime.current_count)}
            runtime.status = "stopped"
            if runtime.stop_reason is None:
                runtime.stop_reason = reason

        runtime.stop_event.set()
        if runtime.thread and runtime.thread.is_alive():
            runtime.thread.join(timeout=1.0)

        with runtime.lock:
            final_count = int(runtime.current_count)

        return {"roundId": round_id, "finalCount": final_count}

    def _maybe_count_track(
        self,
        runtime: RoundRuntime,
        track_id: int,
        class_id: int,
        side: int,
        source_type: str,
        center_x: float = 0.0,
        center_y: float = 0.0,
        frame_width: int = 0,
        frame_height: int = 0,
        bbox_area: float = 0.0,
        remote_min_samples: int = REMOTE_STREAM_MIN_SAMPLES,
        remote_min_motion_px: float = REMOTE_STREAM_MIN_MOTION_PX,
        remote_direction: str = REMOTE_STREAM_DIRECTION,
        remote_min_bbox_area_px: float = REMOTE_STREAM_MIN_BBOX_AREA_PX,
        remote_counting_zone_half_width_px: float = REMOTE_STREAM_COUNTING_ZONE_HALF_WIDTH_PX,
    ) -> None:
        if source_type != "remote_stream" and side == 0:
            return

        if source_type != "remote_stream":
            with runtime.lock:
                prev_side = runtime.last_side_by_track.get(track_id)
                runtime.last_side_by_track[track_id] = side

                if prev_side is None or prev_side == 0 or prev_side == side:
                    return
                if track_id in runtime.counted_track_ids:
                    return

                runtime.counted_track_ids.add(track_id)
                runtime.current_count += 1
                runtime.last_counted_track_id = track_id
                if prev_side < 0 and side > 0:
                    runtime.last_crossing_direction = "neg_to_pos"
                elif prev_side > 0 and side < 0:
                    runtime.last_crossing_direction = "pos_to_neg"
                else:
                    runtime.last_crossing_direction = f"{prev_side}_to_{side}"
                runtime.last_reject_reason = None
                current_count = int(runtime.current_count)
        else:
            with runtime.lock:
                roi_x1 = runtime.counting_roi_x1
                roi_y1 = runtime.counting_roi_y1
                roi_x2 = runtime.counting_roi_x2
                roi_y2 = runtime.counting_roi_y2
                if (
                    roi_x1 is not None
                    and roi_y1 is not None
                    and roi_x2 is not None
                    and roi_y2 is not None
                ):
                    if not (
                        float(roi_x1) <= center_x <= float(roi_x2)
                        and float(roi_y1) <= center_y <= float(roi_y2)
                    ):
                        return

                history = runtime.track_center_x_history.get(track_id)
                if history is None:
                    history = []
                    runtime.track_center_x_history[track_id] = history
                history.append(float(center_x))
                if len(history) > REMOTE_STREAM_HISTORY_SIZE:
                    history.pop(0)

                normalized_camera_id = _normalize_camera_id(runtime.spec.camera_id)
                if not normalized_camera_id:
                    normalized_camera_id = _camera_id_from_stream(runtime.spec.stream_url)
                is_cam1 = normalized_camera_id == "cam1"
                history_y: Optional[List[float]] = None
                if is_cam1:
                    history_y = runtime.track_center_y_history.get(track_id)
                    if history_y is None:
                        history_y = []
                        runtime.track_center_y_history[track_id] = history_y
                    history_y.append(float(center_y))
                    if len(history_y) > REMOTE_STREAM_HISTORY_SIZE:
                        history_y.pop(0)

                line_x = (
                    float(runtime.counting_line_x)
                    if runtime.counting_line_x is not None
                    else float(_clamp_int(int(round(frame_width * REMOTE_STREAM_LINE_X_RATIO)), 0, max(0, frame_width - 1)))
                )
                line_y = (
                    float(runtime.counting_line_y)
                    if runtime.counting_line_y is not None
                    else float(
                        _clamp_int(
                            int(round(frame_height * CAM1_REMOTE_STREAM_LINE_Y_RATIO)),
                            0,
                            max(0, frame_height - 1),
                        )
                    )
                )
                main_axis_value = center_y if is_cam1 else center_x
                main_axis_line = line_y if is_cam1 else line_x
                zone = (
                    -1
                    if main_axis_value > (main_axis_line + REMOTE_STREAM_LINE_MARGIN_PX)
                    else 1 if main_axis_value < (main_axis_line - REMOTE_STREAM_LINE_MARGIN_PX) else 0
                )
                in_counting_zone = abs(main_axis_value - main_axis_line) <= remote_counting_zone_half_width_px
                was_in_counting_zone = runtime.track_in_counting_zone_by_id.get(track_id, False)
                runtime.track_in_counting_zone_by_id[track_id] = in_counting_zone

                samples = len(history_y) if history_y is not None else len(history)
                span_x = (max(history) - min(history)) if samples >= 2 else 0.0
                if history_y is not None and samples >= 2:
                    span_x = max(history_y) - min(history_y)
                prev_zone = runtime.last_side_by_track.get(track_id)
                runtime.track_samples_by_id[track_id] = samples
                runtime.last_track_samples = samples

                # Keep the last non-neutral zone to avoid jitter around the line.
                if zone != 0:
                    runtime.last_side_by_track[track_id] = zone
                if zone < 0:
                    runtime.track_seen_right_ids.add(track_id)
                elif zone > 0:
                    runtime.track_seen_left_ids.add(track_id)

                if track_id in runtime.counted_track_ids:
                    return
                if bbox_area < remote_min_bbox_area_px:
                    if DEBUG_CROSSING and zone != 0:
                        runtime.last_reject_reason = (
                            f"T{track_id} reject=min_area area={bbox_area:.0f}"
                        )
                    return
                if samples < remote_min_samples:
                    if DEBUG_CROSSING and zone != 0:
                        runtime.last_reject_reason = f"T{track_id} reject=min_samples s={samples}"
                    return
                if span_x < remote_min_motion_px:
                    if DEBUG_CROSSING and zone != 0:
                        runtime.last_reject_reason = f"T{track_id} reject=min_motion span={span_x:.0f}"
                    return

                if is_cam1 and history_y is not None:
                    if len(history_y) < 2:
                        return
                    prev_y = history_y[-2]
                    curr_y = history_y[-1]
                    crossing_dir: Optional[str] = None
                    if remote_direction == "top_to_bottom":
                        if prev_y < line_y and curr_y >= line_y:
                            crossing_dir = "top_to_bottom"
                    elif remote_direction == "bottom_to_top":
                        if prev_y > line_y and curr_y <= line_y:
                            crossing_dir = "bottom_to_top"
                    else:
                        if prev_y < line_y and curr_y >= line_y:
                            crossing_dir = "top_to_bottom"
                        elif prev_y > line_y and curr_y <= line_y:
                            crossing_dir = "bottom_to_top"

                    if crossing_dir is None:
                        if DEBUG_CROSSING and zone != 0:
                            runtime.last_reject_reason = (
                                f"T{track_id} reject=no_crossing_y prev={prev_y:.0f} "
                                f"curr={curr_y:.0f} ly={line_y:.0f} z={zone}"
                            )
                        return

                    runtime.counted_track_ids.add(track_id)
                    runtime.current_count += 1
                    runtime.last_counted_track_id = track_id
                    runtime.last_crossing_direction = crossing_dir
                    runtime.last_reject_reason = None
                    current_count = int(runtime.current_count)
                else:
                    # Fallback: if a track enters the counting zone around the line
                    # and has coherent direction/motion, count even without full crossing.
                    movement_dx = (history[-1] - history[0]) if samples >= 2 else 0.0
                    if remote_direction == "right_to_left":
                        direction_ok = movement_dx <= -2.0
                        seen_expected_side = (track_id in runtime.track_seen_right_ids) or (prev_zone == -1)
                    elif remote_direction == "left_to_right":
                        direction_ok = movement_dx >= 2.0
                        seen_expected_side = (track_id in runtime.track_seen_left_ids) or (prev_zone == 1)
                    else:
                        direction_ok = abs(movement_dx) >= 2.0
                        seen_expected_side = True

                    fallback_min_samples = max(2, remote_min_samples - 1)
                    fallback_min_motion_px = max(4.0, remote_min_motion_px * 0.7)
                    if (
                        remote_direction in ("right_to_left", "left_to_right")
                        and in_counting_zone
                        and not was_in_counting_zone
                        and seen_expected_side
                        and direction_ok
                        and samples >= fallback_min_samples
                        and span_x >= fallback_min_motion_px
                    ):
                        runtime.counted_track_ids.add(track_id)
                        runtime.current_count += 1
                        runtime.last_counted_track_id = track_id
                        runtime.last_crossing_direction = remote_direction
                        runtime.last_reject_reason = "counted=fallback_zone"
                        current_count = int(runtime.current_count)
                        if DEBUG_CROSSING:
                            print(
                                f"[CROSSING_DEBUG] FALLBACK COUNTED T{track_id} "
                                f"dx={movement_dx:.1f} span={span_x:.1f} samples={samples}"
                            )
                        # keep last_side as approach side to stabilize subsequent frames
                        if prev_zone is not None:
                            runtime.last_side_by_track[track_id] = prev_zone
                        return

                    # History-based crossing: did the track path span across the line?
                    min_hist = min(history)
                    max_hist = max(history)
                    if not (min_hist < line_x < max_hist):
                        if DEBUG_CROSSING and zone != 0:
                            runtime.last_reject_reason = (
                                f"T{track_id} reject=no_crossing cx={center_x:.0f} "
                                f"min={min_hist:.0f} max={max_hist:.0f} lx={line_x:.0f} z={zone}"
                            )
                        return

                    crossing_dir = "right_to_left" if history[0] > line_x else "left_to_right"

                    if remote_direction in ("right_to_left", "left_to_right"):
                        if crossing_dir != remote_direction:
                            if DEBUG_CROSSING and zone != 0:
                                runtime.last_reject_reason = (
                                    f"T{track_id} reject=direction {crossing_dir}!={remote_direction}"
                                )
                            return

                    runtime.counted_track_ids.add(track_id)
                    runtime.current_count += 1
                    runtime.last_counted_track_id = track_id
                    runtime.last_crossing_direction = crossing_dir
                    runtime.last_reject_reason = None
                    current_count = int(runtime.current_count)

        if DEBUG_CROSSING:
            with runtime.lock:
                if runtime.counting_line_y is not None and runtime.counting_line_x is None:
                    hist = runtime.track_center_y_history.get(track_id, [])
                    line_label = "ly"
                    line_value = runtime.counting_line_y
                else:
                    hist = runtime.track_center_x_history.get(track_id, [])
                    line_label = "lx"
                    line_value = runtime.counting_line_x
            print(
                f"[CROSSING_DEBUG] COUNTED T{track_id} "
                f"class={COCO_CLASS_ID_TO_NAME.get(class_id, str(class_id))} "
                f"dir={runtime.last_crossing_direction} "
                f"count={current_count} "
                f"hist=[{','.join(f'{x:.0f}' for x in hist[-5:])}] "
                f"{line_label}={line_value}"
            )
        print(
            "[traffic-vision-worker] object counted with trackId",
            {
                "roundId": runtime.spec.round_id,
                "trackId": track_id,
                "class": COCO_CLASS_ID_TO_NAME.get(class_id, str(class_id)),
                "currentCount": current_count,
            },
        )

    def _update_debug_frame(
        self,
        runtime: RoundRuntime,
        frame,
        detections: List[Dict[str, object]],
        line_x1: float,
        line_y1: float,
        line_x2: float,
        line_y2: float,
    ) -> None:
        if frame is None:
            return

        annotated = frame.copy()
        x1 = int(float(line_x1))
        y1 = int(float(line_y1))
        x2 = int(float(line_x2))
        y2 = int(float(line_y2))
        with runtime.lock:
            cam1_horizontal_mode = (
                runtime.spec.source_type == "remote_stream"
                and runtime.counting_line_x is None
                and runtime.counting_line_y is not None
                and runtime.counting_direction in ("top_to_bottom", "bottom_to_top")
            )

        if cam1_horizontal_mode:
            # Subtle glow for cam1 counting line.
            overlay = annotated.copy()
            cv2.line(overlay, (x1, y1), (x2, y2), (40, 180, 70), 8)
            cv2.line(overlay, (x1, y1), (x2, y2), (60, 210, 95), 4)
            cv2.addWeighted(overlay, 0.22, annotated, 0.78, 0.0, annotated)
            cv2.line(annotated, (x1, y1), (x2, y2), (70, 235, 120), 2)
        else:
            cv2.line(annotated, (x1, y1), (x2, y2), (0, 220, 255), 2)

        for det in detections:
            bbox = det.get("bbox")
            if not isinstance(bbox, tuple) or len(bbox) != 4:
                continue

            x_min, y_min, x_max, y_max = bbox
            side = int(det.get("side", 0))
            in_roi = bool(det.get("in_roi", True))

            color = (40, 190, 255)
            if side > 0:
                color = (40, 220, 80)
            elif side < 0:
                color = (80, 160, 255)
            if not in_roi:
                color = (120, 120, 120)

            cv2.rectangle(annotated, (int(x_min), int(y_min)), (int(x_max), int(y_max)), color, 2)

        with runtime.lock:
            current_count = int(runtime.current_count)

        count_text = f"COUNT {current_count}"
        font_face = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.8
        font_thickness = 2
        (text_w, text_h), baseline = cv2.getTextSize(count_text, font_face, font_scale, font_thickness)
        x_text = 12
        y_text = 16 + text_h
        cv2.rectangle(
            annotated,
            (x_text - 8, y_text - text_h - 8),
            (x_text + text_w + 8, y_text + baseline + 8),
            (0, 0, 0),
            -1,
        )
        cv2.putText(
            annotated,
            count_text,
            (x_text, y_text),
            font_face,
            font_scale,
            (255, 255, 255),
            font_thickness,
            cv2.LINE_AA,
        )

        ok, encoded = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            return

        with runtime.lock:
            runtime.last_debug_frame_jpeg = encoded.tobytes()

    def _run_round(self, runtime: RoundRuntime) -> None:
        model = self._get_model()
        source_candidates: List[str] = []
        default_source = str(runtime.spec.stream_url or "").strip()
        debug_source = str(SETTINGS.debug_video_file or "").strip()
        source_type = str(runtime.spec.source_type or "").strip().lower() or "local_video"
        remote_line_x_ratio = REMOTE_STREAM_LINE_X_RATIO
        remote_roi_x_min_ratio = REMOTE_STREAM_ROI_X_MIN_RATIO
        remote_roi_x_max_ratio = REMOTE_STREAM_ROI_X_MAX_RATIO
        remote_roi_y_min_ratio = REMOTE_STREAM_ROI_Y_MIN_RATIO
        remote_roi_y_max_ratio = REMOTE_STREAM_ROI_Y_MAX_RATIO
        remote_direction = REMOTE_STREAM_DIRECTION
        remote_min_samples = REMOTE_STREAM_MIN_SAMPLES
        remote_min_motion_px = REMOTE_STREAM_MIN_MOTION_PX
        remote_min_bbox_area_px = REMOTE_STREAM_MIN_BBOX_AREA_PX
        remote_counting_zone_half_width_px = REMOTE_STREAM_COUNTING_ZONE_HALF_WIDTH_PX
        remote_line_y_ratio = CAM1_REMOTE_STREAM_LINE_Y_RATIO
        remote_use_horizontal_line = False

        if source_type == "remote_stream":
            normalized_camera_id = _normalize_camera_id(runtime.spec.camera_id)
            if not normalized_camera_id:
                normalized_camera_id = _camera_id_from_stream(default_source)
            if normalized_camera_id == "cam1":
                remote_use_horizontal_line = True
                remote_direction = CAM1_REMOTE_STREAM_VERTICAL_DIRECTION
                remote_min_motion_px = CAM1_REMOTE_STREAM_MIN_MOTION_PX
                print(
                    "[Traffic] cam1 horizontal counting mode enabled",
                    {
                        "roundId": runtime.spec.round_id,
                        "cameraId": runtime.spec.camera_id,
                        "lineYRatio": remote_line_y_ratio,
                        "direction": remote_direction,
                        "minMotionPx": remote_min_motion_px,
                    },
                )
            elif _is_highway_remote_profile(default_source, runtime.spec.round_id):
                remote_line_x_ratio = HIGHWAY_REMOTE_STREAM_LINE_X_RATIO
                remote_roi_x_min_ratio = HIGHWAY_REMOTE_STREAM_ROI_X_MIN_RATIO
                remote_roi_x_max_ratio = HIGHWAY_REMOTE_STREAM_ROI_X_MAX_RATIO
                remote_roi_y_min_ratio = HIGHWAY_REMOTE_STREAM_ROI_Y_MIN_RATIO
                remote_roi_y_max_ratio = HIGHWAY_REMOTE_STREAM_ROI_Y_MAX_RATIO
                remote_direction = HIGHWAY_REMOTE_STREAM_DIRECTION
                remote_min_samples = HIGHWAY_REMOTE_STREAM_MIN_SAMPLES
                remote_min_motion_px = HIGHWAY_REMOTE_STREAM_MIN_MOTION_PX
                remote_min_bbox_area_px = HIGHWAY_REMOTE_STREAM_MIN_BBOX_AREA_PX
                print(
                    "[Traffic] highway calibration profile enabled",
                    {
                        "roundId": runtime.spec.round_id,
                        "lineXRatio": remote_line_x_ratio,
                        "roi": [
                            remote_roi_x_min_ratio,
                            remote_roi_y_min_ratio,
                            remote_roi_x_max_ratio,
                            remote_roi_y_max_ratio,
                        ],
                        "direction": remote_direction,
                        "minSamples": remote_min_samples,
                        "minMotionPx": remote_min_motion_px,
                        "minBboxAreaPx": remote_min_bbox_area_px,
                        "countingZoneHalfWidthPx": remote_counting_zone_half_width_px,
                    },
                )
        if source_type == "remote_stream":
            if default_source:
                source_candidates.append(default_source)
        else:
            if SETTINGS.debug_use_local_file:
                if debug_source:
                    source_candidates.append(debug_source)
                if default_source and default_source != debug_source:
                    source_candidates.append(default_source)
            else:
                if default_source:
                    source_candidates.append(default_source)
                if debug_source and debug_source != default_source:
                    source_candidates.append(debug_source)

        cap: Optional[cv2.VideoCapture] = None
        active_source: Optional[str] = None
        for source in source_candidates:
            candidate = str(source).strip()
            if not candidate:
                continue

            maybe_file = os.path.exists(candidate)
            print(
                "[traffic-vision-worker] source opened attempt",
                {
                    "roundId": runtime.spec.round_id,
                    "source": candidate,
                    "isLocalFile": maybe_file,
                },
            )

            trial = cv2.VideoCapture(candidate)
            if trial.isOpened():
                cap = trial
                active_source = candidate
                break

            trial.release()
            print(
                "[traffic-vision-worker] source opened failed",
                {
                    "roundId": runtime.spec.round_id,
                    "source": candidate,
                },
            )

        if cap is None or active_source is None:
            with runtime.lock:
                runtime.status = "stopped"
                runtime.stop_reason = "stream_open_failed"
                runtime.source_opened = False
            print(
                "[traffic-vision-worker] worker round stopped",
                {
                    "roundId": runtime.spec.round_id,
                    "reason": "stream_open_failed",
                    "finalCount": runtime.current_count,
                },
            )
            return

        with runtime.lock:
            runtime.source_opened = True
            runtime.source_url = active_source
        print(
            "[traffic-vision-worker] source opened ok",
            {
                "roundId": runtime.spec.round_id,
                "source": active_source,
            },
        )

        frame_idx = 0
        frame_read_failures = 0
        line_x1 = float(runtime.spec.line["x1"])
        line_y1 = float(runtime.spec.line["y1"])
        line_x2 = float(runtime.spec.line["x2"])
        line_y2 = float(runtime.spec.line["y2"])
        roi_x1: Optional[int] = None
        roi_y1: Optional[int] = None
        roi_x2: Optional[int] = None
        roi_y2: Optional[int] = None
        line_metrics_logged = False
        tracker_cfg = "bytetrack.yaml"
        if str(runtime.spec.tracker or "").strip().lower() in ("bytetrack", "bytetrack.yaml"):
            tracker_cfg = "bytetrack.yaml"

        try:
            while not runtime.stop_event.is_set():
                now = time.time()
                if now >= runtime.ends_at:
                    print(
                        "[traffic-vision-worker] traffic round reached end_time",
                        {"roundId": runtime.spec.round_id, "endsAt": int(runtime.ends_at)},
                    )
                    break

                ok, frame = cap.read()
                if not ok or frame is None:
                    frame_read_failures += 1
                    if frame_read_failures <= 3 or (
                        SETTINGS.frame_log_interval > 0
                        and frame_read_failures % SETTINGS.frame_log_interval == 0
                    ):
                        print(
                            "[traffic-vision-worker] frame read failed",
                            {
                                "roundId": runtime.spec.round_id,
                                "failures": frame_read_failures,
                            },
                        )
                    time.sleep(0.03)
                    continue

                frame_idx += 1
                with runtime.lock:
                    runtime.last_frame_at = time.time()

                frame_height, frame_width = frame.shape[:2]
                if frame_width > 0 and frame_height > 0:
                    if source_type == "remote_stream":
                        if remote_use_horizontal_line:
                            effective_line_x = None
                            effective_line_y = _clamp_int(
                                int(round(frame_height * remote_line_y_ratio)),
                                0,
                                frame_height - 1,
                            )
                            line_x1 = 0.0
                            line_x2 = float(max(0, frame_width - 1))
                            line_y1 = float(effective_line_y)
                            line_y2 = float(effective_line_y)
                        else:
                            effective_line_x = _clamp_int(
                                int(round(frame_width * remote_line_x_ratio)),
                                0,
                                frame_width - 1,
                            )
                            line_x1 = float(effective_line_x)
                            line_x2 = float(effective_line_x)
                            line_y1 = 0.0
                            line_y2 = float(max(0, frame_height - 1))
                            effective_line_y = None
                        roi_x1 = _clamp_int(
                            int(round(frame_width * remote_roi_x_min_ratio)),
                            0,
                            frame_width - 1,
                        )
                        roi_x2 = _clamp_int(int(round(frame_width * remote_roi_x_max_ratio)), 0, frame_width - 1)
                        if roi_x2 <= roi_x1:
                            roi_x2 = min(frame_width - 1, roi_x1 + 1)
                        roi_y1 = _clamp_int(
                            int(round(frame_height * remote_roi_y_min_ratio)),
                            0,
                            frame_height - 1,
                        )
                        roi_y2 = _clamp_int(int(round(frame_height * remote_roi_y_max_ratio)), 0, frame_height - 1)
                        if roi_y2 <= roi_y1:
                            roi_y2 = min(frame_height - 1, roi_y1 + 1)
                    else:
                        line_x1 = float(_clamp_int(int(round(line_x1)), 0, frame_width - 1))
                        line_x2 = float(_clamp_int(int(round(line_x2)), 0, frame_width - 1))
                        if line_x1 == line_x2:
                            line_x1 = 0.0
                            line_x2 = float(max(0, frame_width - 1))

                        effective_line_x = None
                        line_y1 = float(_clamp_int(int(round(line_y1)), 0, frame_height - 1))
                        line_y2 = float(_clamp_int(int(round(line_y2)), 0, frame_height - 1))
                        effective_line_y = int(round((line_y1 + line_y2) / 2.0))
                        line_y1 = float(effective_line_y)
                        line_y2 = float(effective_line_y)
                        roi_x1 = None
                        roi_y1 = None
                        roi_x2 = None
                        roi_y2 = None

                    with runtime.lock:
                        runtime.frame_width = int(frame_width)
                        runtime.frame_height = int(frame_height)
                        runtime.counting_line_x = (
                            int(effective_line_x) if effective_line_x is not None else None
                        )
                        runtime.counting_line_y = (
                            int(effective_line_y) if effective_line_y is not None else None
                        )
                        runtime.counting_direction = (
                            str(remote_direction) if source_type == "remote_stream" else "both"
                        )
                        runtime.counting_zone_half_width = (
                            int(remote_counting_zone_half_width_px)
                            if source_type == "remote_stream"
                            else None
                        )
                        runtime.counting_roi_x1 = int(roi_x1) if roi_x1 is not None else None
                        runtime.counting_roi_y1 = int(roi_y1) if roi_y1 is not None else None
                        runtime.counting_roi_x2 = int(roi_x2) if roi_x2 is not None else None
                        runtime.counting_roi_y2 = int(roi_y2) if roi_y2 is not None else None

                    if not line_metrics_logged:
                        print(
                            "[Traffic] counting line calibrated",
                            {
                                "roundId": runtime.spec.round_id,
                                "sourceType": source_type,
                                "frameWidth": int(frame_width),
                                "frameHeight": int(frame_height),
                                "effectiveCountingLineX": int(effective_line_x)
                                if effective_line_x is not None
                                else None,
                                "effectiveCountingLineY": int(effective_line_y)
                                if effective_line_y is not None
                                else None,
                                "countingRoi": (
                                    {
                                        "x1": int(roi_x1),
                                        "y1": int(roi_y1),
                                        "x2": int(roi_x2),
                                        "y2": int(roi_y2),
                                    }
                                    if roi_x1 is not None
                                    and roi_y1 is not None
                                    and roi_x2 is not None
                                    and roi_y2 is not None
                                    else None
                                ),
                            },
                        )
                        line_metrics_logged = True

                if frame_idx <= 3 or (
                    SETTINGS.frame_log_interval > 0 and frame_idx % SETTINGS.frame_log_interval == 0
                ):
                    print(
                        "[traffic-vision-worker] frame read success",
                        {"roundId": runtime.spec.round_id, "frame": frame_idx},
                    )

                if SETTINGS.frame_log_interval > 0 and frame_idx % SETTINGS.frame_log_interval == 0:
                    print(
                        "[traffic-vision-worker] frame processing active",
                        {"roundId": runtime.spec.round_id, "frame": frame_idx},
                    )

                try:
                    results = model.track(
                        frame,
                        persist=True,
                        tracker=tracker_cfg,
                        classes=runtime.spec.class_ids,
                        conf=SETTINGS.conf_threshold,
                        iou=SETTINGS.iou_threshold,
                        verbose=False,
                    )
                except Exception as track_error:
                    print(
                        "[traffic-vision-worker] frame processing error",
                        {
                            "roundId": runtime.spec.round_id,
                            "frame": frame_idx,
                            "error": str(track_error),
                        },
                    )
                    time.sleep(0.01)
                    continue

                if not results:
                    with runtime.lock:
                        runtime.detections_last_frame = 0
                    self._update_debug_frame(runtime, frame, [], line_x1, line_y1, line_x2, line_y2)
                    continue

                first = results[0]
                boxes = getattr(first, "boxes", None)
                if boxes is None:
                    with runtime.lock:
                        runtime.detections_last_frame = 0
                    self._update_debug_frame(runtime, frame, [], line_x1, line_y1, line_x2, line_y2)
                    continue
                if boxes.id is None or boxes.cls is None or boxes.xyxy is None:
                    with runtime.lock:
                        runtime.detections_last_frame = 0
                    self._update_debug_frame(runtime, frame, [], line_x1, line_y1, line_x2, line_y2)
                    continue

                track_ids = boxes.id.int().cpu().tolist()
                class_ids = boxes.cls.int().cpu().tolist()
                bboxes = boxes.xyxy.cpu().tolist()
                detections_len = len(track_ids)
                with runtime.lock:
                    runtime.detections_last_frame = detections_len

                if detections_len > 0 or (
                    SETTINGS.frame_log_interval > 0 and frame_idx % SETTINGS.frame_log_interval == 0
                ):
                    print(
                        "[traffic-vision-worker] detections count per frame",
                        {
                            "roundId": runtime.spec.round_id,
                            "frame": frame_idx,
                            "detections": detections_len,
                        },
                    )

                debug_detections: List[Dict[str, object]] = []
                for track_id_raw, class_id_raw, bbox in zip(track_ids, class_ids, bboxes):
                    track_id = int(track_id_raw)
                    class_id = int(class_id_raw)
                    if class_id not in runtime.spec.class_ids:
                        continue

                    x_min, y_min, x_max, y_max = bbox
                    bbox_area = max(0.0, (float(x_max) - float(x_min)) * (float(y_max) - float(y_min)))
                    center_x = (float(x_min) + float(x_max)) / 2.0
                    center_y = float(y_max)
                    in_roi = True
                    if (
                        source_type == "remote_stream"
                        and roi_x1 is not None
                        and roi_y1 is not None
                        and roi_x2 is not None
                        and roi_y2 is not None
                    ):
                        in_roi = (
                            float(roi_x1) <= center_x <= float(roi_x2)
                            and float(roi_y1) <= center_y <= float(roi_y2)
                        )
                    if source_type == "remote_stream":
                        if remote_use_horizontal_line:
                            if center_y > (line_y1 + REMOTE_STREAM_LINE_MARGIN_PX):
                                side = -1
                            elif center_y < (line_y1 - REMOTE_STREAM_LINE_MARGIN_PX):
                                side = 1
                            else:
                                side = 0
                        else:
                            if center_x > (line_x1 + REMOTE_STREAM_LINE_MARGIN_PX):
                                side = -1
                            elif center_x < (line_x1 - REMOTE_STREAM_LINE_MARGIN_PX):
                                side = 1
                            else:
                                side = 0
                    else:
                        side = _line_side(center_x, center_y, line_x1, line_y1, line_x2, line_y2)
                    self._maybe_count_track(
                        runtime,
                        track_id,
                        class_id,
                        side,
                        source_type,
                        center_x,
                        center_y,
                        frame_width,
                        frame_height,
                        bbox_area,
                        remote_min_samples,
                        remote_min_motion_px,
                        remote_direction,
                        remote_min_bbox_area_px,
                        remote_counting_zone_half_width_px,
                    )
                    debug_detections.append(
                        {
                            "track_id": track_id,
                            "class_id": class_id,
                            "bbox": (float(x_min), float(y_min), float(x_max), float(y_max)),
                            "point_x": int(center_x),
                            "point_y": int(center_y),
                            "side": side,
                            "in_roi": in_roi,
                        }
                    )

                if DEBUG_CROSSING and frame_idx % 30 == 0 and detections_len > 0:
                    with runtime.lock:
                        use_y_axis = runtime.counting_line_y is not None and runtime.counting_line_x is None
                        dbg_parts = []
                        for det in debug_detections:
                            tid = det["track_id"]
                            c_axis = det["point_y"] if use_y_axis else det["point_x"]
                            s = det["side"]
                            hist = (
                                runtime.track_center_y_history.get(tid, [])
                                if use_y_axis
                                else runtime.track_center_x_history.get(tid, [])
                            )
                            counted = "Y" if tid in runtime.counted_track_ids else "N"
                            samp = len(hist)
                            span = (max(hist) - min(hist)) if samp >= 2 else 0
                            dbg_parts.append(
                                f"T{tid}:p={c_axis},z={s},s={samp},sp={span:.0f},c={counted}"
                            )
                        l_axis = runtime.counting_line_y if use_y_axis else runtime.counting_line_x
                        cc = runtime.current_count
                    print(
                        f"[CROSSING_DEBUG] f={frame_idx} l={l_axis or 0} cnt={cc} det={detections_len} "
                        + " | ".join(dbg_parts[:8])
                    )

                self._update_debug_frame(
                    runtime,
                    frame,
                    debug_detections,
                    line_x1,
                    line_y1,
                    line_x2,
                    line_y2,
                )
        finally:
            cap.release()
            with runtime.lock:
                if runtime.status == "running":
                    runtime.status = "stopped" if runtime.stop_event.is_set() else "ended"
                if runtime.stop_reason is None:
                    runtime.stop_reason = "manual_stop" if runtime.stop_event.is_set() else "end_time_reached"
                final_count = int(runtime.current_count)

            print(
                "[traffic-vision-worker] worker round stopped",
                {
                    "roundId": runtime.spec.round_id,
                    "reason": runtime.stop_reason,
                    "finalCount": final_count,
                },
            )
            print(
                "[traffic-vision-worker] final frozen count returned",
                {"roundId": runtime.spec.round_id, "finalCount": final_count},
            )


ROUND_MANAGER = TrafficRoundManager()

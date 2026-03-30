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
DEBUG_CROSSING = os.environ.get("TRAFFIC_DEBUG_CROSSING", "1") == "1"
REMOTE_STREAM_HISTORY_SIZE = 10
REMOTE_STREAM_ROI_X_MIN_RATIO = 0.18
REMOTE_STREAM_ROI_X_MAX_RATIO = 0.95
REMOTE_STREAM_ROI_Y_MIN_RATIO = 0.24
REMOTE_STREAM_ROI_Y_MAX_RATIO = 0.90


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


@dataclass
class RoundSpec:
    round_id: str
    stream_url: str
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
    counting_roi_x1: Optional[int] = None
    counting_roi_y1: Optional[int] = None
    counting_roi_x2: Optional[int] = None
    counting_roi_y2: Optional[int] = None
    last_counted_track_id: Optional[int] = None
    last_crossing_direction: Optional[str] = None
    track_center_x_history: Dict[int, List[float]] = field(default_factory=dict)
    track_seen_right_ids: Set[int] = field(default_factory=set)
    track_seen_left_ids: Set[int] = field(default_factory=set)
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

                line_x = (
                    float(runtime.counting_line_x)
                    if runtime.counting_line_x is not None
                    else float(_clamp_int(int(round(frame_width * REMOTE_STREAM_LINE_X_RATIO)), 0, max(0, frame_width - 1)))
                )
                zone = (
                    -1
                    if center_x > (line_x + REMOTE_STREAM_LINE_MARGIN_PX)
                    else 1 if center_x < (line_x - REMOTE_STREAM_LINE_MARGIN_PX) else 0
                )

                history = runtime.track_center_x_history.get(track_id)
                if history is None:
                    history = []
                    runtime.track_center_x_history[track_id] = history
                history.append(float(center_x))
                if len(history) > REMOTE_STREAM_HISTORY_SIZE:
                    history.pop(0)

                samples = len(history)
                span_x = (max(history) - min(history)) if samples >= 2 else 0.0
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
                if samples < REMOTE_STREAM_MIN_SAMPLES:
                    if DEBUG_CROSSING and zone != 0:
                        runtime.last_reject_reason = f"T{track_id} reject=min_samples s={samples}"
                    return
                if span_x < REMOTE_STREAM_MIN_MOTION_PX:
                    if DEBUG_CROSSING and zone != 0:
                        runtime.last_reject_reason = f"T{track_id} reject=min_motion span={span_x:.0f}"
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

                crossing_dir: Optional[str] = None
                if history[0] > line_x:
                    crossing_dir = "right_to_left"
                else:
                    crossing_dir = "left_to_right"

                runtime.counted_track_ids.add(track_id)
                runtime.current_count += 1
                runtime.last_counted_track_id = track_id
                runtime.last_crossing_direction = crossing_dir
                runtime.last_reject_reason = None
                current_count = int(runtime.current_count)

        if DEBUG_CROSSING:
            with runtime.lock:
                hist = runtime.track_center_x_history.get(track_id, [])
                lx = runtime.counting_line_x
            print(
                f"[CROSSING_DEBUG] COUNTED T{track_id} "
                f"class={COCO_CLASS_ID_TO_NAME.get(class_id, str(class_id))} "
                f"dir={runtime.last_crossing_direction} "
                f"count={current_count} "
                f"hist=[{','.join(f'{x:.0f}' for x in hist[-5:])}] "
                f"lx={lx}"
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

        cv2.line(annotated, (x1, y1), (x2, y2), (0, 220, 255), 2)

        for det in detections:
            bbox = det.get("bbox")
            if not isinstance(bbox, tuple) or len(bbox) != 4:
                continue

            x_min, y_min, x_max, y_max = bbox
            px = int(det.get("point_x", 0))
            py = int(det.get("point_y", 0))
            track_id = int(det.get("track_id", -1))
            class_id = int(det.get("class_id", -1))
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
            cv2.circle(annotated, (px, py), 4, (255, 255, 255), -1)
            class_name = COCO_CLASS_ID_TO_NAME.get(class_id, str(class_id))
            label = f"{class_name} #{track_id}"
            cv2.putText(
                annotated,
                label,
                (int(x_min), max(14, int(y_min) - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                color,
                2,
                cv2.LINE_AA,
            )

        with runtime.lock:
            current_count = int(runtime.current_count)
            status = str(runtime.status)
            last_counted_track_id = (
                int(runtime.last_counted_track_id)
                if runtime.last_counted_track_id is not None
                else None
            )
            last_crossing_direction = runtime.last_crossing_direction
            last_track_samples = (
                int(runtime.last_track_samples)
                if runtime.last_track_samples is not None
                else None
            )
            frame_width = int(runtime.frame_width) if runtime.frame_width is not None else None
            frame_height = int(runtime.frame_height) if runtime.frame_height is not None else None
            counting_line_x = int(runtime.counting_line_x) if runtime.counting_line_x is not None else None
            counting_line_y = int(runtime.counting_line_y) if runtime.counting_line_y is not None else None
            counting_roi_x1 = (
                int(runtime.counting_roi_x1) if runtime.counting_roi_x1 is not None else None
            )
            counting_roi_y1 = (
                int(runtime.counting_roi_y1) if runtime.counting_roi_y1 is not None else None
            )
            counting_roi_x2 = (
                int(runtime.counting_roi_x2) if runtime.counting_roi_x2 is not None else None
            )
            counting_roi_y2 = (
                int(runtime.counting_roi_y2) if runtime.counting_roi_y2 is not None else None
            )
            source_type = str(runtime.spec.source_type or "").strip().lower()

        if (
            counting_roi_x1 is not None
            and counting_roi_y1 is not None
            and counting_roi_x2 is not None
            and counting_roi_y2 is not None
        ):
            cv2.rectangle(
                annotated,
                (counting_roi_x1, counting_roi_y1),
                (counting_roi_x2, counting_roi_y2),
                (100, 170, 255),
                1,
            )

        cv2.putText(
            annotated,
            f"count={current_count} detections={len(detections)} status={status}",
            (10, 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            f"round={runtime.spec.round_id}",
            (10, 44),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (200, 200, 200),
            1,
            cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            f"lastTrack={last_counted_track_id if last_counted_track_id is not None else '-'} "
            f"lastDir={last_crossing_direction or '-'} "
            f"samples={last_track_samples if last_track_samples is not None else '-'}",
            (10, 64),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (180, 255, 180),
            1,
            cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            (
                f"lineX={counting_line_x if counting_line_x is not None else '-'} "
                f"frameW={frame_width if frame_width is not None else '-'} "
                f"dir={'both' if source_type == 'remote_stream' else 'both'} "
                f"roi={counting_roi_x1 if counting_roi_x1 is not None else '-'},"
                f"{counting_roi_y1 if counting_roi_y1 is not None else '-'},"
                f"{counting_roi_x2 if counting_roi_x2 is not None else '-'},"
                f"{counting_roi_y2 if counting_roi_y2 is not None else '-'}"
                if source_type == "remote_stream"
                else (
                    f"lineY={counting_line_y if counting_line_y is not None else '-'} "
                    f"frameH={frame_height if frame_height is not None else '-'}"
                )
            ),
            (10, 84),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (255, 230, 160),
            1,
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
                        effective_line_x = _clamp_int(
                            int(round(frame_width * REMOTE_STREAM_LINE_X_RATIO)),
                            0,
                            frame_width - 1,
                        )
                        line_x1 = float(effective_line_x)
                        line_x2 = float(effective_line_x)
                        line_y1 = 0.0
                        line_y2 = float(max(0, frame_height - 1))
                        effective_line_y = None
                        roi_x1 = _clamp_int(
                            int(round(frame_width * REMOTE_STREAM_ROI_X_MIN_RATIO)),
                            0,
                            frame_width - 1,
                        )
                        roi_x2 = _clamp_int(int(round(frame_width * REMOTE_STREAM_ROI_X_MAX_RATIO)), 0, frame_width - 1)
                        if roi_x2 <= roi_x1:
                            roi_x2 = min(frame_width - 1, roi_x1 + 1)
                        roi_y1 = _clamp_int(
                            int(round(frame_height * REMOTE_STREAM_ROI_Y_MIN_RATIO)),
                            0,
                            frame_height - 1,
                        )
                        roi_y2 = _clamp_int(int(round(frame_height * REMOTE_STREAM_ROI_Y_MAX_RATIO)), 0, frame_height - 1)
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
                        dbg_parts = []
                        for det in debug_detections:
                            tid = det["track_id"]
                            cx = det["point_x"]
                            s = det["side"]
                            hist = runtime.track_center_x_history.get(tid, [])
                            counted = "Y" if tid in runtime.counted_track_ids else "N"
                            samp = len(hist)
                            span = (max(hist) - min(hist)) if samp >= 2 else 0
                            dbg_parts.append(
                                f"T{tid}:cx={cx},z={s},s={samp},sp={span:.0f},c={counted}"
                            )
                        lx = runtime.counting_line_x or 0
                        cc = runtime.current_count
                    print(
                        f"[CROSSING_DEBUG] f={frame_idx} lx={lx} cnt={cc} det={detections_len} "
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

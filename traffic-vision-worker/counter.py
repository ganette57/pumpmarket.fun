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


def _line_side(x: float, y: float, x1: float, y1: float, x2: float, y2: float) -> int:
    cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)
    if abs(cross) < 1e-6:
        return 0
    return 1 if cross > 0 else -1


@dataclass
class RoundSpec:
    round_id: str
    stream_url: str
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
                "durationSec": spec.duration_sec,
                "classes": spec.classes,
                "tracker": spec.tracker,
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

        with runtime.lock:
            # Idempotent stop: once finalized, always return existing frozen count.
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

    def _maybe_count_track(self, runtime: RoundRuntime, track_id: int, class_id: int, side: int) -> None:
        if side == 0:
            return

        with runtime.lock:
            prev_side = runtime.last_side_by_track.get(track_id)
            runtime.last_side_by_track[track_id] = side

            if prev_side is None or prev_side == 0 or prev_side == side:
                return
            if track_id in runtime.counted_track_ids:
                return

            runtime.counted_track_ids.add(track_id)
            runtime.current_count += 1
            current_count = int(runtime.current_count)

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
    ) -> None:
        if frame is None:
            return

        annotated = frame.copy()
        x1 = int(float(runtime.spec.line["x1"]))
        y1 = int(float(runtime.spec.line["y1"]))
        x2 = int(float(runtime.spec.line["x2"]))
        y2 = int(float(runtime.spec.line["y2"]))

        # Debug counting line overlay.
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

            color = (40, 190, 255)
            if side > 0:
                color = (40, 220, 80)
            elif side < 0:
                color = (80, 160, 255)

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
        x1 = float(runtime.spec.line["x1"])
        y1 = float(runtime.spec.line["y1"])
        x2 = float(runtime.spec.line["x2"])
        y2 = float(runtime.spec.line["y2"])
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

                results = model.track(
                    frame,
                    persist=True,
                    tracker=tracker_cfg,
                    classes=runtime.spec.class_ids,
                    conf=SETTINGS.conf_threshold,
                    iou=SETTINGS.iou_threshold,
                    verbose=False,
                )
                if not results:
                    with runtime.lock:
                        runtime.detections_last_frame = 0
                    self._update_debug_frame(runtime, frame, [])
                    continue

                first = results[0]
                boxes = getattr(first, "boxes", None)
                if boxes is None:
                    with runtime.lock:
                        runtime.detections_last_frame = 0
                    self._update_debug_frame(runtime, frame, [])
                    continue
                if boxes.id is None or boxes.cls is None or boxes.xyxy is None:
                    with runtime.lock:
                        runtime.detections_last_frame = 0
                    self._update_debug_frame(runtime, frame, [])
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
                    side = _line_side(center_x, center_y, x1, y1, x2, y2)
                    self._maybe_count_track(runtime, track_id, class_id, side)
                    debug_detections.append(
                        {
                            "track_id": track_id,
                            "class_id": class_id,
                            "bbox": (float(x_min), float(y_min), float(x_max), float(y_max)),
                            "point_x": int(center_x),
                            "point_y": int(center_y),
                            "side": side,
                        }
                    )

                self._update_debug_frame(runtime, frame, debug_detections)
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

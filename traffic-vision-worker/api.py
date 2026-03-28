from __future__ import annotations

from typing import Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from counter import COCO_CLASS_NAME_TO_ID, ROUND_MANAGER, RoundSpec


class LinePayload(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class StartRoundPayload(BaseModel):
    roundId: str = Field(min_length=1)
    streamUrl: str = Field(min_length=1)
    durationSec: int = Field(default=60, ge=1, le=3600)
    line: LinePayload
    classes: List[str] = Field(default_factory=lambda: ["car", "bus", "truck", "motorcycle"])
    tracker: str = "bytetrack"


class RoundStatusResponse(BaseModel):
    roundId: str
    status: Literal["running", "ended", "stopped"]
    currentCount: int
    startedAt: int
    endsAt: int
    sourceOpened: bool
    lastFrameAt: Optional[int] = None
    detectionsLastFrame: int = 0


class StopRoundPayload(BaseModel):
    reason: str = "manual_stop"


class StopRoundResponse(BaseModel):
    roundId: str
    finalCount: int


app = FastAPI(title="Traffic Vision Worker", version="0.1.0")


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"ok": "true"}


@app.post("/rounds/start", response_model=RoundStatusResponse)
def start_round(payload: StartRoundPayload) -> Dict[str, object]:
    classes = [c.strip().lower() for c in payload.classes if str(c).strip()]
    class_ids = [COCO_CLASS_NAME_TO_ID[c] for c in classes if c in COCO_CLASS_NAME_TO_ID]
    if not class_ids:
        raise HTTPException(status_code=400, detail="No supported classes provided.")

    spec = RoundSpec(
        round_id=payload.roundId.strip(),
        stream_url=payload.streamUrl.strip(),
        duration_sec=int(payload.durationSec),
        line={
            "x1": float(payload.line.x1),
            "y1": float(payload.line.y1),
            "x2": float(payload.line.x2),
            "y2": float(payload.line.y2),
        },
        classes=classes,
        class_ids=class_ids,
        tracker=(payload.tracker or "bytetrack").strip() or "bytetrack",
    )
    return ROUND_MANAGER.start_round(spec)


@app.get("/rounds/{round_id}/status", response_model=RoundStatusResponse)
def round_status(round_id: str) -> Dict[str, object]:
    status = ROUND_MANAGER.get_status(round_id.strip())
    if not status:
        raise HTTPException(status_code=404, detail="Round not found.")
    return status


@app.post("/rounds/{round_id}/stop", response_model=StopRoundResponse)
def stop_round(round_id: str, payload: StopRoundPayload) -> Dict[str, object]:
    out = ROUND_MANAGER.stop_round(round_id.strip(), reason=(payload.reason or "manual_stop"))
    if not out:
        raise HTTPException(status_code=404, detail="Round not found.")
    return out

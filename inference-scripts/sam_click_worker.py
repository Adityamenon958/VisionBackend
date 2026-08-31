#!/usr/bin/env python3
"""
Persistent click-to-mask worker for the annotation editor.

Keeps a SAM / MobileSAM model in memory and reads one JSON line per request:

    {"id": "abc", "image": "C:/path/to.jpg", "x": 0.42, "y": 0.31}

x, y are normalized image coordinates in [0, 1] (origin = top-left).

Writes one JSON line per response:

    {"id": "abc", "ok": true, "polygon": [[0.1, 0.2], ...], "pointCount": 24}
    {"id": "abc", "ok": false, "error": "..."}

Startup (once, after the model loads):

    {"event": "ready", "model": "mobile_sam.pt"}

Env:
    SAM_MODEL   weight filename or path (default: mobile_sam.pt)
"""

from __future__ import annotations

import json
import os
import sys
import traceback

os.environ.setdefault("PYTHONUNBUFFERED", "1")

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def log(msg: str) -> None:
    sys.stderr.write(f"[sam-click] {msg}\n")
    sys.stderr.flush()


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


try:
    import cv2
    import numpy as np
except ImportError:
    log("ERROR: opencv-python and numpy are required")
    sys.exit(1)

try:
    from ultralytics import SAM
except ImportError:
    log("ERROR: ultralytics package not found. Install with: pip install ultralytics")
    sys.exit(1)


MODEL_NAME = os.environ.get("SAM_MODEL", "mobile_sam.pt").strip() or "mobile_sam.pt"
MAX_POINTS = int(os.environ.get("SAM_MAX_POLYGON_POINTS", "80"))
MIN_AREA_FRAC = float(os.environ.get("SAM_MIN_AREA_FRAC", "0.0002"))


def simplify_polygon_px(points_xy, width: int, height: int, max_points: int = MAX_POINTS):
    """Simplify a dense contour to a YOLO-friendly polygon in normalized [0, 1]."""
    pts = np.asarray(points_xy, dtype=np.float32).reshape(-1, 2)
    if pts.shape[0] < 3:
        return None

    contour = pts.reshape(-1, 1, 2).astype(np.float32)
    peri = float(cv2.arcLength(contour, True))
    if peri <= 0:
        return None

    epsilon = 0.002 * peri
    approx = contour
    for _ in range(16):
        approx = cv2.approxPolyDP(contour, epsilon, True)
        if len(approx) <= max_points and len(approx) >= 3:
            break
        epsilon *= 1.35

    approx = np.asarray(approx, dtype=np.float32).reshape(-1, 2)
    if approx.shape[0] < 3:
        return None

    polygon = []
    for x, y in approx:
        nx = float(np.clip(x / float(width), 0.0, 1.0))
        ny = float(np.clip(y / float(height), 0.0, 1.0))
        if polygon and abs(polygon[-1][0] - nx) < 1e-6 and abs(polygon[-1][1] - ny) < 1e-6:
            continue
        polygon.append([nx, ny])

    if len(polygon) >= 3:
        if abs(polygon[0][0] - polygon[-1][0]) < 1e-6 and abs(polygon[0][1] - polygon[-1][1]) < 1e-6:
            polygon = polygon[:-1]
    return polygon if len(polygon) >= 3 else None


def mask_to_polygon(mask: np.ndarray, orig_w: int, orig_h: int):
    """Largest external contour of a binary mask → simplified normalized polygon."""
    if mask is None or mask.size == 0:
        return None

    binary = mask
    if binary.dtype != np.uint8:
        binary = (binary > 0.5).astype(np.uint8)
    elif binary.max() > 1:
        binary = (binary > 127).astype(np.uint8)

    mh, mw = binary.shape[:2]
    if mw != orig_w or mh != orig_h:
        binary = cv2.resize(binary, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)

    area = float(binary.sum())
    if area < (orig_w * orig_h * MIN_AREA_FRAC):
        return None

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < (orig_w * orig_h * MIN_AREA_FRAC):
        return None
    return simplify_polygon_px(contour.reshape(-1, 2), orig_w, orig_h)


def polygon_from_result(result, orig_w: int, orig_h: int):
    masks = getattr(result, "masks", None)
    if masks is None:
        return None

    xy_list = getattr(masks, "xy", None)
    if xy_list is not None and len(xy_list) > 0:
        best = None
        best_len = -1
        for poly in xy_list:
            if poly is None:
                continue
            arr = np.asarray(poly)
            if arr.size < 6:
                continue
            if arr.shape[0] > best_len:
                best = arr
                best_len = arr.shape[0]
        if best is not None:
            simplified = simplify_polygon_px(best, orig_w, orig_h)
            if simplified:
                return simplified

    data = getattr(masks, "data", None)
    if data is None:
        return None
    try:
        arr = data.cpu().numpy() if hasattr(data, "cpu") else np.asarray(data)
    except Exception:
        arr = np.asarray(data)
    if arr.ndim == 3:
        # (N, H, W) — pick largest
        areas = arr.reshape(arr.shape[0], -1).sum(axis=1)
        idx = int(np.argmax(areas))
        return mask_to_polygon(arr[idx], orig_w, orig_h)
    if arr.ndim == 2:
        return mask_to_polygon(arr, orig_w, orig_h)
    return None


def run_click(model, image_path: str, nx: float, ny: float):
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")

    orig_h, orig_w = image.shape[:2]
    px = int(round(float(nx) * orig_w))
    py = int(round(float(ny) * orig_h))
    px = max(0, min(orig_w - 1, px))
    py = max(0, min(orig_h - 1, py))

    results = None
    last_err = None
    prompt_variants = (
        {"points": [[px, py]], "labels": [1]},
        {"points": [px, py], "labels": [1]},
    )
    for kwargs in prompt_variants:
        try:
            results = model.predict(
                source=image_path,
                verbose=False,
                save=False,
                **kwargs,
            )
            last_err = None
            break
        except Exception as exc:
            last_err = exc
            results = None
    if last_err and results is None:
        raise last_err
    if not results:
        return None

    polygon = polygon_from_result(results[0], orig_w, orig_h)
    return polygon


def main() -> int:
    log(f"Loading SAM model: {MODEL_NAME}")
    try:
        model = SAM(MODEL_NAME)
    except Exception as exc:
        log(f"Failed to load SAM model '{MODEL_NAME}': {exc}")
        emit({"event": "error", "error": f"Failed to load SAM model '{MODEL_NAME}': {exc}"})
        return 1

    emit({"event": "ready", "model": MODEL_NAME})
    log("Ready for click-to-mask requests")

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            image_path = req.get("image")
            nx = float(req.get("x"))
            ny = float(req.get("y"))
            if not image_path:
                raise ValueError("Missing image path")
            if not (0.0 <= nx <= 1.0 and 0.0 <= ny <= 1.0):
                raise ValueError("x and y must be normalized in [0, 1]")

            polygon = run_click(model, image_path, nx, ny)
            if not polygon:
                emit(
                    {
                        "id": req_id,
                        "ok": False,
                        "error": "No object found at that click. Try the center of the defect.",
                    }
                )
                continue

            emit(
                {
                    "id": req_id,
                    "ok": True,
                    "polygon": polygon,
                    "pointCount": len(polygon),
                }
            )
        except Exception as exc:
            log(traceback.format_exc())
            emit({"id": req_id, "ok": False, "error": str(exc) or "Click-to-mask failed"})

    return 0


if __name__ == "__main__":
    sys.exit(main())

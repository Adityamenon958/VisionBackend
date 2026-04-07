#!/usr/bin/env python3
"""
Print a JSON array of YOLO class names in index order for a trained checkpoint (.pt).
Matches inference: Ultralytics YOLO(model).names used in process_frame / run_inference.

Usage:
  python extract_yolo_class_names.py --model /path/to/best.pt
Stdout: ["class0", "class1", ...]
"""
import argparse
import json
import sys

try:
    from ultralytics import YOLO
except ImportError as e:
    print(f"ERROR: ultralytics not available: {e}", file=sys.stderr)
    sys.exit(2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Path to best.pt or compatible YOLO weights")
    args = parser.parse_args()
    model = YOLO(args.model)
    names = getattr(model, "names", None)
    ordered: list = []
    if names is None:
        print(json.dumps(ordered), flush=True)
        return
    if isinstance(names, dict):
        keys = sorted(names.keys(), key=lambda k: int(k) if str(k).isdigit() else str(k))
        ordered = [names[k] for k in keys]
    elif isinstance(names, (list, tuple)):
        ordered = [str(x) for x in names]
    print(json.dumps(ordered), flush=True)


if __name__ == "__main__":
    main()

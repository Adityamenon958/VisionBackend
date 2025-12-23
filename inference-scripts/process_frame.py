#!/usr/bin/env python3
"""
YOLO Single Frame Processing Script

This script processes a single image frame using a trained YOLO model.
Used for live camera inference where frames are sent one at a time.

Usage:
    python process_frame.py --model /path/to/model.pt --image /path/to/image.jpg --output /path/to/output.jpg --conf 0.25
    
    OR with base64:
    python process_frame.py --model /path/to/model.pt --image-base64 "data:image/jpeg;base64,..." --output /path/to/output.jpg --conf 0.25
"""

import argparse
import json
import os
import sys
import base64
from pathlib import Path

try:
    from ultralytics import YOLO
    import cv2
    import numpy as np
except ImportError as e:
    print(f"ERROR: Required package not found: {e}", file=sys.stderr)
    print("Install with: pip install ultralytics opencv-python numpy", file=sys.stderr)
    sys.exit(1)


def decode_base64_image(base64_string):
    """
    Decode base64 image string to OpenCV image.
    
    Args:
        base64_string: Base64 encoded image (with or without data URL prefix)
    
    Returns:
        numpy.ndarray: OpenCV image (BGR format)
    """
    try:
        # Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        
        # Decode base64
        image_data = base64.b64decode(base64_string)
        
        # Convert to numpy array
        nparr = np.frombuffer(image_data, np.uint8)
        
        # Decode image
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise ValueError("Failed to decode image from base64")
        
        return image
    except Exception as e:
        print(f"ERROR: Failed to decode base64 image: {e}", file=sys.stderr)
        sys.exit(1)


def process_frame(model_path, image_path_or_base64, output_path, conf=0.25, is_base64=False, annotations_only=False):
    """
    Process a single frame with YOLO model.
    
    Args:
        model_path: Path to YOLO model checkpoint
        image_path_or_base64: Path to image file OR base64 string
        output_path: Path to save annotated image (ignored if annotations_only=True)
        conf: Confidence threshold
        is_base64: True if image_path_or_base64 is base64, False if file path
        annotations_only: If True, skip drawing/saving annotated image (only return detections)
    
    Returns:
        dict: Detection results
    """
    try:
        # ✅ Validate model path
        if not os.path.exists(model_path):
            print(f"ERROR: Model file not found: {model_path}", file=sys.stderr)
            sys.exit(1)

        # ✅ Load image
        if is_base64:
            image = decode_base64_image(image_path_or_base64)
        else:
            if not os.path.exists(image_path_or_base64):
                print(f"ERROR: Image file not found: {image_path_or_base64}", file=sys.stderr)
                sys.exit(1)
            image = cv2.imread(image_path_or_base64)
            if image is None:
                print(f"ERROR: Failed to read image: {image_path_or_base64}", file=sys.stderr)
                sys.exit(1)

        # ✅ Load YOLO model
        model = YOLO(model_path)

        # ✅ Run inference
        results = model.predict(
            source=image,
            conf=conf,
            save=False,  # We'll save manually
            verbose=False  # Reduce output
        )

        if not results or len(results) == 0:
            print("ERROR: No results from model prediction", file=sys.stderr)
            sys.exit(1)

        result = results[0]

        # ✅ Get detections
        boxes = result.boxes
        detections = []
        total_detections = len(boxes)

        for box in boxes:
            cls = int(box.cls[0])
            conf_score = float(box.conf[0])
            xyxy = box.xyxy[0].tolist()  # [x1, y1, x2, y2]

            # Get class name
            class_name = result.names[cls] if hasattr(result, 'names') else f'class_{cls}'

            detections.append({
                'class': class_name,
                'confidence': conf_score,
                'bbox': xyxy
            })

        # ✅ Draw annotations on image (only if not in annotations-only mode)
        if not annotations_only:
            annotated_image = result.plot()  # YOLO's built-in plotting function

            # ✅ Ensure output directory exists
            output_dir = os.path.dirname(output_path)
            if output_dir and not os.path.exists(output_dir):
                os.makedirs(output_dir, exist_ok=True)

            # ✅ Save annotated image
            cv2.imwrite(output_path, annotated_image)

        # ✅ Print results as JSON (for backend to parse)
        result_data = {
            'totalDetections': total_detections,
            'detections': detections,
            'outputPath': output_path
        }

        # Print JSON to stdout (backend will read this)
        print(json.dumps(result_data))
        sys.stdout.flush()

        return 0

    except KeyboardInterrupt:
        print("\nProcessing interrupted by user", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"ERROR: Frame processing failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Process a single frame with YOLO model')
    parser.add_argument('--model', required=True, help='Path to YOLO model checkpoint')
    parser.add_argument('--image', help='Path to input image file')
    parser.add_argument('--image-base64', help='Base64 encoded image string')
    parser.add_argument('--output', help='Path to save annotated output image (required unless --annotations-only)')
    parser.add_argument('--conf', type=float, default=0.25, help='Confidence threshold (default: 0.25)')
    parser.add_argument('--annotations-only', action='store_true', help='Skip drawing/saving annotated image, only return detection data')

    args = parser.parse_args()

    # ✅ Validate that either --image or --image-base64 is provided
    if not args.image and not args.image_base64:
        print("ERROR: Either --image or --image-base64 must be provided", file=sys.stderr)
        sys.exit(1)

    if args.image and args.image_base64:
        print("ERROR: Cannot provide both --image and --image-base64", file=sys.stderr)
        sys.exit(1)

    # ✅ Validate output path (required unless annotations-only mode)
    if not args.annotations_only and not args.output:
        print("ERROR: --output is required unless --annotations-only is specified", file=sys.stderr)
        sys.exit(1)

    # ✅ Determine input type
    is_base64 = args.image_base64 is not None
    image_input = args.image_base64 if is_base64 else args.image

    # ✅ Use dummy output path if annotations-only mode (not used but required by function signature)
    output_path = args.output if args.output else '/dev/null'

    # ✅ Process frame
    exit_code = process_frame(
        model_path=args.model,
        image_path_or_base64=image_input,
        output_path=output_path,
        conf=args.conf,
        is_base64=is_base64,
        annotations_only=args.annotations_only
    )

    sys.exit(exit_code)


if __name__ == '__main__':
    main()



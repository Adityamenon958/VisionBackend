#!/usr/bin/env python3
"""
YOLO Long-Lived Process for Live Camera Inference

This script runs as a long-lived process that:
- Loads the YOLO model once at startup
- Processes frames sent via stdin (base64 encoded images)
- Returns detection results via stdout (JSON)
- Stays alive for the entire inference session

Usage:
    python process_frame_stream.py --model /path/to/model.pt --conf 0.25

Communication Protocol:
- Input: JSON lines via stdin, each line is: {"image": "base64_data", "conf": 0.25}
- Output: JSON lines via stdout, each line is: {"detections": [...], "totalDetections": N, "error": null}
"""

import argparse
import json
import os
import sys
import base64
import cv2
import numpy as np

try:
    from ultralytics import YOLO
except ImportError:
    print("ERROR: ultralytics package not found. Install with: pip install ultralytics", file=sys.stderr)
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
        raise ValueError(f"Failed to decode base64 image: {e}")


def process_frame(model, image_base64, conf_threshold):
    """
    Process a single frame with pre-loaded YOLO model.
    
    Args:
        model: Pre-loaded YOLO model instance
        image_base64: Base64 encoded image string
        conf_threshold: Confidence threshold
    
    Returns:
        dict: Detection results
    """
    try:
        # Decode image
        image = decode_base64_image(image_base64)
        
        # ✅ Get original image dimensions (BEFORE YOLO processing)
        # YOLO may resize internally, but coordinates are in original image size
        original_height, original_width = image.shape[:2]
        
        # Run inference
        results = model.predict(
            source=image,
            conf=conf_threshold,
            save=False,
            verbose=False
        )
        
        if not results or len(results) == 0:
            return {
                'detections': [],
                'totalDetections': 0,
                'imageWidth': original_width,  # ✅ Include image dimensions
                'imageHeight': original_height,
                'error': None
            }
        
        result = results[0]
        boxes = result.boxes
        mask_polygons = []
        if hasattr(result, 'masks') and result.masks is not None and hasattr(result.masks, 'xy'):
            mask_polygons = result.masks.xy or []
        detections = []
        
        for idx, box in enumerate(boxes):
            cls = int(box.cls[0])
            conf_score = float(box.conf[0])
            # ✅ YOLO returns coordinates in ORIGINAL image size (not resized)
            # These coordinates are absolute pixel values: [x1, y1, x2, y2]
            xyxy = box.xyxy[0].tolist()  # [x1, y1, x2, y2]
            
            # Get class name
            class_name = result.names[cls] if hasattr(result, 'names') else f'class_{cls}'
            
            detection = {
                'class': class_name,
                'confidence': conf_score,
                'bbox': xyxy  # Coordinates in original image size
            }
            if idx < len(mask_polygons):
                polygon = mask_polygons[idx]
                if polygon is not None and len(polygon) > 0:
                    detection['polygon'] = polygon.tolist()
            detections.append(detection)
        
        return {
            'detections': detections,
            'totalDetections': len(detections),
            'imageWidth': original_width,  # ✅ Include image dimensions for frontend scaling
            'imageHeight': original_height,
            'error': None
        }
        
    except Exception as e:
        return {
            'detections': [],
            'totalDetections': 0,
            'imageWidth': 0,
            'imageHeight': 0,
            'error': str(e)
        }


def main():
    """Main entry point - long-lived process."""
    parser = argparse.ArgumentParser(description='Long-lived YOLO inference process for live camera')
    parser.add_argument('--model', required=True, help='Path to YOLO model checkpoint')
    parser.add_argument('--conf', type=float, default=0.25, help='Default confidence threshold (default: 0.25)')
    
    args = parser.parse_args()
    
    # ✅ Validate model path
    import os
    if not os.path.exists(args.model):
        print(f"ERROR: Model file not found: {args.model}", file=sys.stderr)
        sys.exit(1)
    
    # ✅ Load YOLO model ONCE at startup
    print("Loading YOLO model...", file=sys.stderr)
    sys.stderr.flush()
    
    try:
        model = YOLO(args.model)
        print("Model loaded successfully", file=sys.stderr)
        sys.stderr.flush()
    except Exception as e:
        print(f"ERROR: Failed to load model: {e}", file=sys.stderr)
        sys.exit(1)
    
    # ✅ Process frames from stdin (one JSON line per frame)
    print("Ready to process frames", file=sys.stderr)
    sys.stderr.flush()
    
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            
            try:
                # Parse input JSON
                request = json.loads(line)
                request_id = request.get('requestId')  # ✅ Get request ID for matching
                image_base64 = request.get('image')
                conf_threshold = request.get('conf', args.conf)
                
                if not image_base64:
                    response = {
                        'requestId': request_id,  # ✅ Include request ID in response
                        'detections': [],
                        'totalDetections': 0,
                        'imageWidth': 0,  # ✅ Include image dimensions (0 if no image)
                        'imageHeight': 0,  # ✅ Include image dimensions (0 if no image)
                        'error': 'Missing image data'
                    }
                else:
                    # Process frame
                    frame_result = process_frame(model, image_base64, conf_threshold)
                    # ✅ Add request ID to response for matching
                    response = {
                        'requestId': request_id,
                        'detections': frame_result.get('detections', []),
                        'totalDetections': frame_result.get('totalDetections', 0),
                        'imageWidth': frame_result.get('imageWidth', 0),  # ✅ Include image dimensions for coordinate scaling
                        'imageHeight': frame_result.get('imageHeight', 0),  # ✅ Include image dimensions for coordinate scaling
                        'error': frame_result.get('error')
                    }
                
                # Send response as JSON line
                print(json.dumps(response))
                sys.stdout.flush()
                
            except json.JSONDecodeError as e:
                # Invalid JSON input - try to extract request ID if possible
                try:
                    request = json.loads(line)
                    request_id = request.get('requestId')
                except:
                    request_id = None
                response = {
                    'requestId': request_id,
                    'detections': [],
                    'totalDetections': 0,
                    'imageWidth': 0,  # ✅ Include image dimensions (0 on error)
                    'imageHeight': 0,  # ✅ Include image dimensions (0 on error)
                    'error': f'Invalid JSON input: {e}'
                }
                print(json.dumps(response))
                sys.stdout.flush()
            except Exception as e:
                # Processing error - try to extract request ID if possible
                try:
                    request = json.loads(line)
                    request_id = request.get('requestId')
                except:
                    request_id = None
                response = {
                    'requestId': request_id,
                    'detections': [],
                    'totalDetections': 0,
                    'imageWidth': 0,  # ✅ Include image dimensions (0 on error)
                    'imageHeight': 0,  # ✅ Include image dimensions (0 on error)
                    'error': str(e)
                }
                print(json.dumps(response))
                sys.stdout.flush()
                
    except KeyboardInterrupt:
        print("Process interrupted", file=sys.stderr)
        sys.exit(0)
    except Exception as e:
        print(f"ERROR: Process error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()



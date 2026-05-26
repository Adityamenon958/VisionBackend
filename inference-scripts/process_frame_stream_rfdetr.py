#!/usr/bin/env python3
"""
Long-lived RF-DETR-N process for live camera inference.

Usage:
    python process_frame_stream_rfdetr.py --model /path/to/best.pth --conf 0.25

stdin: JSON lines {"requestId": "...", "image": "base64...", "conf": 0.25}
stdout: JSON lines {"requestId": "...", "detections": [...], "totalDetections": N, ...}
"""

import argparse
import base64
import json
import os
import sys

import cv2
import numpy as np

try:
    from rfdetr import RFDETRNano
except ImportError:
    print('ERROR: rfdetr not installed', file=sys.stderr)
    sys.exit(1)

from detection_output import load_class_names, detections_to_list


def decode_base64_image(base64_string):
    if ',' in base64_string:
        base64_string = base64_string.split(',')[1]
    image_data = base64.b64decode(base64_string)
    nparr = np.frombuffer(image_data, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('Failed to decode image from base64')
    return image


def process_frame(model, class_names, image_base64, conf_threshold):
    try:
        image_bgr = decode_base64_image(image_base64)
        h, w = image_bgr.shape[:2]
        from PIL import Image
        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        detections = model.predict(pil, threshold=conf_threshold)
        det_list = detections_to_list(detections, class_names)
        return {
            'detections': det_list,
            'totalDetections': len(det_list),
            'imageWidth': w,
            'imageHeight': h,
            'error': None,
        }
    except Exception as e:
        return {
            'detections': [],
            'totalDetections': 0,
            'imageWidth': 0,
            'imageHeight': 0,
            'error': str(e),
        }


def _response(request_id, frame_result=None, error=None):
    if frame_result is None:
        frame_result = {
            'detections': [],
            'totalDetections': 0,
            'imageWidth': 0,
            'imageHeight': 0,
            'error': error,
        }
    return {
        'requestId': request_id,
        'detections': frame_result.get('detections', []),
        'totalDetections': frame_result.get('totalDetections', 0),
        'imageWidth': frame_result.get('imageWidth', 0),
        'imageHeight': frame_result.get('imageHeight', 0),
        'error': frame_result.get('error') if error is None else error,
    }


def main():
    parser = argparse.ArgumentParser(description='RF-DETR live frame processor')
    parser.add_argument('--model', required=True)
    parser.add_argument('--conf', type=float, default=0.25)
    args = parser.parse_args()

    if not os.path.exists(args.model):
        print(f'ERROR: Model file not found: {args.model}', file=sys.stderr)
        sys.exit(1)

    config = {'class_names_yaml': os.path.join(os.path.dirname(args.model), 'data.yaml')}
    class_names = load_class_names(config, args.model)

    print('Loading RF-DETR model...', file=sys.stderr)
    sys.stderr.flush()
    try:
        model = RFDETRNano(pretrain_weights=args.model)
        print('Model loaded successfully', file=sys.stderr)
        sys.stderr.flush()
    except Exception as e:
        print(f'ERROR: Failed to load model: {e}', file=sys.stderr)
        sys.exit(1)

    print('Ready to process frames', file=sys.stderr)
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get('requestId')
            image_b64 = request.get('image')
            conf = float(request.get('conf', args.conf))

            if not image_b64:
                out = _response(request_id, error='Missing image data')
            else:
                frame_result = process_frame(model, class_names, image_b64, conf)
                out = _response(request_id, frame_result=frame_result)

            print(json.dumps(out))
            sys.stdout.flush()

        except json.JSONDecodeError as e:
            try:
                request = json.loads(line)
                request_id = request.get('requestId')
            except Exception:
                request_id = None
            print(json.dumps(_response(request_id, error=f'Invalid JSON input: {e}')))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps(_response(request_id, error=str(e))))
            sys.stdout.flush()


if __name__ == '__main__':
    main()

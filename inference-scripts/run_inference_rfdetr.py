#!/usr/bin/env python3
"""
RF-DETR batch inference for VisionBackend (images; videos processed frame-by-frame).

Usage:
    python run_inference_rfdetr.py --config /path/to/inference-config.json

Config JSON:
  model, source, output, conf (optional), class_names (optional list)
"""

import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

try:
    from rfdetr import RFDETRNano
except ImportError:
    print('ERROR: rfdetr not installed. pip install rfdetr', file=sys.stderr)
    sys.exit(1)

try:
    import supervision as sv
except ImportError:
    sv = None

from detection_output import load_class_names, detections_to_list


def load_config(config_path):
    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def annotate_and_save(image_bgr, detections, class_names, out_path):
    if sv is None:
        cv2.imwrite(out_path, image_bgr)
        return
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    from PIL import Image
    pil = Image.fromarray(rgb)
    labels = []
    if detections is not None and len(detections) > 0:
        for i in range(len(detections)):
            cid = int(detections.class_id[i])
            if class_names and 0 <= cid < len(class_names):
                labels.append(class_names[cid])
            else:
                labels.append(f'class_{cid}')
    annotated = sv.BoxAnnotator().annotate(pil, detections)
    if labels:
        annotated = sv.LabelAnnotator().annotate(annotated, detections, labels)
    out_bgr = cv2.cvtColor(np.array(annotated), cv2.COLOR_RGB2BGR)
    cv2.imwrite(out_path, out_bgr)


def process_image(model, image_path, conf, class_names, annotated_dir):
    image_bgr = cv2.imread(image_path)
    if image_bgr is None:
        raise ValueError(f'Cannot read image: {image_path}')

    from PIL import Image
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb)
    detections = model.predict(pil, threshold=conf)
    det_list = detections_to_list(detections, class_names)

    h, w = image_bgr.shape[:2]
    out_name = os.path.basename(image_path)
    out_path = os.path.join(annotated_dir, out_name)
    annotate_and_save(image_bgr, detections, class_names, out_path)

    return {
        'fileName': out_name,
        'fileType': 'image',
        'filePath': image_path,
        'annotatedPath': out_path,
        'detections': det_list,
        'totalDetections': len(det_list),
        'imageWidth': w,
        'imageHeight': h,
    }


def process_video(model, video_path, conf, class_names, annotated_dir):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f'Cannot open video: {video_path}')

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    base = os.path.splitext(os.path.basename(video_path))[0]
    out_path = os.path.join(annotated_dir, f'{base}_annotated.mp4')
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(out_path, fourcc, fps, (w, h))

    from PIL import Image
    all_detections = []
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        detections = model.predict(pil, threshold=conf)
        if sv is not None and detections is not None and len(detections) > 0:
            from PIL import Image as PILImage
            annotated = sv.BoxAnnotator().annotate(PILImage.fromarray(rgb), detections)
            frame_out = cv2.cvtColor(np.array(annotated), cv2.COLOR_RGB2BGR)
        else:
            frame_out = frame
        writer.write(frame_out)
        for d in detections_to_list(detections, class_names):
            d['frame'] = frame_idx
            all_detections.append(d)
        frame_idx += 1

    cap.release()
    writer.release()

    return {
        'fileName': os.path.basename(out_path),
        'fileType': 'video',
        'filePath': video_path,
        'annotatedPath': out_path,
        'detections': all_detections,
        'totalDetections': len(all_detections),
        'imageWidth': w,
        'imageHeight': h,
    }


def run_inference(config):
    model_path = config.get('model')
    source = config.get('source')
    output = config.get('output')
    conf = float(config.get('conf', 0.25))

    if not model_path or not source or not output:
        print('ERROR: model, source, and output are required', file=sys.stderr)
        return 1

    if not os.path.exists(model_path):
        print(f'ERROR: Model not found: {model_path}', file=sys.stderr)
        return 1
    if not os.path.exists(source):
        print(f'ERROR: Source not found: {source}', file=sys.stderr)
        return 1

    os.makedirs(output, exist_ok=True)
    annotated_dir = os.path.join(output, 'annotated')
    os.makedirs(annotated_dir, exist_ok=True)

    class_names = load_class_names(config, model_path)
    print(f'Loading RF-DETR-N from: {model_path}')
    sys.stdout.flush()
    model = RFDETRNano(pretrain_weights=model_path)
    print('Model loaded successfully')
    sys.stdout.flush()

    image_ext = {'.jpg', '.jpeg', '.png'}
    video_ext = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v'}

    files = []
    if os.path.isfile(source):
        files = [source]
    else:
        files = [
            os.path.join(source, f)
            for f in os.listdir(source)
            if os.path.isfile(os.path.join(source, f))
        ]

    image_files = []
    video_files = []
    all_detections = []
    detections_by_class = {}
    total_detections = 0

    for idx, fp in enumerate(files):
        ext = os.path.splitext(fp)[1].lower()
        if ext in image_ext:
            print(f'Processing image {idx + 1}/{len(files)}: {os.path.basename(fp)}')
            sys.stdout.flush()
            meta = process_image(model, fp, conf, class_names, annotated_dir)
            image_files.append(meta)
            all_detections.append(meta)
            total_detections += meta['totalDetections']
            for d in meta['detections']:
                cn = d['class']
                detections_by_class.setdefault(cn, {'count': 0, 'confidences': []})
                detections_by_class[cn]['count'] += 1
                detections_by_class[cn]['confidences'].append(d['confidence'])
        elif ext in video_ext:
            print(f'Processing video {idx + 1}/{len(files)}: {os.path.basename(fp)}')
            sys.stdout.flush()
            meta = process_video(model, fp, conf, class_names, annotated_dir)
            video_files.append(meta)
            all_detections.append(meta)
            total_detections += meta['totalDetections']

    all_confidences = [
        d['confidence']
        for item in all_detections
        for d in item.get('detections', [])
    ]
    average_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0

    detections_by_class_list = []
    for class_name, stats in detections_by_class.items():
        avg_conf = (
            sum(stats['confidences']) / len(stats['confidences'])
            if stats['confidences']
            else 0.0
        )
        detections_by_class_list.append({
            'className': class_name,
            'count': stats['count'],
            'avgConfidence': avg_conf,
        })

    metadata = {
        'totalFiles': len(all_detections),
        'totalImages': len(image_files),
        'totalVideos': len(video_files),
        'totalDetections': total_detections,
        'averageConfidence': average_confidence,
        'detectionsByClass': detections_by_class_list,
        'files': all_detections,
        'images': image_files,
        'videos': video_files,
        'modelBackend': 'RF_DETR',
    }

    metadata_path = os.path.join(output, 'metadata.json')
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    print(f'Metadata saved to: {metadata_path}')
    print(f'Total detections: {total_detections}')
    sys.stdout.flush()
    return 0


def main():
    parser = argparse.ArgumentParser(description='Run RF-DETR inference')
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    sys.exit(run_inference(config))


if __name__ == '__main__':
    main()

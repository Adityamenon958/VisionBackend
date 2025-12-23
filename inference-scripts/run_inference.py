#!/usr/bin/env python3
"""
YOLO Inference Script

This script runs inference on images and videos using a trained YOLO model.
It reads a JSON config file and runs YOLO inference, outputting
annotated images/videos and metadata.

Usage:
    python run_inference.py --config /path/to/inference-config.json
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    from ultralytics import YOLO
except ImportError:
    print("ERROR: ultralytics package not found. Install with: pip install ultralytics", file=sys.stderr)
    sys.exit(1)


def load_config(config_path):
    """Load inference configuration from JSON file."""
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        return config
    except FileNotFoundError:
        print(f"ERROR: Config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in config file: {e}", file=sys.stderr)
        sys.exit(1)


def run_inference(config):
    """Run YOLO inference with given configuration."""
    try:
        # Extract config values
        model_path = config.get('model')
        source = config.get('source')  # Image/video file or folder
        output = config.get('output')  # Output directory
        conf = config.get('conf', 0.25)  # Confidence threshold
        
        # ✅ Detect if source contains videos
        video_extensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v']
        is_video_file = os.path.isfile(source) and any(source.lower().endswith(ext) for ext in video_extensions)
        
        # ✅ If source is a folder, check for videos
        has_videos = False
        if os.path.isdir(source):
            files = os.listdir(source)
            has_videos = any(any(f.lower().endswith(ext) for ext in video_extensions) for f in files)

        # Validate required fields
        if not model_path:
            print("ERROR: 'model' field (path to model checkpoint) is required in config", file=sys.stderr)
            sys.exit(1)

        if not source:
            print("ERROR: 'source' field (path to image or folder) is required in config", file=sys.stderr)
            sys.exit(1)

        if not output:
            print("ERROR: 'output' field (path to output directory) is required in config", file=sys.stderr)
            sys.exit(1)

        # Validate paths
        if not os.path.exists(model_path):
            print(f"ERROR: Model file not found: {model_path}", file=sys.stderr)
            sys.exit(1)

        if not os.path.exists(source):
            print(f"ERROR: Source path not found: {source}", file=sys.stderr)
            sys.exit(1)

        # ✅ Create output directory
        os.makedirs(output, exist_ok=True)

        print(f"Loading model from: {model_path}")
        sys.stdout.flush()

        # ✅ Load YOLO model
        model = YOLO(model_path)

        print(f"✅ Model loaded successfully")
        print(f"Running inference on: {source}")
        print(f"Output directory: {output}")
        print(f"Confidence threshold: {conf}")
        if is_video_file or has_videos:
            print(f"🎬 Video files detected - will process videos")
        print("-" * 80)
        sys.stdout.flush()

        # ✅ Run inference
        # YOLO's predict() method can handle images, videos, and folders
        # For images: saves annotated images to {output}/annotated/
        # For videos: saves annotated videos to {output}/annotated/
        results = model.predict(
            source=source,
            save=True,  # Save annotated images/videos
            save_txt=False,  # Don't save label files (we only need images/videos)
            conf=conf,  # Confidence threshold
            project=output,  # Output project directory
            name='annotated',  # Subdirectory name within project (creates output/annotated/)
            exist_ok=True  # Overwrite if exists
        )

        print("-" * 80)
        print("✅ Inference completed successfully!")
        sys.stdout.flush()

        # ✅ Collect metadata from results
        total_files = len(results)
        total_detections = 0
        all_detections = []
        detections_by_class = {}
        video_files = []
        image_files = []

        for i, result in enumerate(results):
            file_path = result.path
            file_name = os.path.basename(file_path)
            
            # ✅ Detect if this is a video file
            is_video = any(file_name.lower().endswith(ext) for ext in video_extensions)
            file_type = 'video' if is_video else 'image'

            # ✅ Update progress
            if is_video:
                print(f"Processing video {i + 1}/{total_files}: {file_name}")
            else:
                print(f"Processing image {i + 1}/{total_files}: {file_name}")
            sys.stdout.flush()

            # ✅ For videos, YOLO processes frame by frame
            # result.boxes contains detections from all frames combined
            # For images, result.boxes contains detections from that image
            boxes = result.boxes
            num_detections = len(boxes) if boxes is not None else 0

            total_detections += num_detections

            file_detections = []
            if boxes is not None:
                for box in boxes:
                    # Get class, confidence, and bounding box
                    cls = int(box.cls[0])
                    conf = float(box.conf[0])
                    xyxy = box.xyxy[0].tolist()  # [x1, y1, x2, y2]

                    # Get class name
                    class_name = result.names[cls] if hasattr(result, 'names') else f'class_{cls}'

                    detection = {
                        'class': class_name,
                        'confidence': conf,
                        'bbox': xyxy
                    }
                    file_detections.append(detection)

                    # ✅ Track detections by class
                    if class_name not in detections_by_class:
                        detections_by_class[class_name] = {
                            'count': 0,
                            'confidences': []
                        }
                    detections_by_class[class_name]['count'] += 1
                    detections_by_class[class_name]['confidences'].append(conf)

            # ✅ YOLO saves annotated files to {output}/annotated/{file_name}
            file_info = {
                'filePath': file_name,
                'fileType': file_type,
                'annotatedPath': os.path.join('annotated', file_name),
                'detections': file_detections,
                'detectionCount': num_detections
            }
            
            all_detections.append(file_info)
            
            if is_video:
                video_files.append(file_info)
            else:
                image_files.append(file_info)

        # ✅ Calculate average confidence
        all_confidences = []
        for det in all_detections:
            for d in det['detections']:
                all_confidences.append(d['confidence'])

        average_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0

        # ✅ Calculate average confidence per class
        detections_by_class_list = []
        for class_name, stats in detections_by_class.items():
            avg_conf = sum(stats['confidences']) / len(stats['confidences']) if stats['confidences'] else 0.0
            detections_by_class_list.append({
                'className': class_name,
                'count': stats['count'],
                'avgConfidence': avg_conf
            })

        # ✅ Generate metadata JSON
        metadata = {
            'totalFiles': total_files,
            'totalImages': len(image_files),
            'totalVideos': len(video_files),
            'totalDetections': total_detections,
            'averageConfidence': average_confidence,
            'detectionsByClass': detections_by_class_list,
            'files': all_detections,  # All files (images + videos)
            'images': image_files,  # Image files only
            'videos': video_files  # Video files only
        }

        # ✅ Save metadata to JSON file
        metadata_path = os.path.join(output, 'metadata.json')
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

        print(f"✅ Metadata saved to: {metadata_path}")
        print(f"📊 Total files processed: {total_files} ({len(image_files)} images, {len(video_files)} videos)")
        print(f"📊 Total detections: {total_detections}")
        print(f"📊 Average confidence: {average_confidence:.4f}")
        sys.stdout.flush()

        return 0

    except KeyboardInterrupt:
        print("\nInference interrupted by user", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"ERROR: Inference failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Run YOLO inference')
    parser.add_argument('--config', required=True, help='Path to inference config JSON file')

    args = parser.parse_args()

    # Load configuration
    config = load_config(args.config)

    # Run inference
    exit_code = run_inference(config)

    sys.exit(exit_code)


if __name__ == '__main__':
    main()


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

try:
    # ✅ moviepy 2.x uses direct import (not moviepy.editor)
    from moviepy import VideoFileClip
except ImportError:
    # ✅ Fallback for older moviepy versions
    try:
        from moviepy.editor import VideoFileClip
    except ImportError:
        print("ERROR: moviepy package not found. Install with: pip install moviepy", file=sys.stderr)
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


def convert_avi_to_mp4(source_path, mp4_path):
    """
    Convert video file to MP4 format for browser compatibility.
    
    Args:
        source_path: Path to input video file (any format)
        mp4_path: Path to output MP4 file
    
    Returns:
        bool: True if conversion successful, False otherwise
    """
    try:
        source_name = os.path.basename(source_path)
        mp4_name = os.path.basename(mp4_path)
        print(f"🔄 Converting {source_name} to MP4 format ({mp4_name})...")
        sys.stdout.flush()
        
        # Check if source file exists
        if not os.path.exists(source_path):
            print(f"❌ Error: Source file not found: {source_path}", file=sys.stderr)
            sys.stdout.flush()
            return False
        
        # Load video clip
        clip = VideoFileClip(source_path)
        
        # Write as MP4 with H.264 codec (browser-compatible)
        clip.write_videofile(
            mp4_path,
            codec='libx264',  # H.264 codec (widely supported)
            audio_codec='aac',  # AAC audio codec
            preset='medium',  # Encoding speed vs quality balance
            bitrate='5000k',  # Video bitrate
            audio_bitrate='128k',  # Audio bitrate
            logger=None  # Suppress verbose output
        )
        
        # Close clip to free resources
        clip.close()
        
        # Verify MP4 file was created
        if os.path.exists(mp4_path):
            print(f"✅ Conversion completed successfully: {mp4_name}")
            sys.stdout.flush()
            return True
        else:
            print(f"❌ Error: MP4 file was not created: {mp4_path}", file=sys.stderr)
            sys.stdout.flush()
            return False
        
    except Exception as e:
        print(f"❌ Error: Failed to convert {source_path} to MP4: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.stdout.flush()
        return False


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

        # ✅ Annotated output directory
        annotated_dir = os.path.join(output, 'annotated')
        
        for i, result in enumerate(results):
            # ✅ YOLO saves files to {output}/annotated/ with the same name as source
            # result.path might be source path, but saved file is in annotated_dir
            file_path = result.path
            source_file_name = os.path.basename(file_path)
            
            # ✅ The actual saved file name (YOLO preserves original name)
            saved_file_name = source_file_name
            
            # ✅ Detect if this is a video file
            is_video = any(saved_file_name.lower().endswith(ext) for ext in video_extensions)
            file_type = 'video' if is_video else 'image'

            # ✅ Update progress
            if is_video:
                print(f"Processing video {i + 1}/{total_files}: {saved_file_name}")
            else:
                print(f"Processing image {i + 1}/{total_files}: {saved_file_name}")
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

            # ✅ Handle video conversion: Convert all videos to MP4 for browser compatibility
            final_file_name = saved_file_name
            if is_video:
                # ✅ Convert any video format to MP4 (not just AVI)
                video_extensions_list = ['.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v']
                current_ext = os.path.splitext(saved_file_name)[1].lower()
                
                # Only convert if not already MP4
                if current_ext != '.mp4':
                    # ✅ YOLO saves to {output}/annotated/{saved_file_name}
                    source_video_path = os.path.join(annotated_dir, saved_file_name)
                    mp4_file_name = os.path.splitext(saved_file_name)[0] + '.mp4'
                    mp4_path = os.path.join(annotated_dir, mp4_file_name)
                    
                    print(f"🔍 Checking for video file at: {source_video_path}")
                    sys.stdout.flush()
                    
                    if os.path.exists(source_video_path):
                        print(f"🔄 Converting {saved_file_name} to MP4 format...")
                        sys.stdout.flush()
                        
                        # Convert to MP4
                        if convert_avi_to_mp4(source_video_path, mp4_path):
                            # Update file name to MP4
                            final_file_name = mp4_file_name
                            
                            # Delete original video file
                            try:
                                os.remove(source_video_path)
                                print(f"🗑️ Deleted original video file: {saved_file_name}")
                                sys.stdout.flush()
                            except Exception as e:
                                print(f"⚠️ Warning: Could not delete original video file {source_video_path}: {e}", file=sys.stderr)
                                sys.stdout.flush()
                        else:
                            # Conversion failed, keep original video
                            print(f"⚠️ Warning: Conversion failed, keeping original video file: {saved_file_name}")
                            sys.stdout.flush()
                    else:
                        # ✅ Try alternative: check if YOLO saved with different name
                        print(f"⚠️ Warning: Source video file not found at: {source_video_path}")
                        print(f"🔍 Listing files in annotated directory: {annotated_dir}")
                        sys.stdout.flush()
                        if os.path.exists(annotated_dir):
                            try:
                                files_in_dir = os.listdir(annotated_dir)
                                print(f"📁 Files in annotated dir: {files_in_dir}")
                                sys.stdout.flush()
                                # Try to find any video file
                                video_files_in_dir = [f for f in files_in_dir if any(f.lower().endswith(ext) for ext in video_extensions_list + ['.mp4'])]
                                if video_files_in_dir:
                                    print(f"🎬 Found video files: {video_files_in_dir}")
                                    sys.stdout.flush()
                                    # Use the first video file found
                                    found_video = video_files_in_dir[0]
                                    if not found_video.lower().endswith('.mp4'):
                                        source_video_path = os.path.join(annotated_dir, found_video)
                                        mp4_file_name = os.path.splitext(found_video)[0] + '.mp4'
                                        mp4_path = os.path.join(annotated_dir, mp4_file_name)
                                        print(f"🔄 Attempting conversion of found file: {found_video}")
                                        sys.stdout.flush()
                                        if convert_avi_to_mp4(source_video_path, mp4_path):
                                            final_file_name = mp4_file_name
                                            try:
                                                os.remove(source_video_path)
                                                print(f"🗑️ Deleted original: {found_video}")
                                                sys.stdout.flush()
                                            except:
                                                pass
                            except Exception as e:
                                print(f"⚠️ Error listing directory: {e}", file=sys.stderr)
                                sys.stdout.flush()
                else:
                    # Already MP4, no conversion needed
                    print(f"✅ Video is already in MP4 format: {saved_file_name}")
                    sys.stdout.flush()

            # ✅ YOLO saves annotated files to {output}/annotated/{file_name}
            # Use final_file_name (MP4 if converted, original otherwise)
            # ✅ Ensure annotatedPath uses forward slashes (consistent across platforms)
            annotated_path = os.path.join('annotated', final_file_name).replace('\\', '/')
            file_info = {
                'filePath': final_file_name,
                'fileType': file_type,
                'annotatedPath': annotated_path,  # ✅ Use forward slashes for consistency
                'detections': file_detections,
                'detectionCount': num_detections
            }
            
            all_detections.append(file_info)
            
            if is_video:
                video_files.append(file_info)
            else:
                image_files.append(file_info)

        # ✅ POST-PROCESSING: Scan annotated directory and convert any non-MP4 videos
        # This handles the case where YOLO saves videos as .avi on Windows regardless of source filename
        print("-" * 80)
        print("🔍 Post-processing: Checking for videos that need conversion...")
        sys.stdout.flush()
        
        if os.path.exists(annotated_dir):
            try:
                actual_files = os.listdir(annotated_dir)
                video_extensions_to_convert = ['.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v']
                
                # ✅ Find all video files that are NOT MP4
                videos_to_convert = [
                    f for f in actual_files 
                    if any(f.lower().endswith(ext) for ext in video_extensions_to_convert)
                ]
                
                if videos_to_convert:
                    print(f"📹 Found {len(videos_to_convert)} video(s) that need conversion to MP4")
                    sys.stdout.flush()
                    
                    # ✅ Create a mapping of original filename (without extension) to list of file info objects
                    # This handles cases where multiple videos have the same base name
                    filename_to_info_list = {}
                    for file_info in all_detections:
                        if file_info['fileType'] == 'video':
                            base_name = os.path.splitext(file_info['filePath'])[0]
                            if base_name not in filename_to_info_list:
                                filename_to_info_list[base_name] = []
                            filename_to_info_list[base_name].append(file_info)
                    
                    # ✅ Convert each video
                    for video_file in videos_to_convert:
                        source_video_path = os.path.join(annotated_dir, video_file)
                        base_name = os.path.splitext(video_file)[0]
                        mp4_file_name = base_name + '.mp4'
                        mp4_path = os.path.join(annotated_dir, mp4_file_name)
                        
                        print(f"🔄 Converting {video_file} to {mp4_file_name}...")
                        sys.stdout.flush()
                        
                        if convert_avi_to_mp4(source_video_path, mp4_path):
                            # ✅ Update metadata for all videos with this base name
                            if base_name in filename_to_info_list:
                                for file_info in filename_to_info_list[base_name]:
                                    file_info['filePath'] = mp4_file_name
                                    file_info['annotatedPath'] = os.path.join('annotated', mp4_file_name).replace('\\', '/')
                            
                            # ✅ Delete original video file
                            try:
                                os.remove(source_video_path)
                                print(f"🗑️ Deleted original video file: {video_file}")
                                sys.stdout.flush()
                            except Exception as e:
                                print(f"⚠️ Warning: Could not delete original video file {source_video_path}: {e}", file=sys.stderr)
                                sys.stdout.flush()
                        else:
                            print(f"⚠️ Warning: Failed to convert {video_file}, keeping original", file=sys.stderr)
                            sys.stdout.flush()
                else:
                    print("✅ All videos are already in MP4 format")
                    sys.stdout.flush()
            except Exception as e:
                print(f"⚠️ Warning: Error during video post-processing: {e}", file=sys.stderr)
                sys.stdout.flush()

        # ✅ POST-PROCESSING: Match actual saved image filenames with metadata
        # YOLO may normalize extensions (e.g., .jpeg -> .jpg) when saving
        print("-" * 80)
        print("🔍 Post-processing: Matching actual saved image filenames...")
        sys.stdout.flush()
        
        if os.path.exists(annotated_dir):
            try:
                actual_files = os.listdir(annotated_dir)
                image_extensions = ['.jpg', '.jpeg', '.png']
                
                # ✅ Find all image files in annotated directory
                actual_image_files = [
                    f for f in actual_files 
                    if any(f.lower().endswith(ext) for ext in image_extensions)
                ]
                
                if actual_image_files:
                    print(f"📸 Found {len(actual_image_files)} image file(s) in annotated directory")
                    sys.stdout.flush()
                    
                    # ✅ Create a mapping of base name (without extension) to actual filename
                    # This handles cases where YOLO changes extensions (e.g., .jpeg -> .jpg)
                    base_name_to_actual_file = {}
                    for actual_file in actual_image_files:
                        base_name = os.path.splitext(actual_file)[0]
                        # Handle multiple files with same base name (take the first one found)
                        if base_name not in base_name_to_actual_file:
                            base_name_to_actual_file[base_name] = actual_file
                    
                    # ✅ Update metadata for images that don't match actual filenames
                    updated_count = 0
                    for file_info in image_files:
                        if file_info['fileType'] == 'image':
                            expected_filename = file_info['filePath']
                            expected_base = os.path.splitext(expected_filename)[0]
                            
                            # Check if actual file exists with different extension
                            if expected_base in base_name_to_actual_file:
                                actual_filename = base_name_to_actual_file[expected_base]
                                
                                # If filename differs, update metadata
                                if actual_filename != expected_filename:
                                    print(f"🔄 Updating filename: {expected_filename} -> {actual_filename}")
                                    sys.stdout.flush()
                                    file_info['filePath'] = actual_filename
                                    file_info['annotatedPath'] = os.path.join('annotated', actual_filename).replace('\\', '/')
                                    updated_count += 1
                    
                    if updated_count > 0:
                        print(f"✅ Updated {updated_count} image filename(s) in metadata")
                        sys.stdout.flush()
                    else:
                        print("✅ All image filenames match actual saved files")
                        sys.stdout.flush()
                else:
                    print("⚠️ No image files found in annotated directory")
                    sys.stdout.flush()
            except Exception as e:
                print(f"⚠️ Warning: Error during image filename matching: {e}", file=sys.stderr)
                sys.stdout.flush()

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


#!/usr/bin/env python3
"""
Convert YOLO PyTorch model to ONNX format

This script converts a YOLO PyTorch model (.pt) to ONNX format (.onnx).
It uses the ultralytics library's built-in export functionality.

Usage:
    python convert-to-onnx.py --input /path/to/best.pt --output /path/to/best.onnx

Example:
    python convert-to-onnx.py --input models/gsn/annotation/v2/best.pt --output models/gsn/annotation/v2/best.onnx
"""

import argparse
import sys
import os
from pathlib import Path

try:
    from ultralytics import YOLO
except ImportError:
    print("ERROR: ultralytics package not found. Install with: pip install ultralytics", file=sys.stderr)
    sys.exit(1)


def convert_to_onnx(input_path, output_path):
    """
    Convert YOLO model from PyTorch to ONNX format.
    
    Args:
        input_path: Path to input .pt model file
        output_path: Path where .onnx file should be saved
        
    Returns:
        bool: True if conversion successful, False otherwise
    """
    try:
        # Validate input file exists
        if not os.path.exists(input_path):
            print(f"ERROR: Input file not found: {input_path}", file=sys.stderr)
            return False
        
        # Ensure output directory exists
        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)
        
        print(f"📦 Loading model: {input_path}")
        sys.stdout.flush()
        
        # Load YOLO model
        model = YOLO(input_path)
        
        print(f"🔄 Converting to ONNX format...")
        sys.stdout.flush()
        
        # Export to ONNX
        # YOLO exports to same directory as input with .onnx extension
        # We'll move it to the desired output path
        exported_path = model.export(format='onnx', imgsz=640, simplify=True)
        
        # exported_path is the path where YOLO saved the file
        if os.path.exists(exported_path):
            # If output path is different, move the file
            if exported_path != output_path:
                import shutil
                shutil.move(exported_path, output_path)
                print(f"✅ Moved ONNX file to: {output_path}")
            else:
                print(f"✅ ONNX file saved to: {output_path}")
            
            # Verify file was created
            if os.path.exists(output_path):
                file_size = os.path.getsize(output_path)
                file_size_mb = file_size / (1024 * 1024)
                print(f"✅ Conversion successful! File size: {file_size_mb:.2f} MB")
                sys.stdout.flush()
                return True
            else:
                print(f"ERROR: ONNX file not found at output path: {output_path}", file=sys.stderr)
                return False
        else:
            print(f"ERROR: ONNX export failed. File not created at: {exported_path}", file=sys.stderr)
            return False
            
    except Exception as e:
        print(f"ERROR: Conversion failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Convert YOLO PyTorch model to ONNX format'
    )
    parser.add_argument(
        '--input',
        required=True,
        help='Path to input .pt model file'
    )
    parser.add_argument(
        '--output',
        required=True,
        help='Path where output .onnx file should be saved'
    )
    
    args = parser.parse_args()
    
    # Convert paths to absolute
    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)
    
    success = convert_to_onnx(input_path, output_path)
    sys.exit(0 if success else 1)

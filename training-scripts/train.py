#!/usr/bin/env python3
"""
YOLO Training Script

This script trains a YOLO model using the configuration provided by the backend.
It reads a JSON config file and runs YOLO training, outputting logs in a format
that the Node.js worker can parse.

Usage:
    python train.py --config /path/to/training-config.json
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
    """Load training configuration from JSON file."""
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


def update_data_yaml(data_yaml_path, dataset_path):
    """Update data.yaml with actual class count and names from dataset."""
    try:
        # Read labels to determine number of classes
        labels_path = Path(dataset_path) / 'labels' / 'train'
        class_names = set()
        
        if labels_path.exists():
            for label_file in labels_path.glob('*.txt'):
                try:
                    with open(label_file, 'r') as f:
                        for line in f:
                            parts = line.strip().split()
                            if parts:
                                class_id = int(parts[0])
                                class_names.add(f'class_{class_id}')
                except Exception:
                    continue
        
        # Sort class names to ensure consistent ordering
        class_names = sorted(list(class_names))
        num_classes = len(class_names) if class_names else 0
        
        # If no classes found, default to 1
        if num_classes == 0:
            num_classes = 1
            class_names = ['class_0']
        
        # Read existing data.yaml
        with open(data_yaml_path, 'r') as f:
            content = f.read()
        
        # Update nc and names
        lines = content.split('\n')
        updated_lines = []
        for line in lines:
            if line.startswith('nc:'):
                updated_lines.append(f'nc: {num_classes}')
            elif line.startswith('names:'):
                updated_lines.append('names:')
                for name in class_names:
                    updated_lines.append(f'  - {name}')
            else:
                updated_lines.append(line)
        
        # Write updated data.yaml
        with open(data_yaml_path, 'w') as f:
            f.write('\n'.join(updated_lines))
        
        print(f"Updated data.yaml: {num_classes} classes")
        sys.stdout.flush()  # Ensure message appears immediately
        return num_classes, class_names
        
    except Exception as e:
        print(f"WARNING: Could not update data.yaml: {e}", file=sys.stderr)
        return 0, []


def train_yolo(config):
    """Train YOLO model with given configuration."""
    try:
        # Extract config values
        epochs = config.get('epochs', 100)
        batch = config.get('batch', 16)
        imgsz = config.get('imgsz', 640)
        lr0 = config.get('lr0', 0.01)
        workers = config.get('workers', 4)
        data_yaml = config.get('data')
        project = config.get('project')
        name = config.get('name', 'train')
        model_path = config.get('model')  # Base model path (optional)
        exist_ok = config.get('exist_ok', True)
        
        # Validate required fields
        if not data_yaml:
            print("ERROR: 'data' field (path to data.yaml) is required in config", file=sys.stderr)
            sys.exit(1)
        
        if not os.path.exists(data_yaml):
            print(f"ERROR: data.yaml not found: {data_yaml}", file=sys.stderr)
            sys.exit(1)
        
        # Update data.yaml with actual class information
        dataset_path = os.path.dirname(data_yaml)
        update_data_yaml(data_yaml, dataset_path)
        
        # Load model
        if model_path and os.path.exists(model_path):
            print(f"Loading base model from: {model_path}")
            sys.stdout.flush()
            model = YOLO(model_path)
            print("✅ Model loaded successfully")
            sys.stdout.flush()
        else:
            # Use default YOLOv8n if no model specified
            print("Using default YOLOv8n model")
            sys.stdout.flush()
            model = YOLO('yolov8n.pt')
            print("✅ Model loaded successfully")
            sys.stdout.flush()
        
        # Prepare training arguments
        # ✅ Explicitly set device to use GPU if available, otherwise CPU
        import torch
        device = '0' if torch.cuda.is_available() else 'cpu'
        device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'
        
        train_args = {
            'data': data_yaml,
            'epochs': epochs,
            'batch': batch,
            'imgsz': imgsz,
            'lr0': lr0,
            'workers': workers,
            'project': project,
            'name': name,
            'exist_ok': exist_ok,
            'verbose': True,  # Enable verbose output for log parsing
            'device': device,  # ✅ Explicitly set device (GPU if available)
        }
        
        # Start training
        print(f"Starting YOLO training...")
        print(f"Device: {device_name} (device={device})")
        print(f"Config: epochs={epochs}, batch={batch}, imgsz={imgsz}, lr0={lr0}, workers={workers}")
        print(f"Dataset: {data_yaml}")
        print(f"Output: {project}/{name}")
        print("-" * 80)
        
        # ✅ Progress indicators for data loading phase
        print("📦 Preparing dataset and data loaders...")
        sys.stdout.flush()  # Ensure message appears immediately
        
        # Warn about large image sizes
        if imgsz >= 1024:
            print(f"⏳ Large image size ({imgsz}x{imgsz}) detected. Data loading and augmentation may take several minutes...")
            print(f"💡 Tip: Consider using smaller image size (e.g., 640) for faster training on CPU")
            sys.stdout.flush()
        elif imgsz >= 640:
            print(f"⏳ Medium image size ({imgsz}x{imgsz}) detected. Data loading may take 1-2 minutes...")
            sys.stdout.flush()
        
        print("🔄 Creating data loaders and applying augmentations...")
        sys.stdout.flush()
        
        print("🚀 Starting training (first epoch will begin shortly)...")
        sys.stdout.flush()
        
        # Train the model
        results = model.train(**train_args)
        
        # Training completed successfully
        print("-" * 80)
        print("Training completed successfully!")
        
        # Print final metrics
        if hasattr(results, 'results_dict'):
            metrics = results.results_dict
            print(f"Final metrics:")
            if 'metrics/mAP50(B)' in metrics:
                print(f"  mAP50: {metrics['metrics/mAP50(B)']:.4f}")
            if 'metrics/mAP50-95(B)' in metrics:
                print(f"  mAP50-95: {metrics['metrics/mAP50-95(B)']:.4f}")
            if 'metrics/precision(B)' in metrics:
                print(f"  Precision: {metrics['metrics/precision(B)']:.4f}")
            if 'metrics/recall(B)' in metrics:
                print(f"  Recall: {metrics['metrics/recall(B)']:.4f}")
        
        return 0
        
    except KeyboardInterrupt:
        print("\nTraining interrupted by user", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"ERROR: Training failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Train YOLO model')
    parser.add_argument('--config', required=True, help='Path to training config JSON file')
    
    args = parser.parse_args()
    
    # Load configuration
    config = load_config(args.config)
    
    # Train model
    exit_code = train_yolo(config)
    
    sys.exit(exit_code)


if __name__ == '__main__':
    main()


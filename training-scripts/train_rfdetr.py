#!/usr/bin/env python3
"""
RF-DETR-N training script for VisionBackend.

Reads JSON config from --config and trains RFDETRNano.
Emits canonical log lines for the Node training worker parser.

Usage:
  python train_rfdetr.py --config /path/to/training-config.json
"""

import argparse
import json
import os
import sys
from pathlib import Path


def _configure_windows_utf8_stdio():
    """Prevent Rich/PTL metric tables from crashing on Windows cp1252 consoles."""
    if sys.platform != 'win32':
        return
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    os.environ.setdefault('PYTHONUTF8', '1')
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass


try:
    from rfdetr import RFDETRNano
except ImportError:
    print('ERROR: rfdetr package not found. Install with: pip install rfdetr', file=sys.stderr)
    sys.exit(1)


def load_config(config_path: str) -> dict:
    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def train_rfdetr(config: dict) -> int:
    _configure_windows_utf8_stdio()

    dataset_dir = config.get('dataset_dir')
    output_dir = config.get('output_dir')
    if not dataset_dir or not output_dir:
        print('ERROR: dataset_dir and output_dir are required in config', file=sys.stderr)
        return 1

    dataset_dir = os.path.abspath(dataset_dir)
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    epochs = int(config.get('epochs', 50))
    batch_size = int(config.get('batch_size', 4))
    grad_accum_steps = int(config.get('grad_accum_steps', 4))
    lr = float(config.get('lr', 1e-4))
    resolution = int(config.get('resolution', 384))
    resume = config.get('resume')
    skip_best_epochs = int(config.get('skip_best_epochs', 3))
    pretrain_weights = config.get('pretrain_weights')
    device = config.get('device', 'cuda')

    print(f'RF-DETR-N training starting')
    print(f'  dataset_dir: {dataset_dir}')
    print(f'  output_dir: {output_dir}')
    print(f'  epochs: {epochs}, batch_size: {batch_size}, resolution: {resolution}')
    sys.stdout.flush()

    if resume and os.path.isfile(resume):
        model = RFDETRNano(pretrain_weights=resume)
    elif pretrain_weights and os.path.isfile(pretrain_weights):
        model = RFDETRNano(pretrain_weights=pretrain_weights)
    else:
        model = RFDETRNano()

    train_kwargs = dict(
        dataset_dir=dataset_dir,
        output_dir=output_dir,
        epochs=epochs,
        batch_size=batch_size,
        grad_accum_steps=grad_accum_steps,
        lr=lr,
        resolution=resolution,
        skip_best_epochs=skip_best_epochs,
        tensorboard=False,
        wandb=False,
        device=device,
        progress_bar='tqdm',
        log_per_class_metrics=False,
    )
    if resume and os.path.isfile(resume):
        train_kwargs['resume'] = resume

    # rfdetr>=1.7 expects callbacks as a dict (legacy) or omit; do not pass a list.
    model.train(**train_kwargs)

    best_total = Path(output_dir) / 'checkpoint_best_total.pth'
    best_ema = Path(output_dir) / 'checkpoint_best_ema.pth'
    if best_total.is_file():
        print(f'Best checkpoint: {best_total}')
    elif best_ema.is_file():
        print(f'Best checkpoint (ema): {best_ema}')
    else:
        print('WARNING: checkpoint_best_total.pth not found after training', file=sys.stderr)

    print('RF-DETR training completed successfully')
    sys.stdout.flush()
    return 0


def main():
    parser = argparse.ArgumentParser(description='Train RF-DETR-N model')
    parser.add_argument('--config', required=True, help='Path to training JSON config')
    args = parser.parse_args()

    try:
        config = load_config(args.config)
        code = train_rfdetr(config)
        sys.exit(code)
    except Exception as e:
        print(f'ERROR: Training failed: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

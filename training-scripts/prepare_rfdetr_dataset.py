#!/usr/bin/env python3
"""
Convert Ultralytics-style YOLO dataset layout to RF-DETR Roboflow YOLO layout.

Input (VisionBackend / Ultralytics):
  dataset/
    data.yaml
    images/train, images/val, images/test
    labels/train, labels/val, labels/test

Output (RF-DETR):
  output/
    data.yaml
    train/images, train/labels
    valid/images, valid/labels
    test/images, test/labels  (optional)

Usage:
  python prepare_rfdetr_dataset.py --source /path/to/dataset --output /path/to/rfdetr-dataset
"""

import argparse
import os
import shutil
import sys
from pathlib import Path


def _link_or_copy(src: Path, dst: Path) -> None:
    """Create symlink/junction when possible; otherwise copy file."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() or dst.is_symlink():
        if dst.is_dir() and not dst.is_symlink():
            return
        dst.unlink()
    try:
        os.symlink(src, dst, target_is_directory=src.is_dir())
    except (OSError, NotImplementedError):
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)


def _mirror_split(source_root: Path, output_root: Path, ultralytics_split: str, rfdetr_split: str) -> bool:
    images_src = source_root / 'images' / ultralytics_split
    labels_src = source_root / 'labels' / ultralytics_split
    if not images_src.is_dir():
        return False

    images_dst = output_root / rfdetr_split / 'images'
    labels_dst = output_root / rfdetr_split / 'labels'
    images_dst.mkdir(parents=True, exist_ok=True)
    labels_dst.mkdir(parents=True, exist_ok=True)

    for img in images_src.iterdir():
        if not img.is_file():
            continue
        _link_or_copy(img, images_dst / img.name)
        label = labels_src / f'{img.stem}.txt'
        if label.is_file():
            _link_or_copy(label, labels_dst / label.name)
        else:
            # RF-DETR accepts empty label files for background images
            (labels_dst / f'{img.stem}.txt').touch()

    return True


def _parse_names_from_data_yaml(data_yaml_path: Path):
    names = []
    if not data_yaml_path.is_file():
        return names
    in_names = False
    for line in data_yaml_path.read_text(encoding='utf-8').splitlines():
        trimmed = line.strip()
        if not in_names:
            if trimmed == 'names:' or trimmed.startswith('names:'):
                inline = trimmed.split(':', 1)
                if len(inline) > 1 and inline[1].strip():
                    # names: [a, b] not supported here; list form below
                    pass
                in_names = True
            continue
        list_item = line.strip()
        if list_item.startswith('- '):
            names.append(list_item[2:].strip())
            continue
        if list_item and not list_item.startswith('#'):
            break
    return names


def prepare_dataset(source_dir: str, output_dir: str) -> str:
    source_root = Path(source_dir).resolve()
    output_root = Path(output_dir).resolve()

    if not source_root.is_dir():
        raise FileNotFoundError(f'Source dataset not found: {source_root}')

    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    has_train = _mirror_split(source_root, output_root, 'train', 'train')
    has_valid = _mirror_split(source_root, output_root, 'val', 'valid')
    if not has_valid:
        has_valid = _mirror_split(source_root, output_root, 'valid', 'valid')
    _mirror_split(source_root, output_root, 'test', 'test')

    if not has_train:
        raise ValueError(f'No training images found under {source_root / "images" / "train"}')

    if not has_valid:
        print(
            'WARNING: No val/valid split found; RF-DETR may fail without a validation set.',
            file=sys.stderr,
        )

    names = _parse_names_from_data_yaml(source_root / 'data.yaml')
    nc = len(names)

    yaml_lines = [
        f'path: {output_root.as_posix()}',
        'train: train/images',
        'val: valid/images',
        'test: test/images',
        f'nc: {nc}',
        'names:',
    ]
    for n in names:
        yaml_lines.append(f'  - {n}')

    (output_root / 'data.yaml').write_text('\n'.join(yaml_lines) + '\n', encoding='utf-8')
    print(f'Prepared RF-DETR dataset at: {output_root}')
    print(f'Classes ({nc}): {names}')
    sys.stdout.flush()
    return str(output_root)


def main():
    parser = argparse.ArgumentParser(description='Prepare dataset for RF-DETR training')
    parser.add_argument('--source', required=True, help='Ultralytics-style dataset root')
    parser.add_argument('--output', required=True, help='Output RF-DETR dataset root')
    args = parser.parse_args()
    try:
        prepare_dataset(args.source, args.output)
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Shared helpers: class names and RF-DETR/supervision detection JSON mapping."""

from pathlib import Path


def parse_names_from_data_yaml(file_path):
    names = []
    path = Path(file_path)
    if not path.is_file():
        return names
    in_names = False
    for line in path.read_text(encoding='utf-8').splitlines():
        trimmed = line.strip()
        if not in_names:
            if trimmed == 'names:' or trimmed.startswith('names:'):
                in_names = True
            continue
        if trimmed.startswith('- '):
            names.append(trimmed[2:].strip())
            continue
        if trimmed and not trimmed.startswith('#') and names:
            break
    return names


def load_class_names(config, model_path):
    if config.get('class_names') and isinstance(config['class_names'], list):
        return [str(x) for x in config['class_names']]

    model_dir = Path(model_path).resolve().parent
    yaml_candidates = [
        model_dir / 'data.yaml',
        Path(config.get('class_names_yaml', '') or ''),
    ]
    for yp in yaml_candidates:
        if yp.is_file():
            names = parse_names_from_data_yaml(yp)
            if names:
                return names
    return []


def detections_to_list(detections, class_names):
    """
    Convert supervision-style Detections to VisionBackend JSON list.
    """
    result = []
    if detections is None:
        return result

    n = 0
    if hasattr(detections, '__len__'):
        try:
            n = len(detections)
        except TypeError:
            n = 0

    if n == 0:
        return result

    xyxy = getattr(detections, 'xyxy', None)
    class_id = getattr(detections, 'class_id', None)
    confidence = getattr(detections, 'confidence', None)

    if xyxy is None:
        return result

    for i in range(n):
        box = xyxy[i].tolist() if hasattr(xyxy[i], 'tolist') else list(xyxy[i])
        cid = int(class_id[i]) if class_id is not None else 0
        conf = float(confidence[i]) if confidence is not None else 0.0
        if class_names and 0 <= cid < len(class_names):
            label = class_names[cid]
        else:
            label = f'class_{cid}'
        result.append({
            'class': label,
            'confidence': conf,
            'bbox': [float(box[0]), float(box[1]), float(box[2]), float(box[3])],
        })
    return result

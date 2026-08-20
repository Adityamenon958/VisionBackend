# Base YOLO Models

This directory stores pretrained YOLO models that are used as starting points for training.

## Models Stored

- **yolov8s.pt** — YOLOv8 Small (Ultralytics, balanced speed/accuracy)
- **yolov5s.pt** — YOLOv5 Small (Ultralytics YOLOv5 v7.0)

## Download Models

Run this command from the backend project root:

```bash
npm run download-models
```

Or directly:

```bash
node scripts/download-base-models.js
```

This will:

- Download `yolov8s.pt` and `yolov5s.pt` from the official Ultralytics GitHub releases
- Store them in `models/base/`
- Skip models that are already downloaded

## Benefits

✅ **Faster Training Starts** — No download delay  
✅ **Works Offline** — No internet required after download  
✅ **Predictable** — Same models every time  
✅ **Production Ready** — Better for production environments

## File Sizes (approximate)

| Model       | Size   |
|-------------|--------|
| yolov8s.pt  | ~22 MB |
| yolov5s.pt  | ~14 MB |

## Usage

The training worker looks for local weights under `models/base/` (for example `yolov8s.pt`, `yolov5s.pt`).  
If a model is missing locally, YOLO may download it automatically (slower).

## Note

These models are pretrained on the COCO dataset. They are starting points (transfer learning) for your custom dataset training.

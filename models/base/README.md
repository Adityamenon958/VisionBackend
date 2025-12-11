# Base YOLO Models

This directory stores pretrained YOLO models that are used as starting points for training.

## Models Stored

- **yolov11s.pt** - YOLOv11 Small (latest version, balanced speed/accuracy)

## Download Models

Run this command to download all base models:

```bash
npm run download-models
```

This will:
- Download models from official YOLO repository
- Store them in `models/base/` directory
- Skip models that are already downloaded

## Benefits

✅ **Faster Training Starts** - No download delay  
✅ **Works Offline** - No internet required  
✅ **Predictable** - Same models every time  
✅ **Production Ready** - Better for production environments

## File Sizes

- yolov11s.pt: ~22 MB (approximate)

## Usage

The training worker automatically uses these local models if they exist. If a model is not found locally, YOLO will download it automatically (slower).

## Note

These models are pretrained on COCO dataset. They serve as starting points (transfer learning) for your custom dataset training.


# Training Scripts

This directory contains Python training scripts for model training.

## Current Status

**⚠️ Python training script not yet implemented.**

The training worker (`workers/trainingWorker.js`) will look for a script at:
```
training-scripts/train.py
```

## Expected Script Interface

The Python script should:
1. Accept `--config` argument pointing to a JSON config file
2. Read training configuration from the JSON file
3. Run YOLO training using the configuration
4. Output logs to stdout in a parseable format
5. Save checkpoints to the specified output directory
6. Exit with code 0 on success, non-zero on failure

## Log Format

The script should output logs in a format that can be parsed by the worker:

```
Epoch 1/100: loss=0.85, lr=0.01
Epoch 2/100: loss=0.72, lr=0.01, mAP50=0.55
Epoch 3/100: loss=0.65, lr=0.01, mAP50=0.62, mAP50-95=0.48
...
```

## Example Config JSON

```json
{
  "epochs": 100,
  "batch": 16,
  "imgsz": 640,
  "lr0": 0.01,
  "workers": 4,
  "data": "/path/to/dataset/data.yaml",
  "project": "/path/to/output/runs",
  "name": "train"
}
```

## Next Steps

1. Create `train.py` script using YOLO (ultralytics)
2. Ensure it reads config from JSON
3. Ensure logs are in parseable format
4. Test with the training worker

## For Now

The training worker includes a **simulation mode** that will run if the Python script is not found. This allows testing the full workflow without Python.


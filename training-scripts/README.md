# Training Scripts

This directory contains Python training scripts for model training.

## Current Status

**✅ Python training script implemented!**

The training worker (`workers/trainingWorker.js`) will look for a script at:
```
training-scripts/train.py
```

## Setup

### 1. Install Python Dependencies

```bash
pip install -r requirements.txt
```

Or install manually:
```bash
pip install ultralytics torch torchvision
```

### 2. Verify Installation

```bash
python train.py --help
```

You should see the help message.

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

## How It Works

1. **Backend generates config** - The Node.js worker creates `training-config.json` with all hyperparameters
2. **Python script reads config** - `train.py` reads the JSON and extracts training parameters
3. **YOLO training runs** - Uses ultralytics YOLO to train the model
4. **Logs are streamed** - Python outputs logs to stdout, Node.js worker parses them
5. **Checkpoints saved** - YOLO saves `best.pt` to `{project}/train/weights/best.pt`
6. **Worker copies model** - Node.js worker copies `best.pt` to final model storage location

## Log Format

The script outputs logs that the worker can parse:
- `Epoch 25/100: loss=0.45, lr=0.01, mAP50=0.72`
- YOLO's default output format is automatically parsed

## Troubleshooting

**If training fails:**
1. Check Python is installed: `python --version`
2. Check ultralytics is installed: `pip list | grep ultralytics`
3. Check training worker logs for errors
4. Verify dataset has train/val images and labels

**If simulation mode runs instead:**
- Make sure `training-scripts/train.py` exists
- Make sure Python dependencies are installed
- Check worker logs for "Python training script not found" message


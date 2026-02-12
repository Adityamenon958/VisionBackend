# Dataset Utility Scripts

This repository contains several Python scripts to assist with augmenting, validating, and fixing the YOLOv8 dataset.

## Prerequisites & Setup

Before running these scripts, you need to ensure your data is organized correctly and the scripts are configured to point to it.

### 1. Expected Data Structure
The scripts expect your **raw input data** to follow the standard YOLOv8 folder structure:
```
Your_Dataset_Root/
├── images/
│   ├── train/
│   ├── val/
│   └── test/
└── labels/
    ├── train/
    ├── val/
    └── test/
```

### 2. Configuration
**Before running any script, you must edit the `CONFIG` section at the top of the file** to match your local paths.

**Example for `augment_detection.py`:**
Open the file and find:
```python
# ================= CONFIGURATION =================
INPUT_ROOT_DIR = "/path/to/your/raw/dataset"  # <--- CHANGE THIS
OUTPUT_ROOT_DIR = "CTS6U_dataset_augmented"   # <--- Output folder name
# ...
```

**Example for `verify_dataset.py`, `count_classes.py`, etc.:**
These scripts are usually meant to run on the *output* of the augmentation.
```python
# ================= CONFIGURATION =================
DATASET_ROOT = "/path/to/CTS6U_augmented_dataset/CTS6U_dataset_augmented" # <--- POINT TO OUTPUT
```

## Scripts Overview

### 1. `augment_detection.py`
**Purpose:** Augments the original dataset to increase its size and robustness for training.
- Uses the `albumentations` library to apply transformations like rotation, cropping, brightness/contrast adjustments, and blurring.
- Significantly, it correctly transforms the **bounding boxes** along with the images.
- Can set a target number of images for the training set (e.g., 1000) and a multiplier for validation/test sets.

### 2. `fix_labels.py`
**Purpose:** Fixes formatting issues in YOLO label files.
- Recursively scans the dataset's `labels` directory.
- Converts class IDs that are formatted as floats (e.g., `0.0`, `1.0`) into proper integers (`0`, `1`), which is required by some YOLO parsers.
- This is useful if your augmentation or labeling tool outputted floats by mistake.

### 3. `count_classes.py`
**Purpose:** Provides a summary of class distribution.
- Scans all label files in the `train` directory.
- Counts how many instances of each class ID exist.
- Useful for checking if your dataset is balanced or if certain classes are underrepresented.

### 4. `verify_dataset.py`
**Purpose:** Performs a random visual spot-check of the dataset.
- Picks a batch of random images (default: 5) and their corresponding labels.
- Draws the bounding boxes and class IDs on the images using OpenCV.
- Displays the results in a plot.
- This is the quickest way to verify that your images and labels match up correctly.

### 5. `detect_classes.py`
**Purpose:** Visualizes one example per class.
- Scans the dataset to find the first available example image for every unique class ID.
- Plots these examples side-by-side with their bounding boxes.
- Useful for confirming what object each Class ID corresponds to visually.

## Usage

You can run any of these scripts using Python:

```bash
python augment_detection.py
python fix_labels.py
python count_classes.py
python verify_dataset.py
python detect_classes.py
```

> **Note:** Ensure you have the required libraries installed (opencv-python, albumentations, matplotlib, tqdm).

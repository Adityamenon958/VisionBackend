import cv2
import albumentations as A
import os
import glob
from tqdm import tqdm
import math
from typing import List, Tuple

_IMAGE_GLOBS = ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG")


def list_image_files(img_dir: str) -> List[str]:
    """List image paths under img_dir; matches Node augmentation pool (.jpg / .jpeg / .png)."""
    if not os.path.isdir(img_dir):
        return []
    paths: List[str] = []
    for pat in _IMAGE_GLOBS:
        paths.extend(glob.glob(os.path.join(img_dir, pat)))
    return sorted(set(paths))


# NOTE:
# This module was originally written as a standalone script with hard‑coded
# INPUT_ROOT_DIR / OUTPUT_ROOT_DIR / TARGET_TRAIN_TOTAL / VAL_TEST_MULTIPLIER.
# It has been refactored to expose reusable functions that take those values
# as parameters so it can be safely called from the backend without changing
# the augmentation behavior.


def get_bbox_pipeline(target_size: int = 640) -> A.Compose:
    """
    Defines the augmentation pipeline.
    CRITICAL: Includes 'bbox_params' to ensure boxes move with the image.
    """
    return A.Compose(
        [
            # --- 1. Orientation ---
            A.Rotate(limit=30, p=0.6, border_mode=cv2.BORDER_REFLECT_101),
            A.HorizontalFlip(p=0.5),
            # --- 2. Zoom/Crop ---
            # We use a safe crop that doesn't cut off too much to keep boxes visible
            A.RandomResizedCrop(
                size=(target_size, target_size),
                scale=(0.85, 1.0),
                ratio=(0.9, 1.1),
                p=1.0,
            ),
            # --- 3. Lighting/Color ---
            A.RandomBrightnessContrast(
                brightness_limit=0.1, contrast_limit=0.1, p=0.5
            ),
            A.GaussianBlur(blur_limit=(3, 3), p=0.1),
        ],
        bbox_params=A.BboxParams(
            format="yolo", min_visibility=0.3, label_fields=["class_labels"]
        ),
    )

def read_yolo_label(label_path: str) -> Tuple[List[List[float]], List[int]]:
    """Reads a YOLO format .txt file and returns a list of bounding boxes."""
    bboxes: List[List[float]] = []
    class_labels: List[int] = []
    
    if os.path.exists(label_path):
        with open(label_path, 'r') as f:
            lines = f.readlines()
            for line in lines:
                parts = line.strip().split()
                if len(parts) >= 5:
                    class_id = int(parts[0])
                    # YOLO format: x_center, y_center, width, height
                    bbox = [float(x) for x in parts[1:5]] 
                    # Albumentations expects the bbox + class_id separate usually, 
                    # but we will handle class_id in a separate list for 'label_fields'
                    bboxes.append(bbox)
                    class_labels.append(class_id)
    return bboxes, class_labels

def save_yolo_label(
    output_path: str, bboxes: List[List[float]], class_labels: List[int]
) -> None:
    """Saves the transformed bounding boxes back to a .txt file."""
    with open(output_path, 'w') as f:
        for bbox, cls_id in zip(bboxes, class_labels):
            # Clip values to 0.0 - 1.0 to prevent errors
            x_c, y_c, w, h = [max(0.0, min(1.0, val)) for val in bbox]
            f.write(f"{cls_id} {x_c:.6f} {y_c:.6f} {w:.6f} {h:.6f}\n")

def process_subset(
    input_root_dir: str,
    output_root_dir: str,
    subset_name: str,
    multiplier: int = None,
    target_total: int = None,
    target_size: int = 640,
) -> None:
    """
    Processes a specific folder (train, val, or test).
    """
    input_img_dir = os.path.join(input_root_dir, "images", subset_name)
    input_lbl_dir = os.path.join(input_root_dir, "labels", subset_name)

    output_img_dir = os.path.join(output_root_dir, "images", subset_name)
    output_lbl_dir = os.path.join(output_root_dir, "labels", subset_name)
    
    os.makedirs(output_img_dir, exist_ok=True)
    os.makedirs(output_lbl_dir, exist_ok=True)
    
    # Get list of images (.jpg / .jpeg / .png — must match workers/augmentationWorker.js pool)
    image_files = list_image_files(input_img_dir)

    if not image_files:
        print(f"No images found in {subset_name}. Skipping.")
        return

    num_original = len(image_files)
    
    # Calculate Augmentations Needed
    if target_total:
        # If we want 1000 total, and have 100, we need 10 copies per image
        if num_original >= target_total:
            count_per_image = 1 # Just copy original if we already have enough
            print(f"[{subset_name}] Already has {num_original} images. No augmentation needed.")
        else:
            count_per_image = math.ceil(target_total / num_original)
            print(f"[{subset_name}] Augmenting {num_original} images -> Target {target_total} (x{count_per_image} per image)")
    else:
        count_per_image = multiplier
        print(f"[{subset_name}] Augmenting {num_original} images by factor x{count_per_image}")

    pipeline = get_bbox_pipeline(target_size=target_size)
    
    for img_path in tqdm(image_files, desc=f"Processing {subset_name}"):
        # 1. Read Image
        image = cv2.imread(img_path)
        if image is None: continue
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # 2. Read Label
        base_name = os.path.splitext(os.path.basename(img_path))[0]
        label_path = os.path.join(input_lbl_dir, base_name + ".txt")
        bboxes, class_labels = read_yolo_label(label_path)
        
        # 3. Generate Variants
        for i in range(count_per_image):
            try:
                # Apply Augmentation (Transform Image AND Boxes)
                transformed = pipeline(
                    image=image, bboxes=bboxes, class_labels=class_labels
                )
                
                aug_image = transformed['image']
                aug_bboxes = transformed['bboxes']
                aug_labels = transformed['class_labels']
                
                # If augmentation pushed all boxes out of frame, skip saving (bad data)
                if len(bboxes) > 0 and len(aug_bboxes) == 0:
                    continue 

                # 4. Save Image (keep source extension so .jpeg datasets stay consistent)
                src_ext = os.path.splitext(img_path)[1].lower()
                if src_ext not in (".jpg", ".jpeg", ".png"):
                    src_ext = ".jpg"
                save_name = f"{base_name}_aug_{i}{src_ext}"
                cv2.imwrite(
                    os.path.join(output_img_dir, save_name),
                    cv2.cvtColor(aug_image, cv2.COLOR_RGB2BGR),
                )

                # 5. Save Label
                save_yolo_label(
                    os.path.join(output_lbl_dir, f"{base_name}_aug_{i}.txt"),
                    aug_bboxes,
                    aug_labels,
                )
                
            except Exception as e:
                print(f"Error processing {base_name}: {e}")


def run_augmentation(
    input_root_dir: str,
    output_root_dir: str,
    target_train_total: int = 1000,
    val_test_multiplier: int = 2,
    target_size: int = 640,
) -> None:
    """
    High‑level helper that runs augmentation for train/val/test subsets.

    This keeps the original behavior (train uses target_total, val/test use
    multiplier) but makes paths and parameters configurable for backend use.
    """
    if not os.path.exists(input_root_dir):
        raise FileNotFoundError(
            f"Input root directory does not exist: {input_root_dir}"
        )

    # Process Train (targeting specific total)
    process_subset(
        input_root_dir=input_root_dir,
        output_root_dir=output_root_dir,
        subset_name="train",
        target_total=target_train_total,
        target_size=target_size,
    )

    # Process Val and Test (using multiplier)
    process_subset(
        input_root_dir=input_root_dir,
        output_root_dir=output_root_dir,
        subset_name="val",
        multiplier=val_test_multiplier,
        target_size=target_size,
    )
    process_subset(
        input_root_dir=input_root_dir,
        output_root_dir=output_root_dir,
        subset_name="test",
        multiplier=val_test_multiplier,
        target_size=target_size,
    )

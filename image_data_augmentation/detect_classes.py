import cv2
import os
import glob
import matplotlib.pyplot as plt

# ================= CONFIGURATION =================
# This is the path that worked in your debug script
DATASET_ROOT = "/Users/vedantprashantbhosale/Desktop/DIN_terminal_dataset/CTS6U_augmented_dataset/CTS6U_dataset_augmented"

TRAIN_IMG_DIR = os.path.join(DATASET_ROOT, "images", "train")
TRAIN_LBL_DIR = os.path.join(DATASET_ROOT, "labels", "train")
# =================================================

def unnormalize_bbox(bbox, width, height):
    x_c, y_c, w_norm, h_norm = bbox
    x_min = int((x_c - w_norm/2) * width)
    y_min = int((y_c - h_norm/2) * height)
    x_max = int((x_c + w_norm/2) * width)
    y_max = int((y_c + h_norm/2) * height)
    return x_min, y_min, x_max, y_max

def find_examples_for_classes():
    # Dictionary to store one example image path per class ID
    class_examples = {}
    
    label_files = glob.glob(os.path.join(TRAIN_LBL_DIR, "*.txt"))
    print(f"Scanning {len(label_files)} label files in: {TRAIN_LBL_DIR}")

    for lbl_path in label_files:
        # Stop early if we have found examples for 10 classes
        if len(class_examples) > 10: 
            break
            
        with open(lbl_path, 'r') as f:
            lines = f.readlines()
            
        for line in lines:
            parts = line.strip().split()
            if len(parts) < 5: continue
            
            try:
                # FIX: Handle '1.0' by converting to float then int
                class_id = int(float(parts[0]))
                
                # If we haven't seen this class ID yet, save the image info
                if class_id not in class_examples:
                    base_name = os.path.splitext(os.path.basename(lbl_path))[0]
                    img_path = os.path.join(TRAIN_IMG_DIR, base_name + ".jpg")
                    
                    if os.path.exists(img_path):
                        class_examples[class_id] = {
                            'img_path': img_path,
                            'bbox': [float(x) for x in parts[1:5]]
                        }
            except ValueError:
                continue

    # Sort by ID (0, 1, 2...)
    sorted_ids = sorted(class_examples.keys())
    print(f"Found {len(sorted_ids)} unique classes: {sorted_ids}")

    if not sorted_ids:
        print("No classes found. Check if your label files are empty.")
        return

    # Plot them
    plt.figure(figsize=(15, 5))
    for idx, class_id in enumerate(sorted_ids):
        data = class_examples[class_id]
        image = cv2.imread(data['img_path'])
        if image is None:
            continue
            
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        h, w, _ = image.shape
        
        # Draw the box
        x1, y1, x2, y2 = unnormalize_bbox(data['bbox'], w, h)
        cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), 3)
        
        plt.subplot(1, len(sorted_ids), idx+1)
        plt.imshow(image)
        plt.axis('off')
        plt.title(f"Class ID: {class_id}")
    
    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    find_examples_for_classes()
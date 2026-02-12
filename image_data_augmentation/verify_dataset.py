import cv2
import os
import glob
import random
import matplotlib.pyplot as plt

# ================= CONFIGURATION =================
# The path to your NEW augmented dataset
DATASET_ROOT_DIR = r"C:\Users\HP\Desktop\image_data_augmentation\Webcam_dataset_augmented" 

# Define where the train images and labels are
IMG_DIR = os.path.join(DATASET_ROOT_DIR, "images", "train")
LBL_DIR = os.path.join(DATASET_ROOT_DIR, "labels", "train")

# How many random images to check
BATCH_SIZE = 5
# =================================================

def unnormalize_bbox(bbox, width, height):
    """
    Converts YOLO format (x_center, y_center, w, h) (0-1) 
    to OpenCV format (x_min, y_min, x_max, y_max) (pixels)
    """
    x_c, y_c, w_norm, h_norm = bbox
    
    # Calculate pixel values
    x_center = x_c * width
    y_center = y_c * height
    box_width = w_norm * width
    box_height = h_norm * height
    
    # Calculate top-left and bottom-right coordinates
    x_min = int(x_center - (box_width / 2))
    y_min = int(y_center - (box_height / 2))
    x_max = int(x_center + (box_width / 2))
    y_max = int(y_center + (box_height / 2))
    
    return x_min, y_min, x_max, y_max

def visualize_random_batch():
    # 1. Get all image files
    all_images = glob.glob(os.path.join(IMG_DIR, "*.jpg"))
    
    if not all_images:
        print(f"Error: No images found in {IMG_DIR}")
        return

    # 2. Pick random images
    selected_images = random.sample(all_images, min(len(all_images), BATCH_SIZE))
    
    plt.figure(figsize=(15, 10))
    
    for i, img_path in enumerate(selected_images):
        # Read Image
        image = cv2.imread(img_path)
        if image is None:
            print(f"Could not read image: {img_path}")
            continue
            
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        h, w, _ = image.shape
        
        # Construct Label Path
        base_name = os.path.splitext(os.path.basename(img_path))[0]
        label_path = os.path.join(LBL_DIR, base_name + ".txt")
        
        # Read Labels
        if os.path.exists(label_path):
            with open(label_path, 'r') as f:
                lines = f.readlines()
                
            for line in lines:
                parts = line.strip().split()
                if len(parts) >= 5:
                    # FIX IS HERE: Convert to float first, then int
                    # This handles '0.0' -> 0.0 -> 0
                    class_id = int(float(parts[0]))
                    
                    bbox = [float(x) for x in parts[1:5]]
                    
                    # Convert to pixels
                    x1, y1, x2, y2 = unnormalize_bbox(bbox, w, h)
                    
                    # Draw Box (Green color, thickness 3)
                    cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), 3)
                    
                    # Draw Label Background
                    cv2.rectangle(image, (x1, y1-20), (x1+80, y1), (0, 255, 0), -1)
                    # Draw Label Text
                    cv2.putText(image, f"ID: {class_id}", (x1+5, y1-5), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
        else:
            print(f"Warning: Label file missing for {base_name}")

        # Add to subplot
        plt.subplot(1, BATCH_SIZE, i+1)
        plt.imshow(image)
        plt.axis('off')
        plt.title(f"{base_name}")

    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    visualize_random_batch()
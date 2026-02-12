import os
import glob
from collections import defaultdict

# ================= CONFIGURATION =================
# Use the correct path confirmed in your previous step
DATASET_ROOT = "/Users/vedantprashantbhosale/Desktop/DIN_terminal_dataset/CTS6U_augmented_dataset/CTS6U_dataset_augmented"

TRAIN_LBL_DIR = os.path.join(DATASET_ROOT, "labels", "train")
# =================================================

def count_class_instances():
    # Dictionary to store counts: {0: 150, 1: 200, ...}
    class_counts = defaultdict(int)
    
    # Get all text files
    label_files = glob.glob(os.path.join(TRAIN_LBL_DIR, "*.txt"))
    
    print(f"Scanning {len(label_files)} files in: {TRAIN_LBL_DIR}...\n")
    
    for lbl_path in label_files:
        try:
            with open(lbl_path, 'r') as f:
                lines = f.readlines()
                
            for line in lines:
                parts = line.strip().split()
                if len(parts) >= 1:
                    # Robust conversion: handles '0', '0.0', '1', '1.0'
                    try:
                        class_id = int(float(parts[0]))
                        class_counts[class_id] += 1
                    except ValueError:
                        continue
                        
        except Exception as e:
            print(f"Error reading {lbl_path}: {e}")

    # Print Results
    print("--- CLASS DISTRIBUTION ---")
    if not class_counts:
        print("No labels found! (Check your path or file contents)")
    else:
        # Sort by Class ID for clean output
        for class_id in sorted(class_counts.keys()):
            count = class_counts[class_id]
            print(f"Class ID {class_id}: {count} instances")
            
    print("\n--------------------------")
    print(f"Total Objects Annotated: {sum(class_counts.values())}")

if __name__ == "__main__":
    count_class_instances()
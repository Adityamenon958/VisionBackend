import os
import sys


def fix_labels(root_dir):
    print(f"Scanning directory: {root_dir}")
    files_processed = 0
    lines_corrected = 0

    for dirpath, _, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename.endswith(".txt"):
                file_path = os.path.join(dirpath, filename)
                files_processed += 1
                
                new_lines = []
                modified = False
                
                try:
                    with open(file_path, 'r') as f:
                        lines = f.readlines()
                        
                    for line in lines:
                        parts = line.strip().split()
                        if not parts:
                            new_lines.append(line)
                            continue
                            
                        # Check first element (class_id)
                        class_id_str = parts[0]
                        
                        # If it looks like a float (e.g. "0.0", "1.0")
                        if '.' in class_id_str:
                            try:
                                class_id_val = float(class_id_str)
                                class_id_int = int(class_id_val)
                                
                                # Only change if it was actually a float string representation
                                if str(class_id_val) == class_id_str or f"{class_id_val:.1f}" == class_id_str or str(class_id_int) != class_id_str:
                                     parts[0] = str(class_id_int)
                                     modified = True
                                     lines_corrected += 1
                            except ValueError:
                                pass # Not a number, skip
                        
                        new_lines.append(" ".join(parts) + "\n")
                    
                    if modified:
                        with open(file_path, 'w') as f:
                            f.writelines(new_lines)
                            
                except Exception as e:
                    print(f"Error processing {file_path}: {e}")

    print(f"Done. Processed {files_processed} files.")
    print(f"Corrected {lines_corrected} lines.")

if __name__ == "__main__":
    """
    Optional CLI wrapper so this script can be reused by the backend.

    Usage:
        python fix_labels.py <labels_root_dir>

    If no argument is provided, it falls back to the original hard‑coded path
    to preserve the previous standalone behavior.
    """
    if len(sys.argv) > 1:
        dataset_path = sys.argv[1]
    else:
        # Original behavior (kept for backwards compatibility)
        dataset_path = r"C:\Users\HP\Desktop\image_data_augmentation\Webcam_dataset_augmented\labels"

    if os.path.exists(dataset_path):
        fix_labels(dataset_path)
    else:
        print(f"Error: Directory not found: {dataset_path}")

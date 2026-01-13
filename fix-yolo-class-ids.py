#!/usr/bin/env python3
"""
YOLO Label Class ID Fixer

This script scans YOLO dataset label files and fixes invalid class IDs.
Specifically, it converts float class IDs (like 1.0, 2.0) to integers (1, 2).

Usage:
    python fix-yolo-class-ids.py

Configuration:
    Set DATASET_PATH at the top of this script to your dataset directory.
"""

import os

# ============================================================================
# CONFIGURATION - Set your dataset path here
# ============================================================================
DATASET_PATH = r"C:\Gsn Soln\VisionBackend\datasets\gsn\ConnectWell\v3"

# ============================================================================
# MAIN SCRIPT
# ============================================================================

def validate_yolo_line(line, line_num):
    """
    Validate YOLO format line: class_id cx cy w h
    
    Returns:
        tuple: (is_valid, class_id_str, rest_of_line) or (False, None, None)
    """
    line = line.strip()
    
    # Skip empty lines
    if not line:
        return (True, None, None)
    
    parts = line.split()
    
    # Must have exactly 5 values
    if len(parts) != 5:
        return (False, None, None)
    
    class_id_str = parts[0]
    rest_of_line = ' '.join(parts[1:])
    
    return (True, class_id_str, rest_of_line)


def fix_class_id(class_id_str):
    """
    Fix class ID: convert float to integer if needed.
    
    Args:
        class_id_str: String representation of class ID
        
    Returns:
        tuple: (fixed_class_id_str, was_fixed)
    """
    try:
        # Try to parse as float first (handles "1.0", "2.0", etc.)
        class_id_float = float(class_id_str)
        
        # Check if it's actually an integer value
        if class_id_float.is_integer():
            # Convert to integer string
            fixed_class_id = str(int(class_id_float))
            was_fixed = (fixed_class_id != class_id_str)
            return (fixed_class_id, was_fixed)
        else:
            # Not an integer value (like 1.5) - invalid for YOLO
            return (class_id_str, False)
    except ValueError:
        # Not a number at all - invalid
        return (class_id_str, False)


def process_label_file(file_path):
    """
    Process a single label file and fix class IDs if needed.
    
    Args:
        file_path: Full path to the label file
        
    Returns:
        tuple: (was_fixed, fixes_count, errors)
    """
    fixes_count = 0
    errors = []
    lines_to_write = []
    file_was_modified = False
    
    try:
        # Read file with UTF-8 encoding
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # Process each line
        for line_num, line in enumerate(lines, start=1):
            # Validate YOLO format
            is_valid, class_id_str, rest_of_line = validate_yolo_line(line, line_num)
            
            if not is_valid:
                # Invalid format - keep original line
                if line.strip():  # Only log non-empty invalid lines
                    errors.append(f"Line {line_num}: Invalid YOLO format (expected 5 values)")
                lines_to_write.append(line)
                continue
            
            # Empty line - keep as is
            if class_id_str is None:
                lines_to_write.append(line)
                continue
            
            # Fix class ID if needed
            fixed_class_id, was_fixed = fix_class_id(class_id_str)
            
            if was_fixed:
                # Reconstruct line with fixed class ID
                fixed_line = f"{fixed_class_id} {rest_of_line}\n"
                lines_to_write.append(fixed_line)
                file_was_modified = True
                fixes_count += 1
            else:
                # No fix needed - keep original line
                lines_to_write.append(line)
        
        # Write file only if modifications were made
        if file_was_modified:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.writelines(lines_to_write)
        
        return (file_was_modified, fixes_count, errors)
        
    except UnicodeDecodeError as e:
        return (False, 0, [f"Encoding error: {e}"])
    except PermissionError as e:
        return (False, 0, [f"Permission denied: {e}"])
    except OSError as e:
        return (False, 0, [f"OS error: {e}"])
    except Exception as e:
        return (False, 0, [f"Unexpected error: {e}"])


def scan_dataset(dataset_path):
    """
    Scan dataset and fix class IDs in all label files.
    
    Args:
        dataset_path: Path to dataset directory
        
    Returns:
        dict: Statistics about the scan
    """
    dataset_path = os.path.abspath(dataset_path)
    
    # Statistics
    stats = {
        'total_files': 0,
        'files_fixed': 0,
        'total_fixes': 0,
        'errors': []
    }
    
    # Directories to scan
    label_dirs = [
        os.path.join(dataset_path, 'labels', 'train'),
        os.path.join(dataset_path, 'labels', 'val'),
        os.path.join(dataset_path, 'labels', 'test')
    ]
    
    print("=" * 80)
    print("YOLO Label Class ID Fixer")
    print("=" * 80)
    print(f"Dataset path: {dataset_path}")
    print()
    
    # Scan each directory
    for label_dir in label_dirs:
        if not os.path.exists(label_dir):
            print(f"Skipping (does not exist): {label_dir}")
            continue
        
        if not os.path.isdir(label_dir):
            print(f"Skipping (not a directory): {label_dir}")
            continue
        
        print(f"Scanning: {label_dir}")
        
        # Find all .txt files
        try:
            all_files = os.listdir(label_dir)
            label_files = [f for f in all_files if f.lower().endswith('.txt')]
        except OSError as e:
            print(f"ERROR: Cannot read directory: {e}")
            stats['errors'].append(f"Cannot read {label_dir}: {e}")
            continue
        
        # Process each file
        for label_filename in label_files:
            file_path = os.path.join(label_dir, label_filename)
            stats['total_files'] += 1
            
            was_fixed, fixes_count, file_errors = process_label_file(file_path)
            
            if was_fixed:
                stats['files_fixed'] += 1
                stats['total_fixes'] += fixes_count
                print(f"  FIXED: {label_filename} ({fixes_count} class ID(s) corrected)")
            
            if file_errors:
                stats['errors'].extend([f"{label_filename}: {err}" for err in file_errors])
        
        print(f"  Processed {len(label_files)} files from {os.path.basename(label_dir)}")
        print()
    
    return stats


def main():
    """Main entry point."""
    # Validate dataset path
    if not os.path.exists(DATASET_PATH):
        print(f"ERROR: Dataset path does not exist: {DATASET_PATH}")
        print("Please update DATASET_PATH at the top of this script.")
        return 1
    
    if not os.path.isdir(DATASET_PATH):
        print(f"ERROR: Dataset path is not a directory: {DATASET_PATH}")
        return 1
    
    # Scan and fix
    stats = scan_dataset(DATASET_PATH)
    
    # Print summary
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total files scanned: {stats['total_files']}")
    print(f"Files fixed: {stats['files_fixed']}")
    print(f"Total class IDs corrected: {stats['total_fixes']}")
    
    if stats['errors']:
        print()
        print(f"Errors encountered: {len(stats['errors'])}")
        for error in stats['errors'][:10]:  # Show first 10 errors
            print(f"  - {error}")
        if len(stats['errors']) > 10:
            print(f"  ... and {len(stats['errors']) - 10} more errors")
    else:
        print("No errors encountered.")
    
    print()
    if stats['files_fixed'] > 0:
        print(f"SUCCESS: Fixed {stats['total_fixes']} class ID(s) in {stats['files_fixed']} file(s).")
    else:
        print("No fixes needed. All class IDs are already valid integers.")
    
    print("=" * 80)
    
    return 0


if __name__ == '__main__':
    exit_code = main()
    exit(exit_code)


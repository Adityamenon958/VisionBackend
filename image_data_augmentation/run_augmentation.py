import argparse
import os
import sys

from augment_detection import run_augmentation


def parse_args() -> argparse.Namespace:
  """
  Parse CLI arguments for the augmentation entrypoint.

  This script is designed to be called from the Node backend / worker and
  must use explicit input/output roots rather than hard‑coded paths.
  """
  parser = argparse.ArgumentParser(description="Run YOLO image data augmentation.")

  parser.add_argument(
      "--input-root",
      required=True,
      help="Path to input YOLO dataset root (contains images/train,val,test and labels/train,val,test).",
  )
  parser.add_argument(
      "--output-root",
      required=True,
      help="Path where augmented YOLO dataset will be written.",
  )
  parser.add_argument(
      "--target-train-total",
      type=int,
      default=int(os.getenv("AUG_TARGET_TRAIN_TOTAL", "1000")),
      help="Target total number of train images (default from AUG_TARGET_TRAIN_TOTAL env or 1000).",
  )
  parser.add_argument(
      "--val-test-multiplier",
      type=int,
      default=int(os.getenv("AUG_VAL_TEST_MULTIPLIER", "2")),
      help="Multiplier for val/test images (default from AUG_VAL_TEST_MULTIPLIER env or 2).",
  )
  parser.add_argument(
      "--target-size",
      type=int,
      default=int(os.getenv("AUG_TARGET_SIZE", "640")),
      help="Target image size for augmentation pipeline (default from AUG_TARGET_SIZE env or 640).",
  )

  return parser.parse_args()


def main() -> None:
  args = parse_args()

  input_root = os.path.abspath(args.input_root)
  output_root = os.path.abspath(args.output_root)

  try:
    # Ensure output root exists
    os.makedirs(output_root, exist_ok=True)

    # Delegate to shared augmentation logic
    run_augmentation(
        input_root_dir=input_root,
        output_root_dir=output_root,
        target_train_total=args.target_train_total,
        val_test_multiplier=args.val_test_multiplier,
        target_size=args.target_size,
    )

    # Basic sanity check: ensure expected subfolders exist
    required_subdirs = [
        os.path.join(output_root, "images", "train"),
        os.path.join(output_root, "images", "val"),
        os.path.join(output_root, "images", "test"),
        os.path.join(output_root, "labels", "train"),
        os.path.join(output_root, "labels", "val"),
        os.path.join(output_root, "labels", "test"),
    ]

    missing = [d for d in required_subdirs if not os.path.isdir(d)]
    if missing:
      sys.stderr.write(
          "Augmentation completed but required YOLO subdirectories are missing:\n"
      )
      for m in missing:
        sys.stderr.write(f"  - {m}\n")
      sys.exit(2)

    print(f"Augmentation completed successfully at: {output_root}")
    sys.exit(0)

  except Exception as exc:  # noqa: BLE001
    sys.stderr.write(f"Augmentation failed: {exc}\n")
    sys.exit(1)


if __name__ == "__main__":
  main()


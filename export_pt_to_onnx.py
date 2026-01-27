# export_pt_to_onnx.py
# ✅ YOLOv8 PT → ONNX (TensorRT GPU-NMS compatible)

import os
import shutil
from ultralytics import YOLO

PT_PATH = r"C:\Gsn Soln\VisionBackend\models\gsn\ConnectWell\v16\best.pt"
ONNX_PATH = r"C:\Gsn Soln\VisionBackend\ConnectWell_v16.onnx"

model = YOLO(PT_PATH)

# ✅ Export ONNX (Ultralytics saves beside the .pt by default)
exported_path = model.export(
    format="onnx",
    imgsz=640,
    opset=13,          # ✅ REQUIRED for TensorRT EfficientNMS
    dynamic=False,     # ✅ Fixed shape (best for Nano)
    simplify=True      # ✅ REQUIRED for graph fusion
)

# ✅ Move the exported ONNX to the desired location
exported_path = os.path.abspath(str(exported_path))
target_path = os.path.abspath(ONNX_PATH)

if exported_path.lower() != target_path.lower():
    # Ensure target directory exists
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    shutil.move(exported_path, target_path)

print("✅ ONNX export complete")
print("Saved to:", target_path)

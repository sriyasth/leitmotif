#!/usr/bin/env python3
"""
Convert EdgeFace XS PyTorch model to CoreML (.mlpackage).

Usage:
    pip install torch coremltools
    # Clone edgeface repo or install: pip install git+https://github.com/otroshi/edgeface
    python convert_edgeface.py

Output:
    ../models/EdgeFaceXS.mlpackage

Fallback:
    If EdgeFace conversion fails, this script attempts MobileFaceNet conversion.
"""

import sys
import os
import torch
import coremltools as ct
import numpy as np


def convert_edgeface():
    """Convert EdgeFace XS to CoreML."""
    print("Attempting EdgeFace XS conversion...")

    try:
        # Try importing from edgeface package
        from edgeface import get_model

        model = get_model("edgeface_xs_gamma_06")
        model.eval()
    except ImportError:
        print("EdgeFace package not found. Trying to load from checkpoint...")

        # Try loading from a local checkpoint file
        checkpoint_path = os.path.join(os.path.dirname(__file__), "edgeface_xs.pth")
        if not os.path.exists(checkpoint_path):
            print(f"Checkpoint not found at {checkpoint_path}")
            return False

        # Load as a generic model (adjust based on actual EdgeFace architecture)
        model = torch.jit.load(checkpoint_path)
        model.eval()

    # Trace the model with dummy input (112x112 RGB face)
    dummy_input = torch.randn(1, 3, 112, 112)

    with torch.no_grad():
        output = model(dummy_input)
        print(f"Model output shape: {output.shape}")
        embedding_dim = output.shape[-1]
        print(f"Embedding dimension: {embedding_dim}")

    traced_model = torch.jit.trace(model, dummy_input)

    # Convert to CoreML
    mlmodel = ct.convert(
        traced_model,
        inputs=[
            ct.TensorType(
                name="face_image",
                shape=(1, 3, 112, 112),
                dtype=np.float32,
            )
        ],
        outputs=[
            ct.TensorType(name="embedding"),
        ],
        minimum_deployment_target=ct.target.iOS16,
    )

    # Add metadata
    mlmodel.author = "Sensible Hackathon"
    mlmodel.short_description = "EdgeFace XS face embedding model (512-dim)"
    mlmodel.input_description["face_image"] = "Aligned face image 112x112 RGB"

    output_path = os.path.join(os.path.dirname(__file__), "..", "models", "EdgeFaceXS.mlpackage")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    mlmodel.save(output_path)
    print(f"Saved CoreML model to {output_path}")
    return True


def convert_mobilefacenet():
    """Fallback: Convert MobileFaceNet to CoreML."""
    print("\nAttempting MobileFaceNet conversion (fallback)...")

    try:
        # Try loading a pre-trained MobileFaceNet
        # Common source: insightface or onnx model zoo
        import onnx
        from onnx import numpy_helper

        onnx_path = os.path.join(os.path.dirname(__file__), "mobilefacenet.onnx")
        if not os.path.exists(onnx_path):
            print(f"MobileFaceNet ONNX not found at {onnx_path}")
            print("Download from: https://github.com/onnx/models or InsightFace model zoo")
            return False

        mlmodel = ct.converters.onnx.convert(
            model=onnx_path,
            minimum_deployment_target=ct.target.iOS16,
        )

        output_path = os.path.join(os.path.dirname(__file__), "..", "models", "MobileFaceNet.mlpackage")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        mlmodel.save(output_path)
        print(f"Saved MobileFaceNet CoreML model to {output_path}")
        return True

    except Exception as e:
        print(f"MobileFaceNet conversion failed: {e}")
        return False


def validate_model(model_path: str):
    """Quick validation: load model and run dummy inference."""
    print(f"\nValidating {model_path}...")
    model = ct.models.MLModel(model_path)

    # Check input/output specs
    spec = model.get_spec()
    for inp in spec.description.input:
        print(f"  Input: {inp.name}, shape: {inp.type}")
    for out in spec.description.output:
        print(f"  Output: {out.name}, shape: {out.type}")

    # Run dummy inference
    dummy = np.random.randn(1, 3, 112, 112).astype(np.float32)
    result = model.predict({"face_image": dummy})
    for key, value in result.items():
        if hasattr(value, "shape"):
            print(f"  Output '{key}' shape: {value.shape}")
        print(f"  Output '{key}' dtype: {type(value)}")

    print("Validation passed!")


if __name__ == "__main__":
    success = convert_edgeface()

    if not success:
        print("\nEdgeFace conversion failed. Trying fallback...")
        success = convert_mobilefacenet()

    if not success:
        print("\nAll conversions failed.")
        print("Options:")
        print("  1. Install edgeface: pip install git+https://github.com/otroshi/edgeface")
        print("  2. Download EdgeFace checkpoint to scripts/edgeface_xs.pth")
        print("  3. Download MobileFaceNet ONNX to scripts/mobilefacenet.onnx")
        sys.exit(1)

    # Validate
    models_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    for name in ["EdgeFaceXS.mlpackage", "MobileFaceNet.mlpackage"]:
        path = os.path.join(models_dir, name)
        if os.path.exists(path):
            validate_model(path)
            break

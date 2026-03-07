#!/usr/bin/env python3
"""
Convert AdaFace IR-SE-50 checkpoint to CoreML (.mlpackage).

Expected source:
  https://github.com/mk-minchul/AdaFace

Usage:
  pip install torch coremltools
  # Ensure AdaFace repo code is importable (PYTHONPATH or editable install)
  python scripts/convert_adaface.py \
    --checkpoint /path/to/adaface_ir50_webface4m.ckpt \
    --output models/AdaFace_IR50.mlpackage
"""

from __future__ import annotations

import argparse
import os
from typing import Dict, Any

import torch
import coremltools as ct


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert AdaFace IR-SE-50 to CoreML")
    parser.add_argument(
        "--checkpoint",
        required=True,
        help="Path to AdaFace checkpoint (.ckpt/.pth)",
    )
    parser.add_argument(
        "--output",
        default=os.path.join("models", "AdaFace_IR50.mlpackage"),
        help="Output CoreML package path",
    )
    parser.add_argument(
        "--deployment-target",
        default="iOS16",
        choices=["iOS15", "iOS16", "iOS17", "iOS18"],
        help="CoreML minimum iOS deployment target",
    )
    return parser.parse_args()


def deployment_target(target: str):
    mapping = {
        "iOS15": ct.target.iOS15,
        "iOS16": ct.target.iOS16,
        "iOS17": ct.target.iOS17,
        "iOS18": ct.target.iOS18,
    }
    return mapping[target]


def clean_state_dict(raw_state: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {}
    for key, value in raw_state.items():
        normalized = key
        for prefix in ("model.", "backbone.", "module."):
            if normalized.startswith(prefix):
                normalized = normalized[len(prefix) :]
        cleaned[normalized] = value
    return cleaned


def load_adaface_model(checkpoint_path: str):
    try:
        from adaface import net
    except ImportError as exc:
        raise RuntimeError(
            "Could not import `adaface.net`. Clone/install AdaFace and expose it on PYTHONPATH."
        ) from exc

    model = net.build_model("ir_50")
    checkpoint = torch.load(checkpoint_path, map_location="cpu")

    if isinstance(checkpoint, dict):
        if "state_dict" in checkpoint:
            state_dict = checkpoint["state_dict"]
        elif "model_state_dict" in checkpoint:
            state_dict = checkpoint["model_state_dict"]
        else:
            state_dict = checkpoint
    else:
        state_dict = checkpoint

    cleaned = clean_state_dict(state_dict)
    missing, unexpected = model.load_state_dict(cleaned, strict=False)
    if missing:
        print(f"Warning: missing keys ({len(missing)}): {missing[:8]}")
    if unexpected:
        print(f"Warning: unexpected keys ({len(unexpected)}): {unexpected[:8]}")

    model.eval()
    return model


def convert_to_coreml(model, output_path: str, minimum_target) -> None:
    dummy = torch.randn(1, 3, 112, 112)
    with torch.no_grad():
        out = model(dummy)

    output_dim = int(out.shape[-1]) if hasattr(out, "shape") else None
    if output_dim != 512:
        print(f"Warning: expected 512-dim embedding, got {output_dim}")

    traced = torch.jit.trace(model, dummy)
    traced = torch.jit.freeze(traced.eval())

    mlmodel = ct.convert(
        traced,
        inputs=[ct.TensorType(name="face_image", shape=(1, 3, 112, 112))],
        outputs=[ct.TensorType(name="embedding")],
        minimum_deployment_target=minimum_target,
        convert_to="mlprogram",
    )

    mlmodel.author = "Sensible Hackathon"
    mlmodel.short_description = "AdaFace IR-SE-50 face embedding model"
    mlmodel.input_description["face_image"] = "Aligned RGB face image of shape 1x3x112x112"
    mlmodel.output_description["embedding"] = "L2-normalized face embedding (typically 512-dim)"

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    mlmodel.save(output_path)


def validate_output(output_path: str) -> None:
    model = ct.models.MLModel(output_path)
    spec = model.get_spec()

    print("Model inputs:")
    for inp in spec.description.input:
        print(f"  - {inp.name}")
    print("Model outputs:")
    for out in spec.description.output:
        print(f"  - {out.name}")

    test_input = torch.randn(1, 3, 112, 112).numpy().astype("float32")
    prediction = model.predict({"face_image": test_input})
    embedding = prediction.get("embedding")
    if embedding is None:
        raise RuntimeError("Converted model does not return `embedding` output")

    shape = getattr(embedding, "shape", None)
    print(f"Validation output shape: {shape}")


def main() -> int:
    args = parse_args()

    if not os.path.exists(args.checkpoint):
        print(f"Checkpoint not found: {args.checkpoint}")
        return 1

    print("Loading AdaFace model...")
    model = load_adaface_model(args.checkpoint)

    target = deployment_target(args.deployment_target)
    print(f"Converting to CoreML with minimum target {args.deployment_target}...")
    convert_to_coreml(model, args.output, target)

    print(f"Saved CoreML package to {args.output}")
    print("Running quick validation...")
    validate_output(args.output)
    print("Done.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"Conversion failed: {exc}")
        raise

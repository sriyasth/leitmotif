#!/usr/bin/env python3
"""Validate the Gemini scene description integration by sending test video frames."""

import subprocess
import base64
import json
import sys
import os
import tempfile
from urllib.request import Request, urlopen
from urllib.error import HTTPError

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    print("ERROR: Set GEMINI_API_KEY environment variable")
    sys.exit(1)
GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"]

TEST_VIDEOS_DIR = os.path.join(os.path.dirname(__file__), "..", "testvideos")

PROMPT = "Describe the vibe of this scene in 1-2 sentences. Focus on the mood, atmosphere, and what people seem to be doing. Be concise."


def extract_frame_sips(video_path: str) -> bytes:
    """Extract a frame from video using macOS sips/qlmanage or fall back to screencapture."""
    # Use macOS qlmanage to generate a thumbnail from the video
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, "thumb.jpg")
        try:
            subprocess.run(
                ["qlmanage", "-t", "-s", "1280", "-o", tmpdir, video_path],
                capture_output=True, timeout=15
            )
            # qlmanage outputs as <filename>.png
            for f in os.listdir(tmpdir):
                if f.endswith(".png") or f.endswith(".jpg"):
                    fpath = os.path.join(tmpdir, f)
                    # Convert to JPEG using sips
                    subprocess.run(
                        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "60", fpath, "--out", out_path],
                        capture_output=True, timeout=10
                    )
                    with open(out_path, "rb") as img:
                        return img.read()
        except Exception as e:
            print(f"  qlmanage failed: {e}")

    raise RuntimeError(f"Could not extract frame from {video_path}")


def call_gemini(image_data: bytes) -> tuple:
    """Send image to Gemini API, trying multiple models. Returns (model, text)."""
    b64 = base64.b64encode(image_data).decode("utf-8")

    body = {
        "contents": [{
            "parts": [
                {"text": PROMPT},
                {"inline_data": {"mime_type": "image/jpeg", "data": b64}}
            ]
        }],
        "generationConfig": {
            "maxOutputTokens": 1024,
            "temperature": 0.7
        }
    }

    payload = json.dumps(body).encode("utf-8")
    last_error = None

    for model in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        req = Request(url, method="POST")
        req.add_header("Content-Type", "application/json")
        req.data = payload

        try:
            with urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read())
                text = result["candidates"][0]["content"]["parts"][0]["text"]
                return model, text.strip()
        except HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else ""
            if e.code == 429:
                last_error = f"{model}: quota exceeded"
                continue
            raise RuntimeError(f"Gemini API error {e.code} ({model}): {error_body}")

    raise RuntimeError(f"All models exhausted. Last: {last_error}")


def main():
    videos = sorted([
        f for f in os.listdir(TEST_VIDEOS_DIR)
        if f.lower().endswith((".mov", ".mp4", ".m4v")) and "enroll" not in f.lower()
    ])

    if not videos:
        print("No test videos found in testvideos/")
        sys.exit(1)

    print(f"Found {len(videos)} test video(s)\n")
    print("=" * 60)

    for video in videos:
        video_path = os.path.join(TEST_VIDEOS_DIR, video)
        print(f"\n  {video}")
        print("-" * 60)

        try:
            print("  Extracting frame...")
            frame_data = extract_frame_sips(video_path)
            print(f"  Frame size: {len(frame_data)} bytes")

            print("  Sending to Gemini...")
            model, vibe = call_gemini(frame_data)
            print(f"  Model: {model}")
            print(f"\n  VIBE: {vibe}")
        except Exception as e:
            print(f"  ERROR: {e}")

        print("-" * 60)

    print("\nDone.")


if __name__ == "__main__":
    main()

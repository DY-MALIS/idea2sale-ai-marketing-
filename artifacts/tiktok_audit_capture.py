"""Capture the visible desktop for a TikTok audit screen recording."""

import argparse
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import ImageGrab


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--stop-file", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=120)
    parser.add_argument("--fps", type=int, default=8)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.stop_file.unlink(missing_ok=True)
    first = ImageGrab.grab()
    width = 1600
    height = round(first.height * width / first.width)
    height += height % 2
    writer = cv2.VideoWriter(
        str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (width, height)
    )
    if not writer.isOpened():
        raise RuntimeError(f"Could not start MP4 writer: {args.output}")

    start = time.monotonic()
    frames = 0
    try:
        while time.monotonic() - start < args.seconds and not args.stop_file.exists():
            deadline = start + frames / args.fps
            delay = deadline - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            image = ImageGrab.grab()
            frame = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
            writer.write(cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA))
            frames += 1
    finally:
        writer.release()
        print(f"frames={frames} seconds={time.monotonic() - start:.1f} output={args.output}", flush=True)


if __name__ == "__main__":
    main()

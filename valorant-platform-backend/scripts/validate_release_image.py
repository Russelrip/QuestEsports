"""Validate and hand off an immutable production image command."""

from __future__ import annotations

import os
import re
import sys

IMMUTABLE_IMAGE = re.compile(r"^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$")


def is_immutable_release_image(image: str | None) -> bool:
    """Return true only for a lowercase repository with a full sha256 digest."""
    return image is not None and IMMUTABLE_IMAGE.fullmatch(image) is not None


def main() -> int:
    image = os.environ.get("VALORANT_PLATFORM_IMAGE")
    if not is_immutable_release_image(image):
        print("VALORANT_PLATFORM_IMAGE must be an immutable @sha256:<64 hex> image", file=sys.stderr)
        return 64
    if len(sys.argv) < 2:
        print("production image command is missing", file=sys.stderr)
        return 64
    os.execvp(sys.argv[1], sys.argv[1:])
    return 0  # pragma: no cover - os.execvp replaces this process


if __name__ == "__main__":
    raise SystemExit(main())

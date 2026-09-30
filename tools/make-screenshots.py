"""Crop the two usable screenshots down to the app surface and into docs/.

The captures include browser chrome (tab strip, address bar, the signed-in profile
avatar top-right). None of that belongs in a README, so every crop starts below the
address bar. One image is also downscaled: GitHub renders README content around
880px wide, and a 1900px capture is scaled down there anyway, which softens UI text.
"""
from pathlib import Path

from PIL import Image

SHOTS = Path(r"C:\Users\Administrator\Pictures\Screenshots")
DOCS = Path(r"C:\Users\Administrator\Downloads\dsh\docs")

# (source, destination, box, target width) — box is left, top, right, bottom in the
# 1920x1020 capture; y=104 is the first row of the app itself.
JOBS = [
    (
        "屏幕截图 2026-10-01 002456.png",
        "screenshot-menu.png",
        (10, 104, 780, 726),
        None,  # already a sensible width: keep 1:1 so the text stays crisp
    ),
    (
        "屏幕截图 2026-10-01 002634.png",
        "screenshot-delete-dialog.png",
        (330, 200, 1420, 810),
        1000,
    ),
]

# Captures that arrived as chat attachments rather than files in the Screenshots
# folder: (absolute source, destination, box, target width).
ATTACHMENTS = [
    (
        r"C:\Users\Administrator\.dsh\attachments\v1\objects\7e\7e2ae0e44c7615d0cf429ac689898128b248eb476bc11e535aa64185ce207268",
        "screenshot-cleanup.png",
        (400, 240, 1520, 880),
        1000,
    ),
]

for source, destination, box, target_width in JOBS:
    image = Image.open(SHOTS / source).convert("RGB")
    cropped = image.crop(box)
    if target_width is not None and cropped.width > target_width:
        height = round(cropped.height * target_width / cropped.width)
        cropped = cropped.resize((target_width, height), Image.LANCZOS)
    out = DOCS / destination
    cropped.save(out, format="PNG", optimize=True)
    print(f"{destination}: {cropped.width}x{cropped.height}, {out.stat().st_size // 1024} KB")

for source, destination, box, target_width in ATTACHMENTS:
    image = Image.open(source).convert("RGB")
    cropped = image.crop(box)
    if target_width is not None and cropped.width > target_width:
        height = round(cropped.height * target_width / cropped.width)
        cropped = cropped.resize((target_width, height), Image.LANCZOS)
    out = DOCS / destination
    cropped.save(out, format="PNG", optimize=True)
    print(f"{destination}: {cropped.width}x{cropped.height}, {out.stat().st_size // 1024} KB")

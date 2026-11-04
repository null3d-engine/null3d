# Prints, for each PNG file given, the share of the bottom third of the frame that shows the sky's
# color. The desert's walk view shows its ground there; a high share means the ground did not draw.
# Run: uv run --no-project --with pillow python -I bench/research/triangle-budget/scripts/ground-check.py <png>...
import sys

from PIL import Image

for path in sys.argv[1:]:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    pixels = image.load()
    sky = pixels[width // 2, 5]
    near = total = 0
    for y in range(2 * height // 3, height, 6):
        for x in range(0, width, 6):
            total += 1
            if sum(abs(pixels[x, y][i] - sky[i]) for i in range(3)) < 20:
                near += 1
    print(f"{path.split('/')[-1]}\t{near / total:.3f}")

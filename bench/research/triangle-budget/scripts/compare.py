# Compares each held frame of the triangle budget study with its engine's own reference: the same
# engine, view, shadows and camera time drawn from the base meshes alone (both thresholds 0).
# Each engine is judged against itself, so differences in shading and shadow method between the two
# engines do not count; only the levels of detail differ within a pair.
#
# Measures, each over the whole frame and over three bands of rows (the near ground and props at
# the bottom, the middle, the far dunes and sky at the top):
# - FLIP (NVIDIA's perceptual difference, LDR, 67 pixels per degree), mean and 99th percentile;
# - the share of pixels whose FLIP error passes 0.1, a difference most viewers notice;
# - SSIM of linear luminance;
# - mean absolute difference of linear color, in units of 1/255.
#
# Run from the repository's root:
#   uv run --no-project --with flip-evaluator --with numpy --with pillow --with scikit-image \
#     python -I bench/research/triangle-budget/scripts/compare.py [shots.json] [out.json]
import json
import os
import sys

import flip_evaluator as flip
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity

ROOT = os.getcwd()
HERE = os.path.join(ROOT, "bench/research/triangle-budget")
SHOTS = os.path.join(ROOT, "target/triangle-budget/shots")
MAPS = os.path.join(ROOT, "target/triangle-budget/flip-maps")
os.makedirs(MAPS, exist_ok=True)
records_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "results/shots.json")
out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "results/compare.json")
records = json.load(open(records_path))


def load(name):
    image = np.asarray(Image.open(os.path.join(SHOTS, name)).convert("RGB"), dtype=np.float32) / 255
    return image


def linear(srgb):
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def luminance(lin):
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


BANDS = {"all": (0.0, 1.0), "top": (0.0, 1 / 3), "middle": (1 / 3, 2 / 3), "near": (2 / 3, 1.0)}


def measures(ref, test, keep_map=None):
    error_map, _, _ = flip.evaluate(ref, test, "LDR", applyMagma=False)
    error_map = np.asarray(error_map, dtype=np.float32)
    if error_map.ndim == 3:
        error_map = error_map[..., 0]
    lin_ref, lin_test = linear(ref), linear(test)
    _, ssim_map = structural_similarity(
        luminance(lin_ref), luminance(lin_test), data_range=1.0, full=True
    )
    mad = np.abs(lin_ref - lin_test).mean(axis=2) * 255
    height = ref.shape[0]
    figures = {}
    for band, (a, b) in BANDS.items():
        rows = slice(int(a * height), int(b * height))
        f = error_map[rows]
        figures[band] = {
            "flip": float(f.mean()),
            "flip99": float(np.percentile(f, 99)),
            "flipOver01": float((f > 0.1).mean()),
            "ssim": float(ssim_map[rows].mean()),
            "mad": float(mad[rows].mean()),
        }
    if keep_map:
        Image.fromarray((np.clip(error_map, 0, 1) * 255).astype(np.uint8)).save(
            os.path.join(MAPS, keep_map)
        )
    return figures


def key(r):
    return (r["engine"], r["view"], r["shadows"], r["t"])


# A variant, such as other model files, is judged against the plain run's reference.
refs = {key(r): r for r in records if r["lod"] == 0 and r["lodShadow"] == 0 and not r.get("variant")}
cache = {}
rows = []
for r in records:
    ref = refs.get(key(r))
    if ref is None or ref is r:
        continue
    if ref["shot"] not in cache:
        cache.clear()
        cache[ref["shot"]] = load(ref["shot"])
    figures = measures(cache[ref["shot"]], load(r["shot"]), keep_map=f"flip-{r['shot']}")
    rows.append({**{k: r[k] for k in ("engine", "view", "shadows", "lod", "lodShadow", "t", "shot")},
                 "variant": r.get("variant", ""),
                 "triangles": r.get("triangles"), "shadowTriangles": r.get("shadowTriangles"),
                 "gpuMs": r.get("gpuMs"), "refTriangles": ref.get("triangles"),
                 "refGpuMs": ref.get("gpuMs"), **figures})
    print(r["shot"], json.dumps(figures["all"]))

# The mean over the camera times of each setting.
summary = {}
for row in rows:
    s = (row["engine"], row["variant"], row["view"], row["shadows"], row["lod"], row["lodShadow"])
    summary.setdefault(s, []).append(row)
table = []
for (engine, variant, view, shadows, lod, lod_shadow), group in sorted(summary.items()):
    mean = lambda f: float(np.mean([f(g) for g in group if f(g) is not None])) if any(
        f(g) is not None for g in group) else None
    table.append({
        "engine": engine, "variant": variant, "view": view, "shadows": shadows, "lod": lod, "lodShadow": lod_shadow,
        "frames": len(group),
        "triangles": mean(lambda g: g["triangles"]),
        "shadowTriangles": mean(lambda g: g["shadowTriangles"]),
        "gpuMs": mean(lambda g: g["gpuMs"]),
        **{f"{band}.{m}": mean(lambda g, band=band, m=m: g[band][m])
           for band in BANDS for m in ("flip", "flip99", "flipOver01", "ssim", "mad")},
        "worstFlip": max(g["all"]["flip"] for g in group),
        "worstNearFlip": max(g["near"]["flip"] for g in group),
    })
json.dump({"frames": rows, "table": table}, open(out_path, "w"), indent="\t")
print(f"wrote {out_path}")
for t in table:
    print(t["engine"], t["variant"] or "-", t["shadows"], t["lod"], t["lodShadow"], f"tris {t['triangles']}",
          f"flip {t['all.flip']:.4f} near {t['near.flip']:.4f} over0.1 {t['all.flipOver01']:.4f}",
          f"ssim {t['all.ssim']:.4f} mad {t['all.mad']:.3f}")

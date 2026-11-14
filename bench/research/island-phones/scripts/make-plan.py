# Writes the phones study's ablation plan: each load holds the town view at one preset, drawing size
# and anti-aliasing, and steps through the scene with each part hidden in turn, the whole scene again
# between them, then live quality settings one on top of the other.
#   python3 bench/research/island-phones/scripts/make-plan.py
import json
from pathlib import Path

PARTS = ['town', 'trees.shrubs.cypress', 'cards', 'grass', 'ground', 'water.reflection', 'reflection',
         'shadows']
SETS = [{'fogSlices': 0}, {'ssrScale': 0}, {'lodFade': False}, {'physicalSky': False},
        {'lodThreshold': 4}]

steps = ['base']
for part in PARTS:
    steps += [part, 'base']
steps += ['set:' + json.dumps(s, separators=(',', ':')) for s in SETS]
query = '&warm=20&seconds=3&steps=' + ','.join(steps)

LOADS = [
    ('medium-384x832-msaa-mt', 'preset=medium&w=384&h=832'),
    ('medium-384x832-msaa-nomt', 'preset=medium&w=384&h=832&mt=0'),
    ('medium-384x832-fxaa-mt', 'preset=medium&w=384&h=832&aa=fxaa'),
    ('low-384x832', 'preset=low&w=384&h=832'),
    ('low-576x1248', 'preset=low&w=576&h=1248'),
    ('low-576x1248-scale05', 'preset=low&w=576&h=1248&scale=0.5'),
    ('medium-768x1664', 'preset=medium&w=768&h=1664'),
    ('high-1920x1080', 'preset=high&w=1920&h=1080'),
]
plan = [{'name': name, 'query': q + query} for name, q in LOADS]
out = Path(__file__).parent.parent / 'plans' / 'ablate.json'
out.write_text(json.dumps(plan, indent=1) + '\n')
print(f'{len(plan)} loads of {len(steps)} steps -> {out}')

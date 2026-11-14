# Writes the phones study's trial plan: changes that a phone preset or the Island could make, each
# tried for one window between whole-scene windows, at the visitor's Low on a Galaxy S25's drawing
# size and at the cloud runs' Medium. The start-time choices (moment transparency, the depth
# prepass) take a load each, and the plan alternates them so a drift over the run falls on both.
#   python3 bench/research/island-phones/scripts/make-trials.py
import json
from pathlib import Path

TRIALS = ['try:cards1', 'casters', 'try:shadow300', 'try:shadow150', 'try:grass80', 'try:grassdark',
          'try:reflect4', 'reflection', 'cards.casters']
steps = ['base']
for t in TRIALS:
    steps += [t, 'base']
live = '&warm=20&seconds=3&steps=' + ','.join(steps)
plain = '&warm=20&seconds=3&steps=' + ','.join(['base'] * 6)

LOW = 'preset=low&w=576&h=1248'
MEDIUM = 'preset=medium&w=384&h=832'
LOADS = [
    ('trials-low-576x1248', LOW + live),
    ('trials-medium-384x832', MEDIUM + live),
]
for side in ('a', 'b'):
    for name, q in (('low-mt1', LOW), ('low-mt0', LOW + '&mt=0'), ('low-prepass1', LOW + '&prepass=1')):
        LOADS.append((f'start-{name}-{side}', q + plain))
plan = [{'name': name, 'query': q} for name, q in LOADS]
out = Path(__file__).parent.parent / 'plans' / 'trials.json'
out.write_text(json.dumps(plan, indent=1) + '\n')
print(f'{len(plan)} loads -> {out}')

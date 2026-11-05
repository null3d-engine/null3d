## bistro-street: 1 views, means

### Camera pass, all copies

Groups of 64:

| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| street | 0.07 | 0.04 | 0.00 | 0.00 | 0.00 | 0.03 | 0.03 |
| building | 0.46 | 0.17 | 0.01 | 0.02 | 0.02 | 0.28 | 0.26 |
| prop | 0.34 | 0.03 | 0.01 | 0.02 | 0.02 | 0.30 | 0.28 |
| foliage | 0.30 | 0.05 | 0.00 | 0.04 | 0.04 | 0.25 | 0.21 |
| all | 1.17 | 0.28 | 0.03 | 0.08 | 0.08 | 0.86 | 0.78 |

Groups of 128:

| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| street | 0.07 | 0.04 | 0.00 | 0.00 | 0.00 | 0.03 | 0.03 |
| building | 0.46 | 0.16 | 0.01 | 0.02 | 0.02 | 0.29 | 0.27 |
| prop | 0.34 | 0.02 | 0.01 | 0.02 | 0.02 | 0.31 | 0.29 |
| foliage | 0.30 | 0.05 | 0.00 | 0.04 | 0.04 | 0.25 | 0.21 |
| all | 1.17 | 0.27 | 0.02 | 0.08 | 0.08 | 0.88 | 0.81 |

### Camera pass, slots for the K heaviest copies of each mesh

Camera, groups of 64:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K=1 | 408 | 14109 | 0.28 | 0.03 | 0.08 | 0.86 | 0.78 |
| all | 408 | 14109 | 0.28 | 0.03 | 0.08 | 0.86 | 0.78 |

Camera, groups of 128:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K=1 | 408 | 7070 | 0.27 | 0.02 | 0.08 | 0.88 | 0.81 |
| all | 408 | 7070 | 0.27 | 0.02 | 0.08 | 0.88 | 0.81 |

### Camera pass, slots for the N heaviest copies of the scene

Camera, groups of 64:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| N=16 | 16 | 7790 | 0.18 | 0.02 | 0.02 | 0.98 | 0.95 |
| N=32 | 32 | 11516 | 0.22 | 0.02 | 0.07 | 0.93 | 0.86 |
| N=64 | 64 | 14109 | 0.28 | 0.03 | 0.08 | 0.86 | 0.78 |
| N=128 | 128 | 14109 | 0.28 | 0.03 | 0.08 | 0.86 | 0.78 |
| N=256 | 256 | 14109 | 0.28 | 0.03 | 0.08 | 0.86 | 0.78 |
| all | 408 | 14109 | 0.28 | 0.03 | 0.08 | 0.86 | 0.78 |

Camera, groups of 128:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| N=16 | 16 | 3901 | 0.17 | 0.02 | 0.02 | 0.99 | 0.97 |
| N=32 | 32 | 5771 | 0.21 | 0.02 | 0.07 | 0.94 | 0.88 |
| N=64 | 64 | 7070 | 0.27 | 0.02 | 0.08 | 0.88 | 0.81 |
| N=128 | 128 | 7070 | 0.27 | 0.02 | 0.08 | 0.88 | 0.81 |
| N=256 | 256 | 7070 | 0.27 | 0.02 | 0.08 | 0.88 | 0.81 |
| all | 408 | 7070 | 0.27 | 0.02 | 0.08 | 0.88 | 0.81 |

### Camera pass totals, each choice of slot copies (hidden: full-depth pyramid; D-40 occluders in brackets)

Groups of 64:

| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |
| --- | --- | --- | --- | --- | --- |
| all | 1.17 | 1.15 (1.15) | 0.86 | 0.78 (0.78) | 0.78 (0.78) |
| K1 | 1.17 | 1.15 (1.15) | 0.86 | 0.78 (0.78) | 0.78 (0.78) |
| N16 | 1.17 | 1.15 (1.15) | 0.98 | 0.95 (0.95) | 0.93 (0.93) |
| N32 | 1.17 | 1.15 (1.15) | 0.93 | 0.86 (0.86) | 0.86 (0.86) |
| N64 | 1.17 | 1.15 (1.15) | 0.86 | 0.78 (0.78) | 0.78 (0.78) |
| N128 | 1.17 | 1.15 (1.15) | 0.86 | 0.78 (0.78) | 0.78 (0.78) |
| N256 | 1.17 | 1.15 (1.15) | 0.86 | 0.78 (0.78) | 0.78 (0.78) |

Groups of 128:

| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |
| --- | --- | --- | --- | --- | --- |
| all | 1.17 | 1.15 (1.15) | 0.88 | 0.81 (0.81) | 0.80 (0.81) |
| K1 | 1.17 | 1.15 (1.15) | 0.88 | 0.81 (0.81) | 0.80 (0.81) |
| N16 | 1.17 | 1.15 (1.15) | 0.99 | 0.97 (0.97) | 0.95 (0.95) |
| N32 | 1.17 | 1.15 (1.15) | 0.94 | 0.88 (0.88) | 0.88 (0.88) |
| N64 | 1.17 | 1.15 (1.15) | 0.88 | 0.81 (0.81) | 0.80 (0.81) |
| N128 | 1.17 | 1.15 (1.15) | 0.88 | 0.81 (0.81) | 0.80 (0.81) |
| N256 | 1.17 | 1.15 (1.15) | 0.88 | 0.81 (0.81) | 0.80 (0.81) |

### Shadow cascades (casters: whole levels now; groups: box planes only)

| Cascade | Texel (m) | Now | Off box, pieces | Off box, 64 | Off box, 128 | K=1, 64 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.019 | 1.76 | 0.00 | 0.18 | 0.17 | 0.18 |
| 1 | 0.045 | 1.97 | 0.00 | 0.08 | 0.07 | 0.08 |
| 2 | 0.156 | 2.26 | 0.00 | 0.00 | 0.00 | 0.00 |
| per frame (far cascades every 3 frames) | | 3.16 | 0.00 | 0.21 | 0.19 | 0.21 |

Shadow casters per kind, all cascades per frame:

| Kind | Now | Off box, 64 |
| --- | --- | --- |
| street | 0.12 | 0.04 |
| building | 1.19 | 0.14 |
| prop | 0.74 | 0.00 |
| foliage | 1.11 | 0.03 |

### Occlusion at each grain, camera pass

| Kind | Copies in view | Copies hidden (full / D-40) | Triangles now | Hidden as copies (full / D-40) | Hidden as copies or pieces (full) | Groups that pass view and facing (64) | Of them hidden (full / D-40) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| street | 28 | 0 / 0 | 0.07 | 0.00 / 0.00 | 0.00 | 187 | 1% / 1% |
| building | 160 | 0 / 0 | 0.46 | 0.00 / 0.00 | 0.00 | 3187 | 10% / 10% |
| prop | 115 | 1 / 1 | 0.34 | 0.00 / 0.00 | 0.00 | 3157 | 10% / 10% |
| foliage | 105 | 12 / 7 | 0.30 | 0.02 / 0.02 | 0.02 | 2624 | 25% / 25% |
| all | 408 | 13 (3%) / 8 (2%) | 1.17 | 0.02 (2%) / 0.02 (2%) | 0.02 (2%) | 9155 | 14% / 14% |

D-40 occluders (copies spanning at least a sixteenth of the screen): 291 copies, 1.00 M triangles in the occluders' depth pass, plus the ground. Share of the screen covered: 99%.

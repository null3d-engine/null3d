## bistro-wide: 1 views, means

### Camera pass, all copies

Groups of 64:

| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| street | 0.07 | 0.02 | 0.00 | 0.02 | 0.02 | 0.05 | 0.04 |
| building | 0.83 | 0.03 | 0.03 | 0.18 | 0.18 | 0.77 | 0.59 |
| prop | 0.41 | 0.00 | 0.00 | 0.08 | 0.08 | 0.41 | 0.33 |
| foliage | 0.65 | 0.01 | 0.01 | 0.35 | 0.33 | 0.63 | 0.28 |
| all | 1.97 | 0.06 | 0.04 | 0.63 | 0.61 | 1.87 | 1.24 |

Groups of 128:

| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| street | 0.07 | 0.02 | 0.00 | 0.01 | 0.01 | 0.05 | 0.04 |
| building | 0.83 | 0.03 | 0.02 | 0.16 | 0.16 | 0.79 | 0.63 |
| prop | 0.41 | 0.00 | 0.00 | 0.08 | 0.08 | 0.41 | 0.33 |
| foliage | 0.65 | 0.01 | 0.00 | 0.33 | 0.32 | 0.63 | 0.30 |
| all | 1.97 | 0.06 | 0.02 | 0.58 | 0.57 | 1.89 | 1.31 |

### Camera pass, slots for the K heaviest copies of each mesh

Camera, groups of 64:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K=1 | 1473 | 20609 | 0.06 | 0.04 | 0.63 | 1.87 | 1.24 |
| all | 1473 | 20609 | 0.06 | 0.04 | 0.63 | 1.87 | 1.24 |

Camera, groups of 128:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K=1 | 1473 | 10333 | 0.06 | 0.02 | 0.58 | 1.89 | 1.31 |
| all | 1473 | 10333 | 0.06 | 0.02 | 0.58 | 1.89 | 1.31 |

### Camera pass, slots for the N heaviest copies of the scene

Camera, groups of 64:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| N=16 | 16 | 8381 | 0.02 | 0.03 | 0.17 | 1.91 | 1.74 |
| N=32 | 32 | 12996 | 0.02 | 0.04 | 0.37 | 1.91 | 1.55 |
| N=64 | 64 | 18622 | 0.05 | 0.04 | 0.56 | 1.87 | 1.32 |
| N=128 | 128 | 20609 | 0.06 | 0.04 | 0.63 | 1.87 | 1.24 |
| N=256 | 256 | 20609 | 0.06 | 0.04 | 0.63 | 1.87 | 1.24 |
| all | 1473 | 20609 | 0.06 | 0.04 | 0.63 | 1.87 | 1.24 |

Camera, groups of 128:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| N=16 | 16 | 4197 | 0.02 | 0.02 | 0.15 | 1.93 | 1.78 |
| N=32 | 32 | 6511 | 0.02 | 0.02 | 0.34 | 1.93 | 1.59 |
| N=64 | 64 | 9333 | 0.05 | 0.02 | 0.51 | 1.89 | 1.38 |
| N=128 | 128 | 10333 | 0.06 | 0.02 | 0.58 | 1.89 | 1.31 |
| N=256 | 256 | 10333 | 0.06 | 0.02 | 0.58 | 1.89 | 1.31 |
| all | 1473 | 10333 | 0.06 | 0.02 | 0.58 | 1.89 | 1.31 |

### Camera pass totals, each choice of slot copies (hidden: full-depth pyramid; D-40 occluders in brackets)

Groups of 64:

| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |
| --- | --- | --- | --- | --- | --- |
| all | 1.97 | 1.44 (1.44) | 1.87 | 1.24 (1.25) | 0.96 (0.98) |
| K1 | 1.97 | 1.44 (1.44) | 1.87 | 1.24 (1.25) | 0.96 (0.98) |
| N16 | 1.97 | 1.44 (1.44) | 1.91 | 1.74 (1.74) | 1.24 (1.24) |
| N32 | 1.97 | 1.44 (1.44) | 1.91 | 1.55 (1.55) | 1.19 (1.20) |
| N64 | 1.97 | 1.44 (1.44) | 1.87 | 1.32 (1.34) | 1.02 (1.04) |
| N128 | 1.97 | 1.44 (1.44) | 1.87 | 1.24 (1.25) | 0.96 (0.98) |
| N256 | 1.97 | 1.44 (1.44) | 1.87 | 1.24 (1.25) | 0.96 (0.98) |

Groups of 128:

| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |
| --- | --- | --- | --- | --- | --- |
| all | 1.97 | 1.44 (1.44) | 1.89 | 1.31 (1.32) | 1.03 (1.04) |
| K1 | 1.97 | 1.44 (1.44) | 1.89 | 1.31 (1.32) | 1.03 (1.04) |
| N16 | 1.97 | 1.44 (1.44) | 1.93 | 1.78 (1.78) | 1.28 (1.28) |
| N32 | 1.97 | 1.44 (1.44) | 1.93 | 1.59 (1.59) | 1.23 (1.24) |
| N64 | 1.97 | 1.44 (1.44) | 1.89 | 1.38 (1.40) | 1.08 (1.10) |
| N128 | 1.97 | 1.44 (1.44) | 1.89 | 1.31 (1.32) | 1.03 (1.04) |
| N256 | 1.97 | 1.44 (1.44) | 1.89 | 1.31 (1.32) | 1.03 (1.04) |

### Shadow cascades (casters: whole levels now; groups: box planes only)

| Cascade | Texel (m) | Now | Off box, pieces | Off box, 64 | Off box, 128 | K=1, 64 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.019 | 0.23 | 0.00 | 0.17 | 0.17 | 0.17 |
| 1 | 0.045 | 2.56 | 0.00 | 0.03 | 0.03 | 0.03 |
| 2 | 0.156 | 2.26 | 0.00 | 0.00 | 0.00 | 0.00 |
| per frame (far cascades every 3 frames) | | 1.84 | 0.00 | 0.18 | 0.18 | 0.18 |

Shadow casters per kind, all cascades per frame:

| Kind | Now | Off box, 64 |
| --- | --- | --- |
| street | 0.11 | 0.05 |
| building | 0.75 | 0.09 |
| prop | 0.30 | 0.00 |
| foliage | 0.67 | 0.04 |

### Occlusion at each grain, camera pass

| Kind | Copies in view | Copies hidden (full / D-40) | Triangles now | Hidden as copies (full / D-40) | Hidden as copies or pieces (full) | Groups that pass view and facing (64) | Of them hidden (full / D-40) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| street | 37 | 12 / 11 | 0.07 | 0.00 / 0.00 | 0.00 | 565 | 54% / 54% |
| building | 903 | 408 / 405 | 0.83 | 0.08 / 0.08 | 0.08 | 8403 | 34% / 34% |
| prop | 319 | 166 / 166 | 0.41 | 0.14 / 0.14 | 0.14 | 2679 | 48% / 47% |
| foliage | 214 | 127 / 127 | 0.65 | 0.29 / 0.29 | 0.29 | 7350 | 75% / 71% |
| all | 1473 | 713 (48%) / 709 (48%) | 1.97 | 0.52 (27%) / 0.52 (27%) | 0.52 (27%) | 18997 | 52% / 51% |

D-40 occluders (copies spanning at least a sixteenth of the screen): 301 copies, 0.95 M triangles in the occluders' depth pass, plus the ground. Share of the screen covered: 41%.

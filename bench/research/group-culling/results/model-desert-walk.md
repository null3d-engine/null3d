## desert-walk: 40 views, means

### Camera pass, all copies

Groups of 64:

| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| column | 0.16 | 0.00 | 0.00 | 0.00 | 0.00 | 0.15 | 0.15 |
| arch | 1.67 | 0.71 | 0.20 | 0.26 | 0.26 | 0.75 | 0.49 |
| boulder | 0.89 | 0.01 | 0.03 | 0.12 | 0.12 | 0.85 | 0.73 |
| pebble | 0.82 | 0.00 | 0.00 | 0.00 | 0.00 | 0.81 | 0.81 |
| all | 3.54 | 0.73 | 0.24 | 0.38 | 0.38 | 2.57 | 2.18 |

Groups of 128:

| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| column | 0.16 | 0.00 | 0.00 | 0.00 | 0.00 | 0.15 | 0.15 |
| arch | 1.67 | 0.70 | 0.18 | 0.23 | 0.23 | 0.79 | 0.57 |
| boulder | 0.89 | 0.01 | 0.02 | 0.12 | 0.11 | 0.86 | 0.75 |
| pebble | 0.82 | 0.00 | 0.00 | 0.00 | 0.00 | 0.82 | 0.82 |
| all | 3.54 | 0.71 | 0.20 | 0.34 | 0.34 | 2.62 | 2.28 |

### Camera pass, slots for the K heaviest copies of each mesh

Camera, groups of 64:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K=2 | 32 | 23051 | 0.69 | 0.18 | 0.18 | 2.66 | 2.49 |
| K=4 | 62 | 27265 | 0.72 | 0.22 | 0.27 | 2.60 | 2.33 |
| K=8 | 117 | 29682 | 0.73 | 0.23 | 0.35 | 2.57 | 2.22 |
| K=16 | 221 | 30322 | 0.73 | 0.24 | 0.38 | 2.57 | 2.19 |
| all | 8739 | 30340 | 0.73 | 0.24 | 0.38 | 2.57 | 2.18 |

Camera, groups of 128:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K=2 | 32 | 11540 | 0.68 | 0.16 | 0.15 | 2.70 | 2.55 |
| K=4 | 62 | 13653 | 0.70 | 0.18 | 0.24 | 2.65 | 2.41 |
| K=8 | 117 | 14862 | 0.71 | 0.20 | 0.31 | 2.63 | 2.31 |
| K=16 | 221 | 15182 | 0.71 | 0.20 | 0.34 | 2.62 | 2.28 |
| all | 8739 | 15191 | 0.71 | 0.20 | 0.34 | 2.62 | 2.28 |

### Camera pass totals, each choice of slot copies (hidden: full-depth pyramid; D-40 occluders in brackets)

Groups of 64:

| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |
| --- | --- | --- | --- | --- | --- |
| all | 3.54 | 2.70 (2.71) | 2.57 | 2.18 (2.19) | 1.45 (1.46) |
| K2 | 3.54 | 2.70 (2.71) | 2.66 | 2.49 (2.49) | 1.68 (1.69) |
| K4 | 3.54 | 2.70 (2.71) | 2.60 | 2.33 (2.33) | 1.55 (1.56) |
| K8 | 3.54 | 2.70 (2.71) | 2.57 | 2.22 (2.22) | 1.47 (1.48) |
| K16 | 3.54 | 2.70 (2.71) | 2.57 | 2.19 (2.19) | 1.45 (1.46) |

Groups of 128:

| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |
| --- | --- | --- | --- | --- | --- |
| all | 3.54 | 2.70 (2.71) | 2.62 | 2.28 (2.28) | 1.55 (1.56) |
| K2 | 3.54 | 2.70 (2.71) | 2.70 | 2.55 (2.55) | 1.74 (1.75) |
| K4 | 3.54 | 2.70 (2.71) | 2.65 | 2.41 (2.41) | 1.63 (1.64) |
| K8 | 3.54 | 2.70 (2.71) | 2.63 | 2.31 (2.32) | 1.56 (1.58) |
| K16 | 3.54 | 2.70 (2.71) | 2.62 | 2.28 (2.29) | 1.55 (1.56) |

### Shadow cascades (casters: whole levels now; groups: box planes only)

| Cascade | Texel (m) | Now | Off box, pieces | Off box, 64 | Off box, 128 | K=2, 64 | K=4, 64 | K=8, 64 | K=16, 64 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.019 | 2.22 | 0.07 | 0.92 | 0.91 | 0.86 | 0.92 | 0.92 | 0.92 |
| 1 | 0.045 | 2.60 | 0.03 | 0.41 | 0.40 | 0.28 | 0.40 | 0.41 | 0.41 |
| 2 | 0.156 | 3.91 | 0.01 | 0.17 | 0.17 | 0.03 | 0.09 | 0.15 | 0.17 |
| per frame (far cascades every 3 frames) | | 4.39 | 0.09 | 1.12 | 1.09 | 0.96 | 1.08 | 1.11 | 1.11 |

Shadow casters per kind, all cascades per frame:

| Kind | Now | Off box, 64 |
| --- | --- | --- |
| column | 0.15 | 0.01 |
| arch | 1.89 | 1.07 |
| boulder | 0.67 | 0.03 |
| pebble | 1.68 | 0.00 |

### Occlusion at each grain, camera pass

| Kind | Copies in view | Copies hidden (full / D-40) | Triangles now | Hidden as copies (full / D-40) | Hidden as copies or pieces (full) | Groups that pass view and facing (64) | Of them hidden (full / D-40) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| column | 91 | 28 / 27 | 0.16 | 0.04 / 0.04 | 0.04 | 99 | 0% / 0% |
| arch | 13 | 1 / 1 | 1.67 | 0.03 / 0.03 | 0.04 | 11774 | 35% / 34% |
| boulder | 675 | 464 / 458 | 0.89 | 0.45 / 0.45 | 0.45 | 3167 | 61% / 60% |
| pebble | 7960 | 5533 / 5421 | 0.82 | 0.30 / 0.30 | 0.30 | 146 | 2% / 2% |
| all | 8739 | 6025 (69%) / 5907 (68%) | 3.54 | 0.83 (23%) / 0.82 (23%) | 0.83 (24%) | 15186 | 40% / 39% |

D-40 occluders (copies spanning at least a sixteenth of the screen): 43 copies, 1.81 M triangles in the occluders' depth pass, plus the ground. Share of the screen covered: 73%.

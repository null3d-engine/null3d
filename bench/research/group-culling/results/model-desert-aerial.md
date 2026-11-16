## desert-aerial: 20 views, means

### Camera pass, all copies

Groups of 64:

| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| column | 0.32 | 0.00 | 0.00 | 0.00 | 0.00 | 0.32 | 0.32 |
| arch | 0.98 | 0.04 | 0.09 | 0.05 | 0.05 | 0.85 | 0.79 |
| boulder | 0.91 | 0.00 | 0.00 | 0.00 | 0.00 | 0.90 | 0.90 |
| pebble | 1.03 | 0.00 | 0.00 | 0.00 | 0.00 | 1.03 | 1.03 |
| all | 3.22 | 0.04 | 0.09 | 0.05 | 0.05 | 3.09 | 3.04 |

Groups of 128:

| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| column | 0.32 | 0.00 | 0.00 | 0.00 | 0.00 | 0.32 | 0.32 |
| arch | 0.98 | 0.04 | 0.05 | 0.02 | 0.02 | 0.89 | 0.87 |
| boulder | 0.91 | 0.00 | 0.00 | 0.00 | 0.00 | 0.90 | 0.90 |
| pebble | 1.03 | 0.00 | 0.00 | 0.00 | 0.00 | 1.03 | 1.03 |
| all | 3.22 | 0.04 | 0.05 | 0.02 | 0.02 | 3.14 | 3.11 |

### Camera pass, slots for the K heaviest copies of each mesh

Camera, groups of 64:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K=2 | 32 | 3781 | 0.03 | 0.02 | 0.01 | 3.17 | 3.16 |
| K=4 | 64 | 6681 | 0.03 | 0.04 | 0.02 | 3.15 | 3.13 |
| K=8 | 128 | 11268 | 0.04 | 0.07 | 0.04 | 3.12 | 3.08 |
| K=16 | 246 | 15343 | 0.04 | 0.09 | 0.05 | 3.09 | 3.04 |
| all | 27622 | 15343 | 0.04 | 0.09 | 0.05 | 3.09 | 3.04 |

Camera, groups of 128:

| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K=2 | 32 | 1897 | 0.03 | 0.01 | 0.00 | 3.18 | 3.18 |
| K=4 | 64 | 3347 | 0.03 | 0.02 | 0.01 | 3.17 | 3.16 |
| K=8 | 128 | 5641 | 0.04 | 0.04 | 0.02 | 3.15 | 3.13 |
| K=16 | 246 | 7679 | 0.04 | 0.05 | 0.02 | 3.14 | 3.11 |
| all | 27622 | 7679 | 0.04 | 0.05 | 0.02 | 3.14 | 3.11 |

### Camera pass totals, each choice of slot copies (hidden: full-depth pyramid; D-40 occluders in brackets)

Groups of 64:

| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |
| --- | --- | --- | --- | --- | --- |
| all | 3.22 | 3.16 (3.16) | 3.09 | 3.04 (3.04) | 2.97 (2.98) |
| K2 | 3.22 | 3.16 (3.16) | 3.17 | 3.16 (3.16) | 3.10 (3.10) |
| K4 | 3.22 | 3.16 (3.16) | 3.15 | 3.13 (3.13) | 3.06 (3.07) |
| K8 | 3.22 | 3.16 (3.16) | 3.12 | 3.08 (3.08) | 3.01 (3.02) |
| K16 | 3.22 | 3.16 (3.16) | 3.09 | 3.04 (3.04) | 2.97 (2.98) |

Groups of 128:

| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |
| --- | --- | --- | --- | --- | --- |
| all | 3.22 | 3.16 (3.16) | 3.14 | 3.11 (3.11) | 3.04 (3.05) |
| K2 | 3.22 | 3.16 (3.16) | 3.18 | 3.18 (3.18) | 3.11 (3.12) |
| K4 | 3.22 | 3.16 (3.16) | 3.17 | 3.16 (3.16) | 3.09 (3.10) |
| K8 | 3.22 | 3.16 (3.16) | 3.15 | 3.13 (3.13) | 3.07 (3.07) |
| K16 | 3.22 | 3.16 (3.16) | 3.14 | 3.11 (3.11) | 3.04 (3.05) |

### Shadow cascades (casters: whole levels now; groups: box planes only)

| Cascade | Texel (m) | Now | Off box, 64 | Off box, 128 | K=2, 64 | K=4, 64 | K=8, 64 | K=16, 64 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.019 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| 1 | 0.045 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| 2 | 0.156 | 3.60 | 0.24 | 0.23 | 0.05 | 0.12 | 0.22 | 0.24 |
| per frame (far cascades every 3 frames) | | 1.20 | 0.08 | 0.08 | 0.02 | 0.04 | 0.07 | 0.08 |

Shadow casters per kind, all cascades per frame:

| Kind | Now | Off box, 64 |
| --- | --- | --- |
| column | 0.09 | 0.00 |
| arch | 0.38 | 0.08 |
| boulder | 0.35 | 0.00 |
| pebble | 0.38 | 0.00 |

### Occlusion at each grain, camera pass

| Kind | Copies in view | Copies hidden (full / D-40) | Triangles now | Hidden as copies (full / D-40) | Hidden as copies or pieces (full) | Groups that pass view and facing (64) | Of them hidden (full / D-40) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| column | 288 | 0 / 0 | 0.32 | 0.00 / 0.00 | 0.00 | 0 | - / - |
| arch | 38 | 0 / 0 | 0.98 | 0.00 / 0.00 | 0.00 | 13252 | 6% / 6% |
| boulder | 1666 | 9 / 7 | 0.91 | 0.00 / 0.00 | 0.00 | 45 | 2% / 2% |
| pebble | 25630 | 1649 / 1445 | 1.03 | 0.07 / 0.06 | 0.07 | 0 | - / - |
| all | 27622 | 1658 (6%) / 1452 (5%) | 3.22 | 0.07 (2%) / 0.06 (2%) | 0.07 (2%) | 13298 | 6% / 6% |

D-40 occluders (copies spanning at least a sixteenth of the screen): 30 copies, 0.82 M triangles in the occluders' depth pass, plus the ground. Share of the screen covered: 75%.

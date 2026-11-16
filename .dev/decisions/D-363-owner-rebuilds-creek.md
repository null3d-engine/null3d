# D-363: The owner rebuilds Creek from the ground up

Status: decided by the owner; no work is built on the present Creek scene. Task: M3-V11.

Summary: The owner ruled, in their words: "i'm going to redo creek from the ground up so leave it for
now". The settled rows stand as the present scene's record, and no further cost work is done on it.
The five open tasks keep their rows as stated limits until the rebuilt scene replaces them.

## Question

Creek's settled rows read 704.8 to 796.6 ms from Medium to Ultra. The ceilings are 90.8, 67.1 and
99.0, so the scene runs 7.8 to 11 times over them. Four levers are measured on the present
scene: a tree triangle cap, a wasted depth pass, an occlusion governor step and a masked-card
prepass. The best moves a quarter of the frame, and none closes a row. May its cost work stop?

## Rule

The scene is rebuilt rather than tuned. Its present rows stay in the record as what the present scene
costs, and they are not chased further. A rebuilt scene earns its own rows when it exists.

## Data

| Measure | Figure |
| --- | ---: |
| Creek Medium, settled, two loads | 704.8 and 796.0 ms |
| Creek High, settled, two loads | 697.3 and 729.9 ms |
| Creek Ultra, settled, two loads | 796.6 and 795.2 ms |
| Ceilings at Medium, High, Ultra | 90.8, 67.1, 99.0 ms |
| Best lever measured, the masked-card prepass | 527.0 ms at High, 24 to 28 per cent off |

How the data was produced: the vegetation plan on the iPad Pro 13, in Safari 26.6.1. Each page held
its camera, waited ninety seconds and measured three windows, at the heads the row files name.

## Look

The rebuilt scene sets its own look. Nothing here changes the present one.

## Decision

The owner rebuilds Creek from the ground up. The present scene's rows stay as a stated limit, and its
levers stay recorded as measured and insufficient.

## Consequences

The five open tasks are read against the recorded rows. The governor's occlusion step lands as engine
work on its own merit. The masked-card prepass lands on the same footing, at `8bfdd94dc`. Neither is pursued further as a Creek cost.

# D-315: a species' envelope and all-round band are measured from its reference turning video

Status: decided. Built: the fitting tool, `bun run plants:fit`, and the measured figures of the ten first species in `packages/vegetation/src/species/<id>/fit.ts`. Task: none.

Summary: a committed tool measures each species' envelope as the visual hull of 32 views of its whole-plant turning video. It also measures the video's own crown-box spread and checks the leaf contour against slot 24. On the oak's first video it repeats the grower's test envelope: the same crown base, and outlines that overlap by 0.961 or more.

## Question

A self-organizing plant grows inside an envelope measured from its reference turntable, and its all-round test widens its band to the reference's own crown-box spread. The grower's oak envelope came from scratch scripts. How does a committed tool measure both for any species, and how does it say when a reference is too poor to measure?

## Rule

- The tool reads only the reference files in use: those that the species folder's INDEX.md does not mark superseded.
- It repeats the oak envelope that the grower's tests hold, from the same video, before it measures any other species.
- The crown-box spread is the one that `bun run plants:review` prints beside a render, from the same frames and measures.
- A reference that cannot give a sound figure is named, with the reason, beside its figures.

## Data

The oak's envelope from `oak-turntable.mp4`, the video the grower's test envelope came from:

| Measure | Grower's scratch scripts | The tool |
| --- | --- | --- |
| Crown base, share of the height | 0.115 | 0.115 |
| Envelope outlines against the views, lowest to highest | 0.72 to 0.89 | 0.72 to 0.92 |
| Envelope outlines against the views, mean | 0.850 | 0.859 |
| Overlap of the two envelopes' outlines, 32 turns | not measured | 0.961 at the lowest, mean 0.968 |

The ten first species, from their in-use turning videos. "Own views" is how far the envelope's outlines overlap the views it came from. "Closing" is how far a full turn's last frame overlaps its first. The spreads are the crown box's, largest less smallest over the mean:

| Species | Video | Own views, lowest to highest (mean) | Closing | Crown base | Aspect | Spread, width and height | Band | Poor reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pedunculate oak | `oak-turntable-b.mp4` | 0.77 to 0.85 (0.81) | 0.90 | 0.115 | 1.53 | 28 and 6 per cent | 0.29 | none |
| European beech | `european-beech-turntable-d.mp4` | 0.78 to 0.94 (0.85) | 0.98 | 0.031 | 1.28 | 38 and 2 | 0.39 | none |
| Silver birch | `birch-turntable-c.mp4` | 0.67 to 0.87 (0.76) | 0.94 | 0.219 | 0.48 | 49 and 7 | 0.49 | none |
| Common alder | `common-alder-turntable-c.mp4` | 0.60 to 0.82 (0.77) | 0.90 | 0 | 1.13 | 95 and 33 | 0.95 | Its height in the frame changes by 32 per cent: the trunk fades into the river's haze below the horizon, so most views show the crown alone |
| Weeping willow | `willow-turntable-b.mp4` | 0.80 to 0.93 (0.86) | 0.95 | 0 | 1.26 | 24 and 1 | 0.25 | none |
| Hawthorn | `hawthorn-turntable-halfturn-b.mp4` | 0.81 to 0.88 (0.84) | half turn | 0.031 | 1.61 | 14 and 6 | 0.25 | none |
| Hosta | `hosta-turntable-halfturn-b.mp4` | 0.82 to 0.87 (0.85) | half turn | 0 | 1.5 | 6 and 7 | 0.25 | none |
| Pendulous sedge | `sedge-turntable-e.mp4` | 0.65 to 0.79 (0.73) | 0.66 | 0.01 | 1.42 | 23 and 3 | 0.25 | The tuft changes shape over the turn |
| Meadow grass | `grass-turntable-c.mp4` | 0.50 to 0.77 (0.58) | 0.69 | 0.063 | 0.7 | 36 and 2 | 0.37 | The tuft changes shape over the turn, and its open flower heads are a poor match for a hull |
| Bracken | `bracken-turntable-halfturn.mp4` | 0.65 to 0.81 (0.72) | half turn | 0 | 2.5 | 14 and 7 | 0.25 | A colony of separate fronds, which a hull fills between |

The leaf contour of slot 24 covers its leaf with an overlap of 0.97 to 0.998 in nine species. The oak's shipped contour covers the current file with 0.978. The bracken's slot 24 is a whole divided frond blade, which a contour of 64 points covers with only 0.57. Its frond builder must take the blade's shape from its texture's alpha, not from one contour.

How the data was produced: `bun run plants:fit <ten ids> --sheet <dir> --report <file>` with `NULL3D_PLANT_REFERENCES` naming the corpus, on an Apple M-series Mac. Each species takes 10 to 40 seconds. The oak figures come from `tools/plant-fit/plant-fit.test.ts`, which runs when the corpus is present.

## Look

The envelope sets the grown plant's silhouette, so a better envelope is a better-looking plant. Three faults in the masks bent the envelope, and each is fixed where the review tool shares the fix:

- A river or a far bank along the horizon joined the willow's and the alder's crowns, and a strip of distant field joined the oak's. The review tool's mask now clears a band that reaches both sides of the frame, and a thin strip that reaches one side.
- A strip of grass at the willow's foot pulled its trunk's column toward one side in every view. Its envelope came out lopsided: 0.52 to 0.73 against its views. Thin runs along the foot are now dropped before the foot is found, which gives 0.78 to 0.92.
- A stemless plant has no trunk to find. Low leaves and the soil's shadow pulled the hosta's foot a different way in each view. The camera turns round the plant's axis, so the axis is one column for the whole video, the median of the views' feet.

## Decision

- **The tool** is `tools/plant-fit/`. It reads each frame through the review tool's mask, measures and camera solve (`tools/lib/plant-review/`), and the texture tool's leaf framing and contour (`tools/plant-textures/`).
- **The views.** 32 views over a full turn, one every 11.25 degrees, or 16 over a half turn. A half turn bounds every azimuth, since each view bounds both sides. The video turns at a steady rate from its first frame to its last, which stands at the end of its arc. In every video the last frames' outlines come closer to the first frame's until the last, with no earlier peak.
- **The outline.** Each view's plant is scaled to its own height with the axis on the middle column, 96 cells over the height. In the lowest fifth a pixel stays only where the outline runs three cells' height up or down through it.
- **The hull.** At each height, a view at turn θ bounds the radius at azimuth φ by its right extent over cos(φ + θ). Where that cosine is negative, the bound is its left extent over −cos(φ + θ). The radius is the bound past the smallest 7 per cent: the third smallest of 32. It passes over the few views where a generated plant drifts. This is the support function of the crown's section per azimuth and per height band.
- **The crown base** is the median over the views of one row per view. That row is the lowest of the run of rows wider than 0.2 heights that holds the view's widest row. Up to two narrow rows do not break the run. A trunk's flared foot below a bare stem is not crown. A tuft, or a crown that sweeps to the ground, runs wide to the ground.
- **The envelope** holds 15 heights from the crown's base to the top, 16 azimuths each, smoothed over neighbouring azimuths by 1/4, 1/2, 1/4. On a plant with a stem, the lowest height takes 85 per cent of the next one's radii, since the crown's start varies between views.
- **The crown box** is the review tool's, at the rubric's eight angles that the video reaches. The all-round band is the form's band, or the reference's own spread where it is wider, rounded up to a hundredth.
- **The leaf check** frames slot 24 as the texture tool does. It checks that the picture holds one leaf on a transparent ground. The 24 to 64-point contour, and the shipped manifest's contour, must cover the leaf with an overlap of at least 0.95. It also checks that the shipped textures came from the file in use.
- **A poor reference** is named, with its reason, in five cases:
  - fewer than three quarters of the views show the whole plant;
  - a full turn's last frame overlaps its first by less than 0.8;
  - the envelope's outlines overlap its own views by less than 0.75 on average;
  - the plant's height in the frame changes by more than 15 per cent over the turn;
  - the camera looks down on the plant by more than 20 degrees.
- **The figures** go to `packages/vegetation/src/species/<id>/fit.ts`, which the species' package imports: `envelope`, `crownBox`, `roundBand`, `aspect`, `crownBase`, `consistency` and `problems`. Git keeps the file, as [D-105](D-105-generated-files-out-of-git.md) allows, because measuring needs the private references.

Rejected:

- **A least-squares fit of the extents** in place of the hull. The grower's scratch scripts tried it on the oak: it raised the worst view to 0.76 but lowered the mean from 0.850 to 0.835.
- **The grower's color thresholds for the mask.** They suit the oak's gray sky and grass only. The review tool's mask fits the sky and the ground from the frame's border, so it serves every species. The review then measures the same outlines.
- **Searching the video for the frame that closes the turn.** No video showed an earlier best match than its last frame, so the search measured only the drift.
- **Keeping only the trunk's column below 0.08 of the height**, as the scratch scripts did. It cut the foot of every tuft. The crown base rule above leaves a tree's flared foot out without it.

## Consequences

- `bun run plants:fit <ids>` writes each species' `fit.ts`; `--sheet` writes a contact sheet of every view with its mask and its outline against the envelope's.
- A species' record takes `envelope` and `roundBand` from its `fit.ts`, and names its `problems` in its review.
- The review tool reads a row's "Superseded by" in any cell of INDEX.md, not only the second. 104 rows in fourteen folders mark a remake in the third cell, the alder's and the beech's turning videos among them.

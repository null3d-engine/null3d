# Plant references

A species is built against a reference set: pictures and turning videos of one real plant.
The set lives in `null3d-engine/plant-references`.
The review tool draws the engine's plant as each reference's camera saw it, then measures the pair.
This guide says which measure answers which question and what each measure cannot see. It also gives
the order to work in, so a species converges without repeating a failure.

`bun run plants:review <species>` draws the run and prints its summary. `bun run plants:fit <species>`
measures the envelope and the proportions from the turning videos.

The tool looks for the reference folders in a folder that git ignores, so give it the store:
`NULL3D_PLANT_REFERENCES=<store>/generated bun run plants:review <species>`. Without that, a run that
asks only for stills draws nothing and says so, and a run that names its own views draws those views
with no comparison.

## Three measures, and what each is for

| Measure | What it compares | When it is available |
| --- | --- | --- |
| Outline | Both pictures' plant outlines, scaled to the same height and centered on the trunk: shape IoU, width error, sky gap, crown box | Both pictures separate the plant from a plain background |
| Surface color | The CIEDE2000 difference of the middle of each picture | Always, and it is the figure for a texture source |
| Edge directions | The share of edge strength in each of twelve 15-degree directions over the whole frame | Always |

The outline is the strongest measure, and the shape rows rest on it. It needs a plain background in
the reference. The tool separates the plant by color against a backdrop fitted to the picture's
border. 15 of the 28 stills of the oak give one.

A fruit view is drawn with an outline whatever its photograph does, because a part that hangs from
nothing has a sound outline and shows only as a separate piece. Its outline gives the piece count;
the photograph's own share of the figure follows the rules above.

The surface color answers the material rows: bark, leaf faces, and the texture sources that the
atlas is built from. About 2 steps is a visible difference.

The edge directions answer the pictures whose backdrop cannot be separated: a trunk against a
woodland, a limb against blurred foliage. The figure is the share of edge strength that points a different way.
So 0 means both pictures mix their directions alike, and 1 means they share none.
A ridge and its mirror are one direction to this measure, which suits a branching structure. It says
how much of the frame runs level, upright or at each angle.
It cannot say whether a branch is in the right place. Use it to catch a picture that is built
differently, then judge placement by eye.

## The order to work in

Most faults that cost the oak rounds were in the comparison, not in its data. Check these in order
before you change a figure.

1. **Framing.** Does the render stand where the reference's camera stood? A clipped crown or a plant
   pushed off center makes the outline measures lower bounds, not measures. The anchor is the trunk's
   column at the plant's foot; a low limb that sweeps in and touches the trunk there will drag it.
2. **Content.** Is the render a picture of the same thing? A junction view that draws leaves cannot be
   compared with a reference of bare wood. A texture source is a flat swatch, not a plant, and gets a
   surface figure rather than an outline.
3. **Light.** Does the light follow the camera on a turned or orbited view? A light fixed to one world
   direction leaves every other side dark, and any figure measured there is a figure about the light.
4. **Then the data.** Only now change the record. Every figure that moves gets written down with the
   change that moved it.

## What a figure means

- **Shape IoU**: 0.75 and above is a close match of the whole outline. Below 0.5, look for a fault in
  framing or content before you look at the plant.
- **Width error**: the mean difference of the outline's width at each height, in plant heights.
- **Sky gap**: the share of the plant's box that is sky. The reviewer's band is 0.05 either way.
- **Crown box spread over a turn**: the change in the box's width and height as the plant turns. The
  band is 25 per cent, or the reference's own spread where that is wider.
- **Surface color**: CIEDE2000. About 2 is one visible step.
- **Edge directions**: 1 minus the shared share of the two profiles. Compare species against species,
  and a species against itself over time; there is no absolute pass mark.

## A turning video

A turn gives the crown's spread, the alignment of the render's turn to the video's, and a width
profile at each angle. The alignment assumes that the video turns at a steady rate over its arc.
A video that speeds up or stops short then aligns poorly, and no engine change can mend that.

The shape IoU printed for a turn is the mean over the matched frames. Matching a render frame to a
video frame compares outlines shrunk four times each way, and that score picks the pairing only: it
reads well above the frame-to-frame figure on a speckled crown, so it is not quoted as a plant
figure and is not reported.

## What the tool cannot see

- A reference whose subject touches the frame's border. The backdrop is fitted to the border ring.
  A trunk or limb that runs out of the frame is part of that ring. The fit then fails and the picture
  gets edge directions instead of an outline. A robust fit that drops the subject's own pixels was
  tried and produced a mask covering a sixth of a frame that was mostly wood, so it was withdrawn.
- A close-up whose reference is framed much closer than the render's view. Leaf size, twig thickness
  and clump size cannot be compared across two framings. Where the two framings differ, judge by eye
  and say so.
- Anything the reference does not show. An acorn judged at a whole-plant framing needs to show at that
  framing, not only in a close-up.

## The per-species loop

1. Fit the envelope and the proportions from the turning videos.
2. Read the species' `INDEX.md` and `FACTS.md` so you know what each picture shows.
3. Start the record from the nearest species that already passes, and change every figure a
   reference contradicts. Never copy a figure without a picture or a measurement behind it.
4. Run the review. Work the rows in the reviewer's own order.
5. Keep a state file for the species: every accepted figure, and every rejected route with the
   figure that rejected it. A route that is not written down gets tried again.

## Targets for the generator

`bun run plants:targets <species...>` measures the figures that decide a plant's shape and writes
them to `tools/lib/plant-review/targets/<species>.json`. The plant generator reads its shape from
that file, so no shape figure is set by hand. The file's type is `SpeciesTargets` in
`tools/plant-targets/schema.ts`. Give the tool the store as the review takes it:
`NULL3D_PLANT_REFERENCES=<store>/generated bun run plants:targets <species>`.

The pictures of one species show different individual plants, since each was made on its own. So
the file keeps them apart:

- **The primary individual** is picture `01` and the whole plant's turning video. Every frame of
  the video is measured at its own angle, and each figure has its range round the plant.
- **The secondary views** are the other whole views numbered up to `18`. They show other
  individuals of the same habit, and match the primary one in form and proportions only.
- **The spread** lists each figure in the primary still, round the turn and in each secondary view.
  It gives the largest distance of a secondary view from the primary still. It also says when the
  primary still stands outside its own video's range. One of the two outlines is then at fault.
- A picture that the species' slot file names as having no separable outline is not measured.
- A frame can lose the plant's foot or its top. Its plant then stands more than 15 per cent taller
  or shorter than the turn's middle height, and the frame is left out.
- Whole views numbered above `18` show other forms, ages and seasons. They are listed apart and join
  no spread.

| Figure | How it is measured | What it cannot see |
| --- | --- | --- |
| Height to width, crown base, crown box | The review's own outline and crown start, on the outline that the fit tool cleans of the ground strip at the foot. The review's outline follows a stem below the horizon to its foot, so the plant's height runs to its root collar. Each view records the horizon's row, the row where the outline ended before the stem was followed, and the foot's row | A picture whose plant leaves the frame or whose background is not plain gives no figure. A tuft or a colony that ends at the horizon above a wide ground has lost its lower part, and gives none. On a trunk as thick as the olive's the review's crown start reads low, and the bare stem is the better figure |
| Stem width, flare, lean, bare stem | The run of plant nearest the foot's column, in the rows below the crown and above the horizon. The stem's width is the narrowest middle width of three bands of those rows. Each row's width is read from the picture at its own size, between the two places where the stem's contrast with the sky falls to half | Below the horizon the ground hides the stem, so those rows are left out. On a short flared bole the lean follows the flare. A tuft's narrow foot reads as a stem. A plant whose foot's run never forks is marked a column, since an outline cannot tell a cactus's stem from a cypress's foliage |
| Breast-height width | The stem's run at 1.3 m, placed by the middle of the fact sheet's stated height | A species with no fact sheet, or one shorter than two breast heights, has none |
| Stems | The runs that rise from the foot at three rows of the bare stem | Foliage that hangs to the foot cannot be told from a stem, so the figure is null there |
| Outline envelope | The reach each side of the foot's column in 16 height bands. The turn gives the largest, the mean and the spread of each band, and the mean by direction | Outlines cannot tell which way a video turns, so the directions run with the frames or against them |
| Lumps on the crown's edge | Rays from the crown's base find the edge. A notch is where the edge falls inside the crown's convex hull by 0.04 of the crown's size, the square root of the hull's area. The lumps are the stretches between notches | Only the lumps on the outline show. A lump in front of the crown or behind it is not counted |
| Sky inside the crown | The review's enclosed gap and crown-box gap, the holes that plant closes on every side, and the gap in each cell of a three by three grid over the crown's box | Sky counts only where it matches the fitted sky's color |
| Limbs at the first fork | Arcs at 1.5, 2 and 2.5 stem widths round the fork each cross the limbs. A count stands when no arc meets foliage and all three agree | Foliage covers the fork in most pictures, so the figure is usually null |
| Cut-branch figures | The piece's pixels that are not leaf green are its wood. The wood is thinned to lines, and the lines give the tips, the wood for each tip, the tips for each area, the share of joints where four or more twigs leave one point, and the kinks for each length | Gray, blue or yellow foliage cannot be parted from the wood by color. Wood behind a leaf is not seen, and two twigs that cross read as one joint |

Lengths are shares of the plant's height, and a piece's lengths are in piece lengths, the longer
side of the piece's box. Every picture is measured at the review's work width.

A figure that a picture cannot give is `null`. Its reason stands in the `missing` list beside it,
and the file's `nulls` list repeats every reason with its path. The `stated` section holds what the
species' `FACTS.md` states. That is the height, the spread, the crown and clear trunk shares, the
leaf size, the leaf arrangement and the habit words. Those are stated, never measured, and a measured figure is
never filled from them. Only breast height uses a stated figure, to place 1.3 m on the picture.

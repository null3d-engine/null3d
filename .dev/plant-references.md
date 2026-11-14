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

## Five measures, and what each is for

| Measure | What it compares | When it is available |
| --- | --- | --- |
| Outline | Both pictures' plant outlines, scaled to the same height and centered on the trunk: shape IoU, width error, sky gap, crown box | Both pictures separate the plant from a plain background |
| Crown balance | The crown's covered area either side of the trunk's column, as a share of the whole crown, in the render and in the reference | Both pictures give an outline, or a matte that separates the crown from the sky |
| Crown foliage share | The share of the crown's own covered area that is foliage rather than wood, in the render and in the reference | The render draws its parts as separate layers, and the reference's crown separates into its foliage and bark colors |
| Surface color | The CIEDE2000 difference of the middle of each picture | Always, and it is the figure for a texture source |
| Edge directions | The share of edge strength in each of twelve 15-degree directions over the whole frame | Always |

The outline is the strongest measure, and the shape rows rest on it. It needs a plain background in
the reference. The tool separates the plant by color against a backdrop fitted to the picture's
border. 15 of the 28 stills of the oak give one.

The crown foliage share answers the question the sky gap cannot: whether the crown's material is
leaves or bare wood. A lace of twigs and a mass of leaves can enclose the same sky, and only this
figure tells them apart. The render's side comes from the parts picture, where the wood and the
foliage are drawn as separate layers; the reference's side comes from the foliage green and bark
brown inside its crown box. It cannot see a crown whose photograph mixes the two colors, such as a
bare winter tree against brown ground, and it says so rather than guess.

The crown balance answers whether the mass sits where the plant's does. The crown's covered area is
read in six horizontal bands, each band split at the trunk's column, and each band's left share is
compared with the reference's at the same height. Six is the review's crown-band granularity: each
band holds thousands of pixels, so one leaf clump cannot set a band. The figure is sensitive to the
band count: the same drawing reads 0.089 at six bands and 0.124 at eight. So a reading within a few
hundredths of the band is a note, not a verdict, and the eye decides there. A whole-crown split is not
enough: a drawing whose fuller left flank is balanced by a limb reaching far out on the right reads an
even split while the eye still sees a lean. It cannot see a lean along the view's own axis, so a plant
that leans toward or away from the camera is judged on the other views.

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

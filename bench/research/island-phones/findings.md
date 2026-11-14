# The Island on phones: what costs, and what to change

Branch `research/island-phones`, from `perf/beat-meshlets` at `746403737`. Date: 2026-11-05.

This study asks why the Island's town view is slow on phones, and what would make it run well
there. It uses the cloud phones' records from the terrain-batching runs, and new measurements on
this Mac with a phone's drawing size forced. It changes no engine default and nothing in the
Island's look. Every change below that alters what a phone shows needs the owner's ruling.

## Summary

- A visitor's phone does not get Medium, the preset of the cloud runs. The engine gives every
  phone Low (a coarse pointer and a screen edge under 600 CSS pixels), on WebGPU on both cloud
  phones, with the quality governor on.
- The cloud runs held Medium at one device pixel per CSS pixel. That is about 0.32 million pixels
  on the Galaxy S25. The phones still took about 100 ms (S25) and 52 to 73 ms (iPhone 17) of GPU
  time a frame. On the S25, the main pass took 83 to 90 ms of that. The shadow maps took 3.5 ms
  and the water's reflection 14 to 15 ms.
- Triangles are not the main cost. About 80% of the frame's triangles at Medium (2.65 M of
  3.26 M) go into the shadow maps, and the S25 draws all its shadow maps in 3.5 ms. The cost is in
  shading the main view's pixels.
- On this Mac, with the phone's drawing size forced, the largest parts of the frame are the far
  tree cards (21% to 49%), the shadows (25% to 54%) and the near tree meshes (10% to 44%). The
  town, the ground, the grass's reach and the water's reflection each cost little.
- The Mac stands in fairly for the iPhone: both are Apple GPUs that draw the same way, and the
  iPhone's GPU time was 15 to 28 times the Mac's on the same drawing. The S25 was 30 to 40 times
  slower than the Mac, and its shadow maps took 3% of its frame where the Mac's take a third to a
  half. So a cost specific to its GPU (an Adreno 830) is likely in the main pass. Only a run on the
  phone can name it, and the new `island-phones` device plan does that.
- The engine's own fallback is not enough. Scaled from the Mac by those ratios, a visitor's S25 at
  Low would take about 50 to 80 ms a frame at its own pixel ratio, and about 40 to 50 ms at the
  lowest render scale that the governor reaches. The iPhone 17 would take about 25 to 55 ms, and
  20 to 36 ms at that scale. These are estimates, not measurements, and the phone plan measures
  them. The scene itself has to get lighter on phones.
- The best levers, by gain per effort: a shorter shadow reach on phones (16% at Low, 43% at
  Medium for 150 m), cards drawn from one atlas view (6% and 24%), no shadow-casting cards (5% and
  27%), and a less frequent or smaller water reflection on phones (5% to 8% on the Mac, up to
  15 ms on the S25). Each of these changes the look, so each needs the owner's call.

## 1. What a phone draws

### The preset and the GPU path

The engine chooses the preset from the device ([chooser.ts](../../../packages/engine/src/quality/chooser.ts)):

- A coarse main pointer with a screen edge under 600 CSS pixels is a phone. A phone starts at Low.
  The Galaxy S25 (384 CSS pixels wide) and the iPhone 17 (402) are both phones.
- A memory reading under 4 GB would lower the preset, but Low is already the floor. The preset
  check after the first frame only lowers, so it cannot raise a phone above Low.
- Core WebGPU allows every preset. Both cloud phones draw on core WebGPU: Chrome 152 on the S25,
  Safari 26.6 on the iPhone 17.
- GPU occlusion culling is off on phones and tablets by D-22, whatever the preset.

The cloud runs named Medium on purpose and capped the pixel ratio at 1. So their figures describe
a drawing that no visitor's phone gets: fewer pixels than a visitor's Low, with the heavier
settings of Medium.

### What each preset turns on for the Island

The Island sets some values itself ([sketch.ts](../../../examples/showcase/island/sketch.ts),
[trees.ts](../../../examples/showcase/island/trees.ts), [land.ts](../../../examples/showcase/island/land.ts),
[sea.ts](../../../examples/showcase/island/sea.ts)). Its demo page also turns moment transparency on.

| Feature | Low (a visitor's phone) | Medium (the cloud runs) |
| --- | --- | --- |
| Highest pixel ratio | 1.5 | 2 |
| Render scale the governor may use | 0.5 to 1 | 0.6 to 1 |
| Anti-aliasing | FXAA | 4x MSAA |
| Sun's shadows | 2 cascades, 1024 texels, 3-texel filter, far cascade every 4th frame | 3 cascades, 2048 texels, 5-texel filter, far cascade every 3rd frame |
| Shadow reach (the Island's own) | 600 m | 600 m |
| A far cascade with a moving caster | Draws every frame (every preset) | Draws every frame |
| Ambient occlusion | None (the preset's scale is 0, though the Island asks for it) | None |
| Contact shadows | None | None on WebGPU |
| Screen-space reflections | None | Quarter size |
| Bounce light | None (the Island turns it off on every preset) | None |
| Volumetric clouds | Flat layer | Flat layer |
| Physical sky | On (the Island turns it on for every preset) | On |
| Fog volume | None | 32 slices |
| Level threshold | 2 pixels | 1 pixel |
| Level fade bands | Off | On |
| Moment transparency (the Island's page) | On | On |
| Water reflection (the Island's own) | Every 2nd frame, half the render size | Every 2nd frame, half size |
| Trees stood, of the plan's | 30% | 55% |
| Tree mesh to card hand-over | 90 m | 130 m |
| Card views baked | 25 | 49 |
| Grass tufts, of the lawns' | 35% | 60% |
| Grass reach | 170 m | 170 m |
| Ground samples and allowed error | 513, 16 pixels | 769, 12 pixels |

The governor lowers the render scale first when frames run long, down to the preset's floor.

## 2. The cloud phones' figures

The terrain-batching runs (commit `fa6e1d3c9`, on `perf/terrain-block-batching`) drew the town view
at Medium, at one pixel per CSS pixel, the render scale at 1 and the governor off. The records give
each pass's GPU time. Medians of each visit's four windows of 3 seconds, five visits each:

| Pass | Galaxy S25 (Adreno 830, Chrome 152) | iPhone 17 (Safari 26.6) |
| --- | --- | --- |
| Whole frame | 91 to 118 ms | 52 to 73 ms |
| Main view (`opaque`) | 83.0 to 90.4 ms | (overlaps, see below) |
| Water reflection (`opaque 1`) | 13.9 to 15.1 ms | (overlaps) |
| Later passes (transparency, post) | 4.8 to 5.2 ms | (overlaps) |
| Shadow cascades 0, 1, 2 | 0.2, 0.8 to 0.9, 2.2 to 2.4 ms | 0.5, 1.3 to 1.8, 5.1 to 7.6 ms |
| Compute | 0.5 ms | 0.1 to 0.2 ms |

- Apple GPUs run passes side by side, so their per-pass times overlap: on the iPhone the main
  pass, the transmission copy and the later passes each read about the whole frame. Read only the
  iPhone's whole frame. The Mac's passes overlap in the same way.
- Both phones were held by the GPU. Their render thread took 0.9 to 2.6 ms a frame.
- The far cascade drew in every frame on both phones, though Medium gives it every third frame.
  The Island has moving casters (grass and shrubs in the wind, and the ground's level morph), and
  every preset redraws a far cascade that a moving caster touches. On the S25 that is about 2.4 ms;
  on the iPhone 5 to 7.6 ms, about a tenth of its frame.

## 3. Measurements on this Mac

### Method

- The page `bench/research/island-phones/pages/island.html` starts the Island as its demo page does
  (moment transparency on) and holds the camera at the cloud runs' town view
  (-92, 36, 360 looking at -92, 26, 200). It forces the canvas to a phone's drawing size at one
  pixel per CSS pixel, holds the render scale, and turns the governor off.
- It labels each object by the part of the scene that made it, from its material and from the step
  of the Island's setup that made it: ground, sea bed, foam, water, town, near trees, shrubs,
  cypresses, far tree cards, shadow-casting cards, grass. It then measures one window of 3 seconds
  with each part hidden, with a whole-scene window before and after it. A part's saving is the
  step's GPU time against the mean of those two windows, which cancels a slow drift. Trial changes
  run the same way, applied for one window and undone after it.
- The script `scripts/run.ts` builds the page for production, holds the quiet-window marker, waits
  for a 1-minute load under 6 before each load, and opens Chrome for Testing 156 in a window parked
  past the screen's edge. The Mac is an M5 Max.
- The frame cap is off (`--uncapped`). With it on, the Mac's GPU lowered its clock on these light
  frames: the GPU time stayed at 4.0 to 4.9 ms whichever part was hidden, so no part's cost showed.
  That first load is kept in `results/mac-capped`, and none of its figures are used here.
- Every load started under a load of 6 and ended at 4.4 to 7.9; the page's own threads raise it.
  The only other session on the Mac did no browser work. Each load's figures are in its result
  file, with its load at both ends.
- Figures differ a lot from one page load to the next: the same Medium view read 2.62 ms in one
  load and 3.54 ms in another, and one load without moment transparency spread from 3.95 to
  8.62 ms. So this study compares parts within one load, and reads differences between loads (a
  preset, a start-time choice) only where they are large.

### Each part's share of the frame

Savings when each part is hidden, as a share of the whole frame in the same load
(`results/mac-uncapped`):

| Load | Whole frame | Far tree cards | Near tree meshes | Grass | Shadows | Water and reflection | Town | Ground |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Medium, 384 x 832 (cloud S25) | 2.62 ms, 3.26 M triangles | 21% | 22% | 0 | 54% | 0 | 0 | 0 |
| Low, 384 x 832 | 1.49 ms, 1.35 M | 35% | 15% | 16% | 36% | 11% | 0 | 0 |
| Low, 576 x 1248 (a visitor's S25) | 2.06 ms, 1.45 M | 42% | 10% | 22% | 25% | 9% | 4% | 0 |
| Low, 576 x 1248, render scale 0.5 | 1.30 ms, 1.31 M | 28% | 11% | 14% | 31% | 9% | 8% | 0 |
| Medium, 768 x 1664 (S25 at Medium's pixel ratio) | 10.61 ms, 3.49 M | 49% | 44% | 4% | 46% | 1% | 8% | 0 |
| High, 1920 x 1080 | 36.1 ms, 9.0 M | 23% | 35% | 7% | 33% | 13% | 5% | 7% |

- The shares overlap. Hiding a tree also takes its shadow away, so the columns do not add to 100%.
- Hiding the ground made the frame slower in most loads (by 4% to 21%): the sea and the sky behind
  it then fill those pixels. The ground itself is cheap.
- The town makes most of the triangles (1.7 to 2.0 M at Medium, mostly in the shadow maps), but
  hiding it saves almost no GPU time.
- The cost follows the pixel count: Medium at 768 x 1664 cost four times Medium at 384 x 832, for
  four times the pixels.
- Live settings stacked one on another saved nothing measurable at phone sizes: no fog volume, no
  screen-space reflections, no level fade bands, the analytic sky. A level threshold of 4 pixels
  saved 32% at 768 x 1664 and nothing at the smaller sizes.

### Trial changes

`results/mac-trials`, each change for one window between whole-scene windows:

| Trial change | Low, 576 x 1248 (whole frame 1.59 ms) | Medium, 384 x 832 (3.54 ms) |
| --- | --- | --- |
| Far tree cards drawn from their nearest atlas view, not three | 6% | 24% |
| No shadow-casting cards (the batch that casts every tree's shadow) | 5% | 27% |
| Shadow reach of 300 m (now 600 m) | 4% | 26% (1.28 M fewer triangles) |
| Shadow reach of 150 m | 16% | 43% (2.09 M fewer triangles) |
| Grass drawn to 80 m (now 170 m) | 0 | 2% |
| Grass casting no shadow | 0 | 0 |
| Water reflection every 4th frame (now every 2nd) | 5% | 7% |
| No water reflection | 8% | 4% |
| No far tree cards and no shadow-casting cards | 32% | 40% |

### Start-time choices

Low at 576 x 1248, two loads of each, in turns: as it ships 1.95 to 2.03 ms, moment transparency
off 1.91 to 1.95 ms, the depth prepass on 1.96 to 2.06 ms. On the Mac neither choice changes the
frame. An Apple GPU removes hidden pixels itself, so the prepass is not expected to help there.
The Adreno GPU differs, so the phone plan times both.

### The Mac as a stand-in

- The iPhone 17's GPU time on the cloud view was 52 to 73 ms. The Mac's on the same drawing was
  2.6 to 3.5 ms, so the iPhone is 15 to 28 times slower. Both are Apple GPUs with the same way of
  drawing. The Mac's shares should hold roughly for the iPhone.
- The S25's frame was about 100 ms, 30 to 40 times the Mac. Its shadow maps took only 3% of its
  frame, where on the Mac shadows are a third to a half. So the S25 spends its time elsewhere in
  the main pass, and the Mac's shares do not describe it.
- Likely causes on the Adreno, each untested: alpha-masked leaves and cards that turn off its
  early depth test for later draws, so hidden pixels are shaded; moment transparency's float
  targets in its tile memory; Medium's MSAA. The phone plan's part-by-part visits and its
  start-time visits answer which.

## 4. What is out of proportion

- **The shadow reach on phones.** The Island casts shadows over 600 m on every preset, so the
  shadow maps take every house and every tree card over most of the island, and the main pass
  filters them. A shorter reach halves the shadow cost on the Mac at Medium. The reach is the
  Island's own value; the presets do not scale it.
- **A far cascade that redraws every frame.** The grass, the shrubs and the ground's level morph
  count as moving casters, so the far cascade never keeps its layer. On phones that costs about 3%
  (S25) to 10% (iPhone 17) of the frame. The rule (`followMovingCasters` on every preset) is the
  engine's, and D-16 holds its reason: a cached far cascade leaves a moving shadow behind its
  caster.
- **The far tree cards.** They are the largest single part at the visitor's Low (28% to 42%). Each
  card blends three atlas views, two textures each, with a cut-out alpha, over large areas of the
  hills. A second batch of the same cards casts every tree's shadow at every distance. The
  impostor add-on already draws a card from one view (`setViews(1)`), but neither the Island nor
  a preset uses it.
- **The water's reflection on the S25.** It took 14 to 15 ms of the S25's frame at Medium, about a
  seventh. The Island draws it at half the render size every second frame. Earlier rulings keep it
  frequent on the Island, against reflection lag (D-288).
- **The pixel count.** The frame cost follows the pixel count at these sizes. A visitor's S25 at
  Low draws 2.25 times the pixels of the cloud runs. The cloud runs' Medium at Medium's own pixel
  ratio of 2 would draw four times them.
- **Not out of proportion.** The town's houses, the ground's blocks, the grass's reach, the fog
  volume, the physical sky, the level fade bands and screen-space reflections (Low has none) each
  cost little or nothing measurable at phone sizes. Ambient occlusion, contact shadows, the bounce
  light and the volumetric clouds draw nothing at Low.

### Which rules to change, and what the Island should scale

- **The device tiers (the chooser).** Phones at Low is right. No change. The cloud runs should
  time Low as visitors get it, as the new plan does, not Medium.
- **D-22.** GPU occlusion culling stays off on phones. Hills hide much of the forest from the town
  view, so culling might save card pixels there, but this study did not measure it, and D-22's
  driver concerns stand. No change proposed.
- **The presets, for the owner's call.** On Low: draw impostor cards from one view (a row in the
  impostor add-on's presets), and a shadow-map level threshold of 2 texels in place of 1. The
  far-cascade rule for moving casters could relax on Low only; that reverses D-16's reason on
  phones, so it is the owner's ruling.
- **The Island.** The shadow reach, the shadow-casting cards, the reflection's size and cadence,
  and the far cards' reach are the Island's own values. They should scale by preset, as its trees,
  ground and card views already do.

## 5. Proposed changes, by gain per effort

Savings are from the Mac at a visitor's Low (576 x 1248) and at the cloud runs' Medium. They
overlap, so they do not add. Every item changes what a phone shows, so every item needs the
owner's call before it lands.

| # | Change | Where | Effort | Saving on the Mac, Low / Medium | Owner's call |
| --- | --- | --- | --- | --- | --- |
| 1 | Shadow reach on Low of about 150 to 250 m, not 600 m | The Island's shadow reach, per preset | A few lines | 4% to 16% / 26% to 43% | Yes: far shadows end nearer, and high views lose shadows on far hills |
| 2 | Far tree cards drawn from one atlas view on Low | The impostor add-on's preset row, or the Island | A few lines | 6% / 24% | Yes: a card's look can jump as the camera turns |
| 3 | No shadow-casting cards past the shadow reach, or none on Low | The Island's trees | Small | 5% / 27% | Yes: the cards' shadows were added so near and far trees cast alike (D-288) |
| 4 | Water reflection on phones at a quarter of the render size, or every 4th frame | The Island's sea | One line | 5% to 8% / 4% to 7% on the Mac; up to 15 ms on the S25 | Yes: the reflection softens, or lags (D-288's ruling) |
| 5 | A lower pixel ratio on phones, such as 1.25 for Low | The preset table | One line | About the share of pixels: 30% fewer pixels at 1.25 than 1.5 | Yes: an engine default |
| 6 | Fewer or nearer far cards on Low (the far canopy reaches 6000 m) | The Island's trees | Small | Up to 32% / 40% with none | Yes: the far forest thins |
| 7 | Moment transparency off, or the depth prepass on, for phones | The demo page, or the preset table | One line each | 0 on the Mac; unknown on the S25 | Wait for the phone plan |
| 8 | The far cascade keeps its turns on Low despite moving casters | The preset table | One line | About 3% (S25) to 10% (iPhone 17) | Yes: reverses D-16 on phones |

- Items 1 to 4 together, at a visitor's Low, would save roughly 25% to 30% on the Mac, and so on
  the iPhone. Scaled from the Mac, a visitor's iPhone 17 would then take about 18 to 40 ms a frame
  at full render scale, and less where the governor lowers the scale.
- The S25 needs its own diagnosis first. Its main pass is the cost, and the Mac does not show what
  in it. The phone plan's part-by-part visits on the S25 decide between items 2, 3, 6 and 7.

## 6. The device plan

The `island-phones` plan of the device runner runs this study's page on a phone
([Device sessions](../../../.dev/devices.md#the-island-phones-plan)). By the repository's rules the
landing session runs BrowserStack, so this study did not start a cloud session.

Run it on both cloud phones:

```
bun run devices:cloud --only bsgalaxys25-chrome,bsiphone17-safari --plan island-phones
```

The runner builds the page for production into `target/island-phones` and serves it under the
load route. Its visits, in order:

1. `cloud-medium-1`: the cloud runs' Medium at one pixel per CSS pixel, three windows. It brackets
   this run against the terrain-batching figures (about 100 ms on the S25, 52 to 73 ms on the
   iPhone).
2. `visitor`: the engine's own preset at the phone's own pixel ratio, with the governor on. This is
   what a visitor sees: the "before" figure.
3. `low-parts`: Low at the phone's pixel ratio, each part hidden in turn (town, near trees, far
   cards and their casters, grass, ground, reflection, shadows), with whole-scene windows between.
   On the S25 this names what its main pass spends.
4. `low-trials`: Low with each trial change in turn: one-view cards, no casting cards, shadow
   reach 300 m and 150 m, the reflection every 4th frame, a level threshold of 4. These are the
   "after" figures of items 1 to 4, taken in the same visit as their "before".
5. `low-start-1`, `low-mt0`, `low-prepass1`, `low-start-2`: Low's start-time choices in turns.
6. `cloud-medium-2`: the bracket again.

How to read it:

- Use the S25's per-pass times. Use only the iPhone's whole-frame time.
- Compare a part's window with the whole-scene windows on either side of it, as `scripts/summary.py`
  does. Compare start-time visits only with each other, and only against the spread of the two
  as-it-ships visits.
- The bracket visits must agree within the change that a row claims, or the run's figures are in
  doubt. The cloud gives no reading of the phones' heat, and the cloud S25 shows 30 Hz.
- After the owner rules on items 1 to 8, build the chosen changes on a branch and run the plan
  again there. The `visitor` visits of the two runs give the before and after of a visitor's
  phone, and each run's bracket says whether the two runs compare.

The plan takes about an hour per phone. Record each run in the tested-devices folders, as the
terrain-batching run did.

## Files

- `pages/`: the page and its sketch.
- `scripts/run.ts`: runs a plan of loads on the Mac. `scripts/summary.py` and `scripts/show.py`
  read the results. `scripts/make-plan.py` and `scripts/make-trials.py` write the plans.
- `plans/`: the plans that the Mac ran.
- `results/mac-uncapped`, `results/mac-trials`: the figures above. `results/mac-capped`: the first
  load, with the frame cap on, which the clock fault spoiled.

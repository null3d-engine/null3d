# D-323: The Island lightens its drawing on a phone

Status: decided by the owner. Built: the Low preset's fixed shadow range, its cards drawn from one atlas view, and its water reflection every fourth frame. Measured: both sides on the M3 Max, two loads each, in [the data](#data). Pending: the pictures and the cloud phones. Task: none.

Summary: A phone draws the Island at Low, where the shadow maps and the far tree cards take most of the frame. On Low the sun's shadows reach 250 m and no longer stretch with the camera. Every card draws from one atlas view, and the water's reflection draws every fourth frame. Two loads each side at 576 x 1248 on the M3 Max put the frame at 2.66 ms before and 2.32 ms after. The after side is faster by 0.34 ms, or 12.7 per cent.

## Question

The Island's town view is the scene's slowest view on a phone, and the engine gives every phone the Low preset. Which of the Island's own settings should change on Low? A phone must still draw the view well, without losing the look that the scene is for.

## Rule

Hard rule 40: when options differ in how the result looks, the better-looking one wins. A cost that another rule limits is met by a preset or a cheaper technique of the same look, never by dropping the look. The scene therefore changes only on Low, and the desktop presets keep the look they have.

The owner approved four changes for the Island's Low preset. They are a shorter shadow reach, cards drawn from one atlas view, shadow-casting cards limited by distance, and a smaller or slower water reflection.

## Data

Two loads of each side, on an Apple M3 Max, in Chrome for Testing 156.0.8078.80 with the frame cap off. The page holds the camera at the cloud runs' town view and draws Low at 576 x 1248, one device pixel per CSS pixel. Each load ran alone, with the quiet-window marker held. The loads opened at a 1-minute load of 4.6 to 5.9 and closed at 4.1 to 5.1.

The whole-scene windows give the comparison:

| Side | Loads | Base windows | GPU mean | Range |
| --- | --- | --- | --- | --- |
| Before | 2 | 12 | 2.659 ms | 2.579 to 2.772 ms |
| After | 2 | 6 | 2.322 ms | 2.273 to 2.366 ms |

The after side is faster by 0.337 ms, or 12.7 per cent. Median triangles fall from 1,887,655 to 1,431,774, and median draw calls from 2553.5 to 2157.

The first before load also gives the saving of each change on its own. A trial's saving is its step against the mean of the whole-scene windows around it:

| Change | GPU time | Saving against the windows around it |
| --- | --- | --- |
| Whole scene, six windows | 2.58 to 2.76 ms | mean 2.67 ms |
| Far cards from one atlas view | 2.64 ms | 1.5 per cent, inside the load's spread |
| Shadow-casting cards hidden | 2.71 ms | none, inside the load's spread |
| Shadow reach of 300 m | 2.50 ms | 4.0 per cent |
| Shadow reach of 150 m | 2.30 ms | 14.0 per cent |
| Reflection every fourth frame | 2.50 ms | 8.3 per cent |

The trials overlap, so their savings do not add. The whole frame's triangles move between windows because the shadow cascades draw in turns. The study's own figures from its earlier Mac are in `bench/research/island-phones/findings.md`, and none of them compares with these.

How the data was produced: `bun bench/research/island-phones/scripts/run.ts` ran the page with `preset=low&w=576&h=1248` and the frame cap off. The before steps were `base,try:cards1,base,casters,base,try:shadow300,base,try:shadow150,base,try:reflect4,base`. The after steps were `base,casters,base,cards,base`.

The pictures and the cloud phones are not measured yet.

## Look

The pictures are not drawn yet. At Low the opening view now ends the shadows nearer, so the far hills lose theirs, as the owner accepted. The town keeps its shadows from the views a phone shows.

## Decision

- Low keeps the sun's shadows at 250 m and passes no `shadowReach`, so the range does not grow as the camera draws back. A reach of 150 m saves more, but rule 40 takes the better look: 250 m covers the town from the cloud runs' view. Medium and above keep the stretchable range of 600 m.
- On Low every card batch draws from one atlas view: the near cards, the shadow-casting cards and the far canopy. The saving is inside this load's spread, and the card's cost grows with the area it covers, which the study measured at larger drawings. The owner approved it.
- The shadow-casting cards keep every tree's shadow and take no draw range. The engine culls each caster against each cascade's frustum (`crates/null3d-render/src/shadows.rs`), so the shorter range already drops the casters past it. The frame's triangles fall with the range in the data above.
- Low draws the water's reflection every fourth frame, Medium every second, and High and Ultra every frame. A quarter-size reflection is not available on Low alone. The water add-on takes one scale for every preset, and High and Ultra keep the half-size reflection that a crisp mast needs.
- The desktop presets do not change.

## Consequences

- `examples/showcase/island/sketch.ts` holds the range, `trees.ts` the card views, and `sea.ts` the cadence. `.dev/examples.md` gives the Low exception to the shadow-range rule.
- The SwiftShader `demo-island` pictures draw Low, so they move and need CI's drawing. The Mac's pictures draw the full look and must not move.
- The cloud phones' rows are owed: the `island-phones` plan, before and after, on the Galaxy S25 and the iPhone 17.

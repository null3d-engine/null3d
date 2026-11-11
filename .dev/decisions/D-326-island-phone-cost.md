# D-326: The Island lightens its drawing on a phone

Status: decided by the owner. Built: the Low preset's fixed shadow range. The one-view cards are not applied: their saving was inside the load's spread. The slower water reflection is not applied. Measured: both sides on the M3 Max, two loads each, in [the data](#data), with the cards change in; both sides on the two cloud phones, in [the cloud phones](#the-cloud-phones), also with it in, and again in one session a side, where the iPhone's whole frame separates the reaches and the S25's cascades do. Pending: the pictures, and the software WebGL2 gap. Task: none.

Owner, 9 November 2026: the better-looking drawing stays. The one-view cards and the slower reflection remain out, the three atlas views and the every-second reflection stay, and the shorter shadow reach is the change that ships. <!-- outside date -->

Summary: A phone draws the Island at Low, where the shadow maps and the far tree cards take most of the frame. On Low the sun's shadows reach 250 m and no longer stretch with the camera. The water's reflection keeps every second frame. A cadence of four still draws a dark sea on the software WebGL2 path, and the held-frame fix is not in this branch. Its trial's saving is forgone. The cards keep their three views, because one view saved 1.5 per cent and the software picture darkens with either change, so the picture is owed whatever this branch keeps. Two loads each side at 576 x 1248 on the M3 Max put the frame at 2.66 ms before and 2.32 ms after with all three changes in. The shorter shadow range is what the branch ships, so the paired figure is smaller and is still owed.

## Question

The Island's town view is the scene's slowest view on a phone, and the engine gives every phone the Low preset. Which of the Island's own settings should change on Low? A phone must still draw the view well, without losing the look that the scene is for.

## Rule

Hard rule 40: when options differ in how the result looks, the better-looking one wins. A cost that another rule limits is met by a preset or a cheaper technique of the same look, never by dropping the look. The scene therefore changes only on Low, and the desktop presets keep the look they have.

The owner approved four changes for the Island's Low preset. They are a shorter shadow reach, cards drawn from one atlas view, shadow-casting cards limited by distance, and a smaller or slower water reflection. The last is not applied: [the look](#look) gives the reason.

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

The trials overlap, so their savings do not add. The reflection's 8.3 per cent is forgone, because that cadence is not applied. The whole frame's triangles move between windows because the shadow cascades draw in turns. The study's own figures from its earlier Mac are in `bench/research/island-phones/findings.md`, and none of them compares with these.

How the data was produced: `bun bench/research/island-phones/scripts/run.ts` ran the page with `preset=low&w=576&h=1248` and the frame cap off. The before steps were `base,try:cards1,base,casters,base,try:shadow300,base,try:shadow150,base,try:reflect4,base`. The after steps were `base,casters,base,cards,base`.

Two later loads drew the shipped code, which carries the range alone. Their whole-scene windows read 2.448 and 2.529 ms in the first, at a 1-minute load of 3.25 that rose to 4.45, and 2.481 and 2.464 ms in the second, at 2.57 rising to 3.92. The four windows give 2.480 ms. A try between them was stopped when the load rose to 8.90. Both loads wrote the file that the runner names by round, so the first load's figures were read before the second overwrote it. The pair is not compared with the before side: it is hours later, and the machine drifted between the day's sessions, as the extra after loads of the earlier comparison did.

The pictures are not measured yet.

## The cloud phones

Both sides ran the `island-phones` plan through BrowserStack Automate, one session at a time. The before run is at `873a5e278` and the after run at `946e84ed7`, and each passed all 10 pages on both phones. The iPhone's run files are [before](../tested-devices/iphone-17-safari/20261105-031435-island-phones.md) and [after](../tested-devices/iphone-17-safari/20261105-034329-island-phones.md). The Galaxy S25's are [before](../tested-devices/galaxy-s25-sm-s931b-chrome/20261105-031435-island-phones.md) and [after](../tested-devices/galaxy-s25-sm-s931b-chrome/20261105-034329-island-phones.md).

The visitor's whole frame, over its three windows with the governor on:

| Side | Galaxy S25, GPU ms | iPhone 17, whole frame ms |
| --- | --- | --- |
| Before | 23.49 to 24.77 | 27.44 to 33.94 |
| After | 22.41 to 22.71 | 21.64 to 27.70 |

The visitor is lower after the change on both phones. The S25's later-window GPU mean falls from 23.53 to 22.46 ms, and the iPhone's from 29.88 to 23.08 ms.

Each run opens and closes with the same Medium visit. The iPhone's bracket agreed within each run, 59.0 against 60.4 ms before and 69.8 against 71.4 ms after. Across the runs it disagreed at 59.7 against 70.4 ms, 18 per cent apart. The after run also drew with Safari 26.5, where the before run had 26.6.

The S25's bracket agreed in neither run. It read 122.6 against 200.3 ms before, 1.63 times, and 111.3 against 128.2 ms after. Its display ran at 30 Hz, so only its per-pass times stand.

The size of the cross-run change is therefore not safe on either phone, and the pairs below replace those brackets. The parts and trials alternate with whole-scene windows inside one visit, so those rows stand. Hiding the far cards was the largest iPhone part saving, 12.53 ms before and 7.44 ms after. Hiding the shadows lifted the S25's main view by 1.59 ms before and 3.56 ms after, and removed both cascades. The water reflection's pass cost 4.52 and 5.39 ms, with the main view taking 3.05 and 1.21 ms back.

The two sides now stand in one session on each phone, so they do not cross sessions ([the S25's runs](../tested-devices/galaxy-s25-sm-s931b-chrome/20261109-104821-island-phones.md) and [the iPhone's](../tested-devices/iphone-17-safari/20261109-105056-island-phones.md)). On the iPhone 17 the shipped Low reads 24.95 to 25.57 ms of whole-frame GPU time across its five whole-scene windows, and the old 600 m reach reads 33.18 and 31.17 ms: the shorter reach is 6.92 ms, or 27.4 per cent, faster. On the Galaxy S25 the whole frame does not separate them, because the run's windows spread 3.6 ms and the two sides overlap, but the two cascade passes do: the three 600 m windows of the second session read 2.556 ms each against 1.835 to 2.097 ms for the warm whole-scene windows, and the longer reach draws 669,084 more triangles. The S25's whole-frame size is still not settled; its cascade figure is.

## Look

The pictures are not drawn yet. At Low the opening view now ends the shadows nearer, so the far hills lose theirs, as the owner accepted. The town keeps its shadows from the views a phone shows.

Low draws the reflection every second frame, the add-on's default; High and Ultra draw it every frame. A slower reflection is not applied. A cadence of four still draws a dark sea on the software WebGL2 path. The held-frame turn fixed the real GPU but darkened that same software picture, so it is not in this branch. Both the cadence and the software-path gap remain, and the trial's 8.3 per cent is forgone, as [the consequences](#consequences) records.

## Decision

- Low keeps the sun's shadows at 250 m and passes no `shadowReach`, so the range does not grow as the camera draws back. A reach of 150 m saves more, but rule 40 takes the better look: 250 m covers the town from the cloud runs' view. Medium and above keep the stretchable range of 600 m.
- On Low every card batch keeps the three nearest atlas views. The change's saving on this Mac was 1.5 per cent, inside the load's spread, so it is dropped and the branch keeps the shorter range alone. The software picture darkens with either change, so the drop is not a cure for that fault; [the consequences](#consequences) record it.
- The shadow-casting cards keep every tree's shadow and take no draw range. The engine culls each caster against each cascade's frustum (`crates/null3d-render/src/shadows.rs`), so the shorter range already drops the casters past it. The frame's triangles fall with the range in the data above.
- Low draws the water's reflection every second frame, the add-on's default, and High and Ultra every frame. A cadence of four is not applied. The software WebGL2 path still draws a dark sea at four. The held-frame turn that fixed the real GPU is not in this branch, because it darkened that same software picture at both cadences. The trial's 8.3 per cent is forgone. A quarter-size reflection is not available on Low alone. The water add-on takes one scale for every preset, and High and Ultra keep the half-size reflection that a crisp mast needs.
- The owner ruled that the S25's saving is the shadow passes' own figure: the two cascade passes read 2.556 ms at 600 m against 1.835 to 2.097 ms at 250 m, where the whole frame's windows spread 3.6 ms and cannot resolve a saving that small. The device's clause is met by that measured saving, not by a whole-frame number the phone cannot show.
- The owner accepted the drawing's look, so a Low picture is its witness rather than a new judgement. It waits on the software WebGL2 fault below, and no reference is accepted from a dark drawing. He was asked in these words: "Does your 9 November look ruling stand as the acceptance, with the picture owed to the fault's fix, which lets the task tick now?" He answered yes, and on the S25 he answered that its saving is the measured figure, so the accepted look and the measured phone saving close the task, with the Low picture owed to M3-R43.
- The High and Ultra clause rests on the guard test rather than a timing row: the change sets a Low-only shadow distance and a Low-only stretchable flag, so the heavier presets keep what they had, and no High or Ultra timing row was taken. The owner accepted that clause too: asked whether the guard test stands in for the High and Ultra pair, he answered that it is ok, so the clause closes on his word with the guard test as its witness.
- The desktop presets do not change.

## Consequences

- `examples/showcase/island/shadow.ts` holds the range, with a test guarding it, and `sea.ts` the cadence. `trees.ts` keeps its three atlas views. `.dev/examples.md` gives the Low exception to the shadow-range rule.
- The SwiftShader `demo-island` pictures draw Low, so they move and need CI's drawing. The Mac's pictures draw the full look and must not move.
- The cloud phones ran the `island-phones` plan, before and after, on the Galaxy S25 and the iPhone 17. Both visitors were lower there, but the runs' brackets disagreed across the sides. The later pairs, one side each inside one session, settle the iPhone's whole frame at 6.92 ms, or 27.4 per cent, and give the S25's cascade saving of 0.61 to 0.69 ms; the S25's whole frame does not resolve.
- The software WebGL2 path keeps a gap. At a cadence of four, the drawn sea is about 40 RGB points darker than at a cadence of two. The means are 57.0 65.3 74.4 against 99.9 112.0 90.4 in the same view. With the held-frame turn in place, the webgpu and webgl2 drawings differ at 30.835 per cent, where the old references agree at 0.217 per cent. The two cadence pictures are byte-identical. The gap is in the software path alone and remains open. `fix/hold-cadence` keeps the attempted fix for a later round.
- A change to the Island's Low drawing darkens the sea on the software WebGL2 picture, and the change's content does not decide it. A branch carrying only the one-view cards drew compat at 3.278 per cent and webgl2 at 29.745 against the old references, and one carrying only the 250 m range drew 4.259 and 30.024, where the bare base drew 3.227 and 3.241. A second run of the same bare base commit then drew webgl2 at 29.845, so the picture is not stable: the first base run was the outlier, and the Island's changes are not the cause. The water alone darkens, by about 41 RGB points in rows 100 to 180, while the sky does not move and the land moves by about one point. On this Mac the same pictures are bright on the real GPU and on SwiftShader, a reflection cadence of sixteen frames keeps the sea bright, and turning the sun's shadows off does not darken it. `.dev/image-tests.md` records the fault. The branch's picture stays owed until the software WebGL2 water is understood, and no reference may be accepted from a dark drawing: its sea would disagree with the other two tiers' by about 30 per cent.
- The cloud phone runs carried all three changes, so their rows describe the trial. The shipped branch loses the cards' share of the saving.

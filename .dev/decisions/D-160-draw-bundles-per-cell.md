# D-160: Draw bundles per grid cell on WebGPU: not built

Status: decided, 13 October 2026. Task: M2-I6.

Summary: The task that would record a draw bundle for each grid cell is closed without the change. After #439 merged S6's towers into one mesh per material, a pass draws about 322 times instead of 1,971. The most that leaving out empty draws could save is then about 1,300 draws a frame. At 40 to 60 ns each that is 0.05 to 0.08 ms, about one step of Chrome's GPU timer, so no benchmark can show it.

## Question

Should the WebGPU path record a draw bundle for each grid cell? A view would then replay only the bundles of the cells it can see. A bucket that lies wholly in a cell out of view would issue no draw. M2-I6 planned this to remove S6's empty indirect draws. The first measurement put those at 82 to 97% of 1,971 draws a pass.

## Rule

M2-I6's rule: S6's empty draws fall by most of their count on WebGPU with identical images. The GPU time saving is measured on the Mac and the iPad. [D-22](D-22-occlusion-presets.md) and design principle 1 add the engine's rule. A technique ships only where it saves more time than it costs, shown by a measurement.

## Data

| Measure | Value | Source |
| --- | --- | --- |
| S6 draws a pass, before #439 | 1,971, of which 82 to 97% were empty | the s6-draws study, 8 October 2026 |
| S6 draws a pass, after #439 | About 322 | [D-106](D-106-s6-city.md) addendum of 8 October 2026, in the commit of #439 |
| Cost of one indexed indirect draw with no instances | 40 to 60 ns | s6-draws: 8,000 such draws took 0.30 to 0.34 ms of GPU time |
| Empty-draw saving measured before #439, every empty draw left out | 0.35 to 0.45 ms of GPU time a frame on the Mac, 6 to 12% of S6 after the lit-shader fix | s6-draws |
| Passes a frame that draw, at S6's Medium preset | 4, each about 322 draws: a shadow cascade, the occluders' pass and the opaque pass | s6-draws |
| Chrome's GPU timer step on the Mac | 0.066 ms | [D-40](D-40-gpu-occlusion.md) |

The ceiling of the saving after #439 is the draws a frame times the cost of one empty draw. S6 draws about 322 times a pass, over 4 passes, so about 1,288 draws a frame. At 40 to 60 ns each that is 0.05 to 0.08 ms, even if every draw were empty. The bound counts the draws that must stay in the shared bundle too, so the real saving is smaller.

Which buckets a cell bundle could skip is narrower still. Only a bucket whose sources all lie in one cell can go in that cell's bundle. In S6 after #439:

- A tower mesh is one object with one source in one cell, so its bucket would reach a cell bundle. There are 200 of them, one for each material, and each mesh spreads over 134 to 760 m ([D-106](D-106-s6-city.md) addendum).
- The kit's 98 models are copied 17,324 times along the route. One kit bucket therefore holds copies in many cells. Such a bucket spans cells and stays in the shared bundle.

So the most a cell bundle can skip is the 200 tower draws a pass, in the frames whose cell is out of view. That is at most 200 x 4 = 800 draws a frame, 0.03 to 0.05 ms even if every one were empty.

The change also does not fit what a shipping asset pipeline produces. #439 and [D-106](D-106-s6-city.md) merge static meshes by material. That is what a city file ships. A merged mesh's bucket spans the cells its boxes cover. So the change would help only a scene of many static meshes. Each would lie in one grid cell and be often out of view. S6 is not that scene now.

How the data was produced: the s6-draws study of 8 October 2026 on the MacBook Pro M5 Max in Chrome 155. It read S6's indirect draw arguments back, and measured empty draws on a micro test page. The addendum of [D-106](D-106-s6-city.md), in the commit of #439, gives S6's merged towers and about 322 draws a pass. [D-40](D-40-gpu-occlusion.md) gives the GPU timer's step. These figures are on main.

## Decision

Not built. The rule needs a measured GPU saving. After #439 the ceiling of the saving is about one step of the browser's GPU timer. The buckets that must stay in the shared bundle make the real saving smaller still. The bundle bookkeeping would also add CPU work. A view would replay many small bundles in place of one, and the render worker replays each bundle itself. The measured gain of 0.35 to 0.45 ms belonged to the 1,971-draw S6, which #439 replaced. So M2-I6 closes with no engine change.

## Consequences

- No code change. The WebGPU path keeps one bundle for each view, and every bucket's draw is replayed each pass.
- The plan's M2-I6 baseline is restated at about 322 draws a pass. Its "Measured gain" and "Done when" are marked out of date.
- The option stays open for a later scene of many static meshes that each lie in one grid cell and are often out of view. The design is unchanged from the breakdown. Record a bucket whose sources all lie in one cell into that cell's bundle, and keep a bucket that spans cells in the shared bundle. A view replays only the visible cells' bundles. The same rule applies: ship it only with a measured gain and identical images.
- Merging meshes by material already cut S6's draws from 1,971 to 322 ([D-106](D-106-s6-city.md)). The remaining empty draws cost 40 to 60 ns each, so making them cheaper is not worth the machinery.

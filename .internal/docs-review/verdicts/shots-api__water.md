# Shot and demo-link verdicts: api/water

The page has no demo links today. Reference pictures live under `tests/image/references/chrome-real-gpu/<tier>/`.

## Shots

| Shot | Keep | Verdict | Corrected source |
| --- | --- | --- | --- |
| water-demo | yes | The picture exists in all three tiers (320x180). It is the tour's first shot: a river with boulders on a green valley floor, going into haze. The lake does not show. Fix the alt text so it does not promise a lake. The picture is small for a page's opening image, so a larger capture of the same view is better. | Reference `tests/image/references/chrome-real-gpu/webgpu/demo-water.png`. For a larger copy, open the water demo with `?hold=1` at a larger size. Alt: "A river with boulders running down a grassy valley under a hazy sky". |
| water-rain | yes | Wrong kind. This is not a scripted shot: a held reference picture already exists in all three tiers (480x270). It shows a lake seen low across the water, with a pale post and a dark stone. The rings are faint at this size. | Reference `tests/image/references/chrome-real-gpu/webgpu/water-rain.png` (test page `tests/pages/sketches/water-rain-sketch.ts?rain`, held at 1 s). Alt: "Raindrop rings on a lake beside a pale post and a dark stone". |
| waterfall | yes | Wrong kind. This is not a scripted shot: a held reference picture already exists in all three tiers (640x360). It shows a creek falling off a block's edge, glassy at the lip, white lower down, with a mist plume at its foot. It is a plain test scene, but it shows every part that the section names. | Reference `tests/image/references/chrome-real-gpu/webgpu/water-fall.png` (test page `tests/pages/sketches/waterfall-sketch.ts`, held at 2 s). Alt: "A creek falling from a cliff's lip in a white column into mist". |
| ocean-demo | yes | The picture exists in all three tiers (320x180). It shows a dark open sea with swell under a cloudy sky. No foam shows, so the alt text must not name it. It is small and dark. | Reference `tests/image/references/chrome-real-gpu/webgpu/demo-ocean.png`. Alt: "An open sea with long swell under a cloudy sky". |
| underwater-split | yes, changed | The steps do not work. The water demo has no switch that places the camera. Its tour crosses the lake's surface in a fraction of a second. The split shows only while the near plane straddles the moving waves, which is a few centimeters, so no fixed moment catches it, and moving the camera by hand cannot place it that exactly. The demo can hold a moment of its tour with `?hold=<seconds>`. At 42 s the tour's sixth shot puts the camera 1.2 m under the lake, looking down the lake's bed. That shows the underwater view (its tint, bend and caustics), which is what the section is about. Make the shot show that view, and leave the split to the text. | Scripted: open the water demo (`examples/water/`) with `?hold=42` and capture the held frame. The tour's sixth shot in `examples/water/valley.ts` starts at 42 s, at position [38, -1.2, 0]. Name: `underwater`. Alt: "The view from under a lake, tinted green-blue, with caustics on the bed". |

## Demo links

| Concept | Code | Keep | Verdict |
| --- | --- | --- | --- |
| Rivers and lakes | `water/` | yes | The code exists in `examples/demos.ts`. Its sketch builds a river, a lake and an outflow stream as a list of shapes in one `createWater` call. That is what "The shape" describes. It also uses `foamMap` and `createUnderwater`. |
| The ocean | `ocean/` | yes | The code exists. Its sketch calls `createOcean`, with three wave bands. |
| Waterfalls | `showcase/creek/` | yes | The code exists. Its sketch calls `createWaterfall`, and the demo's reference picture shows a white fall over the cliff's rim. It is a large showcase, so the link should say that the fall is one part of it. |

## Concepts said to have no demo

| Concept | Has no demo? | Demo that shows it |
| --- | --- | --- |
| `windRipple` on a pool | No, a demo shows it | `showcase/island/`. Its courtyard pools (`poolwater.ts`) set `windRipple: 1` with a wind field and `ripple: 0`, the same setup as the page's example. The pools draw with the add-on only near the camera, so the reader has to zoom in on a garden pool. |
| `foamMap` options | No, a demo shows it | `showcase/creek/`. It passes `origin`, `size`, `width`, `height`, `reach` and `trail`, and gives some stones a `reach` of their own. `water/` passes `origin`, `size`, `width` and `height`. |
| Rain on the surface (added) | Yes, confirmed | None. No demo calls the water's `setRain` or passes `rain`. The rainy city demo's rain is its own effect. Only the `water-rain` test page draws the rings. |

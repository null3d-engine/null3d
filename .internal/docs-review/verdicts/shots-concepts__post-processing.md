# Shot and demo-link verdicts: concepts/post-processing

All reference paths below are under tests/image/references/chrome-real-gpu/webgpu/. Each one was opened and looked at.

## Shots

| Shot | Keep | Verdict | Corrected source |
| --- | --- | --- | --- |
| post-effects-alley | yes | demo-post-effects.png exists and shows the neon alley: bloom on the neon, reflections in the wet ground, a yellow outline on one crate. Depth of field and ambient occlusion are hard to see at 320 x 180. Use an alt text that names only what shows: "Crates in a neon alley at night, with glowing neon, reflections in the wet ground and a yellow outline round one crate". | |
| bloom-off-on | yes | Good shot, and the clearest on the page. But it is not "scripted": bloom-off.png, bloom-soft.png and bloom-strong.png are existing 640 x 360 references of the bloom test sketch (tests/pages/sketches/bloom-sketch.ts). | reference: bloom-off.png, bloom-soft.png, bloom-strong.png in one row |
| bloom-size-presets | no | The steps cannot run. The post-effects demo has no control for the bloom base, and nothing outside the sketch can call quality.set. The page's preset switch (?preset=low) changes much more than the base: on Low, depth of field turns off and reflections shrink, so the pair would not isolate bloom size. The difference (a softer core, same glow size) is also too small to read at demo size. Drop it. | |
| depth-of-field | yes | demo-camera-lens.png exists, but the proposed alt text is wrong. At the held time the focus is on the far king in the middle; the near pawns are blurred, and the string lights behind are soft discs. Alt: "A chess board with the far king sharp, the near pawns blurred and the string lights as soft discs". | reference: demo-camera-lens.png (fix the alt text) |
| auto-exposure | yes | demo-auto-exposure.png exists and shows the hall after adaptation. On its own it looks like an ordinary lit hall, so it does not show what the feature does. A pair is better: the same pose with adaptation off is almost black. The demo's walk follows the clock, so the same time gives the same pose. | scripted: open auto-exposure/ live; capture at the held time (6 s, inside the hall); reload, press E at once (the exposure holds at the sun's), capture at the same time; put "eye held" and "eye adapted" side by side. Or keep demo-auto-exposure.png alone. |
| ao-off-on | yes | ao-off.png and ao-default.png exist (640 x 360). The default occlusion is faint at page width. ao-wide.png (radius 0.8, darker) shows the dark creases under the spheres and behind the boxes much more clearly. These are references, not a scripted run. The sketch is tests/pages/sketches/ao-sketch.ts. | reference: ao-off.png beside ao-wide.png (caption: a wider radius than the default) |
| ssr-wet-street | yes | demo-wet-street.png exists and shows the puddles mirroring windows, signs and the taxi's lights. Alt is right. | |
| bounce-off-on | yes | The proposed pair fails. bounce-off.png and bounce-bounce.png exist, but they look almost the same: the floor shows no visible red or green. The listed source file (examples/bounce-light/sketch.ts) is also wrong; those tests draw tests/pages/sketches/bounce-sketch.ts. The bounce-light demo shows the light strongly (demo-bounce-light.png: the floor turns red and green near the walls). A held frame always shows the light on, so the "off" view needs a live capture. | scripted: "with" = reference demo-bounce-light.png; "without" = open bounce-light/ live, press B once (the cycle starts on, so B turns it off and stops the cycle), wait a few frames, capture without moving the pointer |
| outline | yes | outline-plain.png and outline-hidden.png exist. outline-hidden.png alone already shows the point: yellow round the visible cube, blue where the board hides the sphere. They are references, not a scripted run. | reference: outline-plain.png beside outline-hidden.png (or outline-hidden.png alone) |
| vignette-and-grade | yes | Wrong second file. lens-vignette.png is the lens kit's checker wall, not the grading scene, so the alt "on the same scene" is false. The grading scene has its own vignette reference. | reference: lut-cube.png beside vignette.png (both the grading test scene); lut-vignette.png shows both at once |
| sharpen | yes | sharpen.png exists, but no reference of the same wall without sharpening exists. The sketch draws without sharpening when it has no query, so the unsharpened frame is easy to make. The change is about 10 color steps at each edge, so crop and enlarge or it will not show. | scripted: draw tests/pages/sketches/sharpen-sketch.ts with no query in the image page's hold mode at 320 x 180; crop the same small area of that frame and of sharpen.png; enlarge both 4x with nearest-neighbour scaling; put side by side |
| still-accumulation | yes | still.png exists (the anti-aliasing edges scene, rested). The "moving frame" already exists: the still page draws with anti-aliasing off, which is antialias-none.png of the same scene and size. | reference: crop still.png and antialias-none.png at the same bar or box edge; enlarge 4x with nearest-neighbour scaling; side by side |
| render-scale-half | yes | render-scale-50.png exists. The scale 1 frame also exists: render-scale-100 uses scene.png as its reference (the same boxes sketch). The boxes are small in a 320 x 180 frame, so crop and enlarge. | reference: crop render-scale-50.png and scene.png at the same edge; enlarge 4x with nearest-neighbour scaling; side by side |

General note: every demo reference is 320 x 180. That will look soft at page width. A capture at a larger size from the live demo at the same held time would read better.

## Demo links

| Concept | Code | Keep | Verdict |
| --- | --- | --- | --- |
| The whole chain | post-effects/ | yes | In demos.ts. The sketch turns on bloom, ambient occlusion, outline, depth of field, reflections, vignette, sharpening and a color grade. |
| Depth of field | camera-lens/ | yes | The demo has no code field, so "<name>/" is the right form. The sketch racks the focus between a near pawn and the far king. |
| Automatic exposure | auto-exposure/ | yes | In demos.ts; E turns the adaptation off and on. |
| Screen-space reflections | wet-street/ | yes | In demos.ts; the puddles show the reflections. |
| Screen-space bounce light | bounce-light/ | yes | In demos.ts; the bounce cycles off and on, and B toggles it. |
| Outlines | picking/ | yes | In demos.ts; a click outlines a piece. The outline only shows after a click. post-effects/ shows an outline in its default view too. |
| Volumetric fog | light-shafts/ | yes | In demos.ts; the volumetric fog takes the sun's light. Fog is only a stage of this chain; put the link beside the sentence that sends readers to the lighting page's volumetric fog section, not under the top heading. |

## Concepts said to have no demo

| Concept | Confirmed | Demo that shows it |
| --- | --- | --- |
| custom tone curves | yes | None. Demos set only built-in curves ('agx', 'aces', 'none'). |
| color grading tables | no | compare/night-town/ (also compare/battle/ and compare/factory/) applies a table with assets.lutFromData. post-effects/ cycles none, warm and cool grades from the grading controls, which bake into a table. |
| dithering | yes | None shows it on purpose. The forest's "dither" is a level-of-detail crossfade, a different thing. |
| the 8-bit path's fallbacks | yes | None. tone-mapped/ runs on the 8-bit path, but it shows the tone-mapping opt-out, not the fallbacks. |

Also missed by the proposal: post-effects/ shows sharpening (lens kit, 0.5), the vignette and custom effects (the lens kit's streak reads a level of bloom's chain), so it can also be linked under "Sharpening" and "Color grading and the vignette".

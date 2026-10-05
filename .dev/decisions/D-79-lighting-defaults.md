# D-79: Lighting defaults: the roughness floor, specular anti-aliasing, horizon fading and AgX

Status: decided, 2026-10-05, under the rulings of [D-53](D-53-technique-defaults.md) (4 and 11). AgX's look (plain or punchy) waits for the owner, and the shimmer page's phone runs are pending. Date: 2026-10-05. Task: M2-E7.

## Question

[D-53](D-53-technique-defaults.md) set four defaults for lit materials. Ruling 11 puts specular anti-aliasing on with Filament's kernel. Ruling 4 makes AgX the tone curve of new scenes. The review also asked for three.js r187's roughness floor and for horizon fading. How does each one work in the engine? What do prototypes L3 (shimmer) and L7 (the look test) show? How do the strict tests against three.js keep working?

## Rule

- The best technique is the default, with no three.js mode in the core ([D-52](D-52-intent-parity.md)).
- Specular anti-aliasing passes when it halves shimmer against today's term for under 1% of GPU time (D-53, L3). It stops only if it costs more than it gives on phones.
- Lighting terms and the tone curves that both engines offer keep three.js's strict image rule.

## Data

### Shimmer (prototype L3, Mac only)

`tests/pages/specular-shimmer.html` draws 96 small metal spheres and rings, from 10 to 20 pixels across, with roughness from 0.1 to 0.4 under a grazing sun (`tests/pages/sketches/specular-shimmer-sketch.ts`). It moves the camera about a quarter of a pixel per frame for 48 frames. It draws the same 48 frames again at 4 times the width and height and averages each 4 x 4 square. That averaged row shows each pixel's whole area, so it does not flicker. A pixel's flicker is the mean size of its second difference over time. The shimmer is how much more the canvas's frames flicker than their averaged row, in steps of 1/255 over the whole frame. The error is the mean distance from the averaged row.

Each variant was a build of the lit template: Filament's kernel, three.js's term, and no anti-aliasing. three.js's term adds the mesh normal's largest change across a pixel to roughness. Chrome on the Mac, 5 October 2026:

| Variant | Shimmer, Mac GPU, WebGPU / WebGL2 | Shimmer, SwiftShader, WebGPU / WebGL2 | Error, Mac GPU, WebGPU |
| --- | --- | --- | --- |
| three.js's term (before) | 0.164 / 0.160 | 0.292 / 0.291 | 6.38 |
| Filament's kernel, 0.15 and 0.2 (now) | 0.089 / 0.086 | 0.164 / 0.162 | 3.82 |
| None | 0.035 / 0.033 | 0.059 / 0.062 | 0.59 |

- The kernel cuts shimmer by 44 to 47% against three.js's term on both GPU sets, and halves the error. That is just short of the "halved" target.
- No anti-aliasing flickered least on this scene. Both kernels read the change of the interpolated normal between pixels. On meshes whose triangles are about a pixel across, that change jumps from triangle to triangle. It also jumps from one 2 x 2 block of pixels to the next. So the widened roughness itself flickers. Kaplanyan's kernel assumes a smooth normal across the pixel.
- The kernel costs two square roots and about six other operations per pixel, in place of three.js's term of about five. The difference is far below 1% of a frame. No phone has timed it yet.

### The look test (prototype L7, Mac only)

Five scenes drew on the Mac's GPU under plain AgX, AgX "punchy" and Neutral. They were S4, S5, the sphere grid under the sun and under the built-in room, and the bright tiles of the tone mapping tests. Punchy is Filament's look: power 1.35 and saturation 1.4 after the contrast curve. Plain AgX looks flat and gray: S4's sky and walls lose color. Punchy has the contrast and color that ACES users expect, without ACES's hue shifts. Neutral keeps base colors as authored and clips bright tiles to white sooner. L7 has no numeric rule, so the owner picks.

### three.js r187's floor

three.js r187 floors perceptual roughness at 0.045, Filament's desktop value, in place of 0.0525. [three.js PR #34645](https://github.com/mrdoob/three.js/pull/34645) made the change on 24 September 2026. r187 is due on 21 October 2026. three.js's `dev` branch ships no build files, so a package from it would need its 377 MB tarball and a build step.

## Decision

1. Roughness floor: 0.045 after every other change to roughness, as Filament and three.js r187 have it. The HALF builds keep their own floor of 0.089 in the direct light, which M2-R12 added. At 0.045, roughness to the fourth power is below the smallest normal 16-bit float.
2. Specular anti-aliasing: Filament's kernel, always on, in `null3d::lighting::specular_aa_kernel` and `pbr_material`. The kernel adds min(2 × 0.15 × (|du|² + |dv|²), 0.2²) to the squared GGX alpha. du and dv are the changes of the mesh's own normal across a pixel and up a row. Roughness is clamped after it. The normal is the mesh's own, before a normal map or a surface function bends it, as in Filament and three.js. No `derivativesScale`: Filament sets one only for TAA upscaling, and the engine has none. A lower render scale widens the kernel, which suits the coarser pixels. The asset tool's bake of normal-map variance into roughness mips (M2-B6) covers detail inside normal maps, which no kernel sees. The ruling stands on the Mac's data. The page's phone runs can stop it only if the kernel costs more than it gives there.
3. Specular occlusion: Lagarde's formula from the occlusion, times horizon fading in Unity's form. The fading is the square of saturate(1 + R · N). R is the view reflected about the shaded normal, and N the mesh's own normal. It fades the environment's specular light only. Without a normal map the two normals agree, so R · N is the view's cosine, 0 or more on a face toward the camera. The factor is then 1, and nothing changes.
4. Tone curve: AgX is the default, with three.js's formulas, so it compares strictly with `AgXToneMapping`. The look (plain or punchy) waits for the owner. ACES stays a value of `toneMapping` until the `three-compat` add-on can carry it. Color is strict under D-52, so a port that set `ACESFilmicToneMapping` must keep its colors. Reinhard and Cineon were never in the core. Product templates take Neutral when they exist.
5. The strict tests against three.js run on three.js 0.186.1 with r187's floor. A patch of the package, `patches/three@0.186.1.patch`, sets it through `patchedDependencies`. The patch changes the floor in the shader chunk, the node material and the three built files that the twin pages load, and nothing else. This replaces D-53's `three-next` package until the pin moves to r187, in one change with the patch's removal.

## Consequences

- `crates/null3d-shaders/wgsl/lib/lighting.wgsl`: `ROUGHNESS_FLOOR`, `specular_aa_kernel` and `horizon_occlusion`; `pbr_material` takes the kernel in place of three.js's geometry roughness. The shader library test checks both new functions on every GPU path.
- `crates/null3d-shaders/wgsl/lit.wgsl` calls them. Lines pass a kernel of 0.
- `ToneMapping::default()` and `post.set`'s first value are AgX. The three.js twins of AO, bloom, grading and outlines, which draw with the engine's default, draw with `AgXToneMapping`.
- Image references change wherever a lit surface is curved, has roughness under 0.0525, or draws with the default curve.
- Docs: `concepts/lighting` (the three surface defaults), `concepts/color-management`, `concepts/post-processing` and `api/post` (AgX). The mapping entries `MeshStandardMaterial` and `renderer.toneMapping`, and both skills' material and color notes.
- Open: the owner's pick of AgX's look, and the shimmer page on the iPad, the Pixel 9 and the S25. Then the pin moves to r187, and the patch goes.

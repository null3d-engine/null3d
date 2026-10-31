# D-79: Lighting defaults: the roughness floor, specular anti-aliasing, horizon fading and AgX

Status: decided, under the rulings of [D-53](D-53-technique-defaults.md) (4 and 11). The owner picked AgX's punchy look as the default and set the kernel's limit to 0.1², half of Filament's. Built: the roughness floor, the kernel, horizon fading and punchy AgX. Pending: the three.js pin moves to r187, and its patch goes. Task: M2-E7.

Summary: Roughness floors at 0.045, and Filament's specular anti-aliasing kernel replaces three.js's term, with its limit at 0.1² by the owner's ruling. Horizon fading dims environment reflections that a normal map tilts below the surface. AgX with Filament's punchy look is the default curve, at no measurable cost on the Mac, and ACES stays in the core for ports.

## Question

[D-53](D-53-technique-defaults.md) set four defaults for lit materials. Ruling 11 puts specular anti-aliasing on with Filament's kernel. Ruling 4 makes AgX the tone curve of new scenes. The review also asked for three.js r187's roughness floor and for horizon fading. How does each one work in the engine? What do prototypes L3 (shimmer) and L7 (the look test) show? How do the strict tests against three.js keep working?

## Rule

- The best technique is the default, with no three.js mode in the core ([D-52](D-52-intent-parity.md)).
- Specular anti-aliasing passes when it halves shimmer against three.js's term for under 1% of GPU time (D-53, L3). It stops only if it costs more than it gives on phones.
- Lighting terms and the tone curves that both engines offer keep three.js's strict image rule.

## Data

### Shimmer (prototype L3)

`tests/pages/specular-shimmer.html` draws its scenes while it moves the camera about a quarter of a pixel per frame for 48 frames (`tests/pages/sketches/specular-shimmer-sketch.ts`). It draws the same 48 frames again at 4 times the width and height and averages each 4 x 4 square. That averaged row shows each pixel's whole area, so it does not flicker. A pixel's flicker is the part of the mean size of its second difference over time above 4 levels. 8-bit rounding and the dither cannot reach that part, so they do not count as flicker. The shimmer is how much more the canvas's frames flicker than their averaged row, in steps of 1/255 over the whole frame. The error is the mean distance from the averaged row.

The page has four scenes:

- `small`: 96 small metal spheres and rings, from 10 to 20 pixels across, with roughness from 0.1 to 0.4 under a grazing sun.
- `smooth`: large spheres of many triangles, 40 to 60 pixels across, with roughness 0.05 to 0.3.
- `tiny`: 1,152 smooth spheres about 4 pixels across, with roughness 0.045 to 0.15. Their highlights are narrower than a pixel.
- `bumps`: a sphere under a fine normal map.

Each variant is a build of the lit template: three.js's term, Filament's kernel at several limits, and no anti-aliasing. three.js's term adds the mesh normal's largest change across a pixel to roughness. Shimmer, Chrome on the Mac's GPU, WebGPU, 48 frames:

| Variant | small | smooth | tiny |
| --- | --- | --- | --- |
| three.js's term | 0.104 | 0.046 | 0.309 |
| Kernel, limit 0.2² (Filament's) | 0.032 | 0.0093 | 0.223 |
| Kernel, variance 0.05, limit 0.2² | 0.030 | 0.0076 | not run |
| Kernel, limit 0.1² | 0.018 | 0.0027 | 0.142 |
| Kernel, limit 0.05² | 0.013 | 0.0014 | 0.081 |
| None | 0.0096 | 0.00096 | 0.020 |

- Less filtering gives less flicker, step by step, in every scene. No setting of the kernel flickers less than no filter.
- The cause: the kernel reads how fast the interpolated normal changes from pixel to pixel. Linear interpolation makes that rate constant inside each triangle, with jumps at triangle edges and outlines. As the camera moves, the jumps cross pixels, so each pixel's added roughness jumps from frame to frame. The widened highlights also cover more pixels, so more pixels flicker. Kaplanyan's kernel assumes a smooth normal across the pixel.
- 2 x 2 blocks are not the cause on the Mac. `dpdxFine` and `dpdyFine` give the same pixels as `dpdx` and `dpdy`. The Mac's GPU measures per pixel.
- Without a filter, small glossy shapes are darker. The tiny scene's mean light is 0.53 with no filter, 3.2 at the 0.1² limit and 3.5 at 0.2². The averaged row averages after the tone curve, which loses light where a narrow highlight clips. So the page cannot say which brightness is right.
- In the `bumps` scene every variant gives the same figure. The kernel never sees a normal map's detail. The averaged row there flickers more than the canvas. At 4 times the size, the GPU reads a finer level of the map, whose bumps alias. So `bumps` does not test the kernel, and the device plan leaves it out.
- Against the rule "halve shimmer against three.js's term": the 0.2² limit cuts it by 70%, 80% and 28%, and fails on `tiny`. The 0.1² limit cuts it by 83%, 94% and 54%, and passes on all three.
- The kernel costs two square roots and about six other operations per pixel, in place of three.js's term of about five. The difference is far below 1% of a frame. No phone has timed it.

#### Phones

Four builds of the lit shader ran the page's `small`, `smooth` and `tiny` scenes on BrowserStack's Pixel 9 (Mali-G715) and Galaxy S25 (Adreno 830), in Chrome 152. Each build passed 6 of 6 pages: the three scenes on WebGPU and on WebGL2. WebGL2 gave the WebGPU figures within 2%. The S25 gave the Pixel 9's figures within 1%. [Tested devices](../tested-devices.md) holds each run as a file. Shimmer on WebGPU, Pixel 9 / S25:

| Variant | small | smooth | tiny |
| --- | --- | --- | --- |
| three.js's term | 0.107 / 0.108 | 0.028 / 0.028 | 0.309 / 0.309 |
| Kernel, limit 0.2² | 0.0240 / 0.0240 | 0.0053 / 0.0053 | 0.0667 / 0.0667 |
| Kernel, limit 0.1² | 0.0151 / 0.0152 | 0.0007 / 0.0007 | 0.0518 / 0.0519 |
| None | 0.0096 / 0.0095 | 0.0002 / 0.0002 | 0.0030 / 0.0030 |

The Pixel 9's error (distance from the averaged row) and mean light, `small` / `smooth` / `tiny`:

| Variant | Error | Light |
| --- | --- | --- |
| three.js's term | 4.73 / 1.16 / 6.93 | 4.29 / 3.26 / 1.70 |
| Kernel, limit 0.2² | 2.30 / 1.09 / 2.84 | 3.51 / 3.11 / 3.08 |
| Kernel, limit 0.1² | 1.53 / 1.05 / 1.12 | 3.40 / 3.11 / 2.86 |
| None | 0.68 / 0.34 / 0.59 | 2.76 / 2.99 / 0.47 |

- The phones rank the variants as the Mac does: less filtering gives less flicker in every scene.
- Against three.js's term, the 0.2² limit cuts shimmer by 78%, 81% and 78%, and the 0.1² limit by 86%, 98% and 83%. Both pass the "halved" rule on the phones. Only 0.1² passes it on the Mac too.
- The 0.1² limit has a lower error than 0.2² in every scene, and on `tiny` less than half of it.
- With no filter, the `tiny` scene keeps about a sixth of the light that the kernel keeps (0.47 against 2.86), as on the Mac.

### The owner's ruling on the limit

The owner set the limit to 0.1². The figures above give the reasons:

- 0.1² halves shimmer against three.js's term in every scene, on the Mac, on both phones and on the iPad.
- 0.2², Filament's limit, cuts shimmer by only 28% on the Mac's and the iPad's `tiny` scene, so it fails the rule of [D-53](D-53-technique-defaults.md).
- No filter flickers least, but small glossy shapes lose most of their highlights. The averaged row cannot say which brightness is right, so the page cannot prove that dark highlights are correct. D-53's ruling 11 also asks for a kernel.
- A lower limit (0.05²) flickers less on the Mac, but no phone has run it. It also moves further from Filament's tested value, toward no filter.

#### The owner's iPad

The same four builds ran on the owner's iPad Pro 11-inch in Safari 26.6.2. A heat check first held 60 frames a second for 59 of 59 seconds. Each build passed 6 of 6 pages, with no out-of-memory refusal. WebGL2 gave the WebGPU shimmer within 6%, except with no filter (0.0079 / 0.0005 / 0.0186). Error and light were the same on both paths. WebGPU, `small` / `smooth` / `tiny`:

| Variant | Shimmer | Error | Light |
| --- | --- | --- | --- |
| three.js's term | 0.105 / 0.047 / 0.310 | 4.98 / 1.30 / 9.72 | 4.39 / 3.28 / 2.05 |
| Kernel, limit 0.2² | 0.0319 / 0.0094 / 0.224 | 2.49 / 1.20 / 3.89 | 3.58 / 3.13 / 3.52 |
| Kernel, limit 0.1² | 0.0176 / 0.0028 / 0.143 | 1.56 / 1.13 / 0.99 | 3.44 / 3.13 / 3.18 |
| None | 0.0096 / 0.0010 / 0.0204 | 0.51 / 0.28 / 0.63 | 2.79 / 3.00 / 0.53 |

- The iPad matches the Mac, not the phones. Against three.js's term, the 0.2² limit cuts shimmer by 70%, 80% and 28%, and fails the "halved" rule on `tiny`. The 0.1² limit cuts it by 83%, 94% and 54%, and passes on all three scenes.
- The phones flicker less on `tiny` with every filter, and rank the variants the same way. The cause of that difference is not known, and it does not change the ruling.
- So on every device that ran the page, only the 0.1² limit halves shimmer in every scene.

### The look test (prototype L7, Mac only)

Five scenes drew on the Mac's GPU under plain AgX, AgX "punchy" and Neutral. They were S4, S5, the sphere grid under the sun and under the built-in room, and the bright tiles of the tone mapping tests. Punchy is Filament's look: power 1.35 and saturation 1.4 after the contrast curve. Plain AgX looks flat and gray: S4's sky and walls lose color. Punchy has the contrast and color that ACES users expect, without ACES's hue shifts. Neutral keeps base colors as authored and clips bright tiles to white sooner. L7 has no numeric rule, so the owner picks the curve.

### three.js r187's floor

three.js r187 floors perceptual roughness at 0.045, Filament's desktop value, in place of 0.0525 ([three.js PR #34645](https://github.com/mrdoob/three.js/pull/34645)). The engine's tests pin three.js 0.186.1. three.js's `dev` branch ships no build files, so a package from it would need its 377 MB tarball and a build step.

## Decision

1. Roughness floor: 0.045 after every other change to roughness, as Filament and three.js r187 have it. The HALF builds keep their own floor of 0.089 in the direct light (M2-R12). At 0.045, roughness to the fourth power is below the smallest normal 16-bit float.
2. Specular anti-aliasing: Filament's kernel, always on, in `null3d::lighting::specular_aa_kernel` and `pbr_material`. The kernel adds min(2 × 0.15 × (|du|² + |dv|²), 0.1²) to the squared GGX alpha. The owner halved Filament's limit of 0.2², because the lower limit halves shimmer against three.js's term in every scene of the shimmer page, on the Mac, the phones and the iPad. du and dv are the changes of the mesh's own normal across a pixel and up a row. Roughness is clamped after it. The normal is the mesh's own, before a normal map or a surface function bends it, as in Filament and three.js. No `derivativesScale`: Filament sets one only for TAA upscaling, and the engine has none. A lower render scale widens the kernel, which suits the coarser pixels. The asset tool's bake of normal-map variance into roughness mips (M2-B6) covers detail inside normal maps, which no kernel sees.
3. Specular occlusion: Lagarde's formula from the occlusion, times horizon fading in Unity's form. The fading is the square of saturate(1 + R · N). R is the view reflected about the shaded normal, and N the mesh's own normal. It fades the environment's specular light only. Without a normal map the two normals agree, so R · N is the view's cosine, 0 or more on a face toward the camera. The factor is then 1, and nothing changes.
4. Tone curve: AgX with Filament's punchy look, `'agx-punchy'`, is the default for new scenes (the owner's choice, after the look test). Punchy gives new scenes contrast and color at almost no cost: about ten more operations per pixel in the last pass. Plain AgX looks flat and gray, and Neutral covers exact colors. Plain AgX (`'agx'`) stays a value, with three.js's formulas, so it compares strictly with `AgXToneMapping`. Product templates take Neutral when they exist. three.js has no punchy look, so the default has null3D's own references, and ports that set `AgXToneMapping` keep plain AgX.
5. ACES stays in the core for good, by the owner's ruling ([D-179](D-179-technique-rulings.md), ruling 23). Color is strict under D-52, so a port that sets `ACESFilmicToneMapping` must keep its colors. Reinhard and Cineon are not in the core. They come in the `three-compat` add-on in M3, through the public tone-curve hook of M2-F5.
6. The strict tests against three.js run on three.js 0.186.1 with r187's floor. A patch of the package, `patches/three@0.186.1.patch`, sets it through `patchedDependencies`. The patch changes the floor in the shader chunk, the node material and the three built files that the twin pages load, and nothing else. It stands in for D-53's `three-next` package. When the pin moves to r187, the patch goes in the same change.

## Consequences

- `crates/null3d-shaders/wgsl/lib/lighting.wgsl`: `ROUGHNESS_FLOOR`, `specular_aa_kernel` and `horizon_occlusion`; `pbr_material` takes the kernel in place of three.js's geometry roughness. The shader library test checks both functions on every GPU path.
- `crates/null3d-shaders/wgsl/lit.wgsl` calls them. Lines pass a kernel of 0.
- `ToneMapping::default()` and `post.set`'s first value are punchy AgX. The image tests of AO, bloom, grading and outlines, whose three.js twins draw the same scene, set plain AgX, and the twins draw with `AgXToneMapping`. The half precision copy of the bright scene under punchy AgX must draw the full precision image, as the other curves' copies do.
- Parity with three.js (the coordinator's ruling): specular anti-aliasing is an improved technique (D-53 ruling 27), so eleven lit scenes with curved, glossy surfaces each take a limit of their own. Each limit sits just above the scene's largest measured share, which leaves 0.012 to 0.028 of a point, or 7.6% to 13.6%. The scenes are the sphere grid, the five environment scenes, the 16 point lights, the metal-rough, specular and IOR models, and the toy car. Filament's kernel and three.js's term widen small highlights by different amounts. So 0.05 to 0.53% of their pixels differ, only on the highlights of the smoothest surfaces and the rims of glossy spheres, on both GPU sets. The diffs of every scene show red only there.
- Each scene's largest share across SwiftShader, the Mac's GPU and the three paths, then its limit: the sphere grid 0.231% (0.25%), the room 0.511% (0.55%), the room with a hemisphere light 0.525% (0.56%), the sunset 0.157% and its HDR file 0.158% (0.17% each), and the turned sunset 0.272% (0.3%). Then the 16 point lights 0.132% (0.15%), the metal-rough 0.316% (0.34%), specular 0.145% (0.16%) and IOR 0.195% (0.21%) models, and the toy car 0.297% (0.32%). The rooms reach their figures only in compatibility mode, where three.js's two renderers differ by 0.32 to 0.36% too. Every other lit scene keeps the rule's limit. `.dev/image-tests.md` gives each scene's figures and limit.
- The toy car (`gltf-toy-car`) differs through the kernel alone. CI's run 38921872010 measured 0.254% on WebGPU, 0.274% in compatibility mode and 0.264% on WebGL2, and the Mac's GPU up to 0.297%. three.js's frame and the frame of commit `ca28c9fdd`, whose `lit.wgsl` applies three.js's term to the base roughness and to the coat's, differ in only 0.008% of the WebGPU frame's pixels and 0.009% of the WebGL2 frame's. The kernel's frame differs from both by 0.28% to 0.30%, on the car's thin bright details: its chrome trim, its window frames and its lamp covers. Both sides draw the scene with no tone curve, and it has no environment for the horizon fading. The coat, the sheen and the glass are not at fault: the car-paint scene, whose model carries a coat and a sheen, differs from three.js in 0.026%, under the rule's 0.1%. Its nearest relative, `gltf-metal-rough`, leaves 7.6% of its largest share below its limit, and the toy car leaves 7.7%.
- Where a gap comes from the tone curve, both sides draw the same curve: the transparency and texture-map scenes turn the default curve off against their twins, as the other material scenes do. The real-units and HDR limit tests check the default path, so they compute their expected values under punchy AgX. Under AgX the vignette's mapping from `VignetteShader` keeps the intensity at 1 or less with a falloff of 3. The vignette scene then differs from three.js in 0.000% of its pixels, under its limit of 2% ([D-77](D-77-final-pass-order-and-formats.md)). Both paths darken light before the curve: on the 8-bit path the scene shaders apply the vignette, and a plain background color draws as a background while it is on (D-77). The 8-bit frame differs from the HDR one in 0.09 to 0.14% of its pixels.
- Cost of the 8-bit vignette: `tests/pages/sketches/vignette-cost-sketch.ts` times the vignette off and on, at 1280 x 800 on WebGPU. One screen is mostly background, and objects mostly cover the other. Two rounds took, in turns, the vignette in the final pass on display color and the vignette in the scene shaders. On the Mac's GPU at 120 Hz, with the load under 8, the final pass added 0.23 to 0.33 ms on the background screen and 0.07 to 0.33 ms on the covered one. The scene shaders added 0.33 ms and 0.07 ms, and without a background color 0.00 ms and 0.07 ms. The Mac's timer counts in steps of about 0.066 ms. SwiftShader shows only the cost in software. It gave the final pass 12.7 to 12.9 ms and 13.7 to 14.6 ms, and the scene shaders 10.2 to 10.7 ms and 5.8 to 6.2 ms. So the scene shaders' vignette costs no more than the final pass's. The background draw costs as much as a full-screen pass only when the background fills the screen. The HDR path keeps its vignette in the final pass.
- Image tests: every lit test that draws with the default curve has punchy AgX references. Against ACES its image changes only in tone, by 3 to 100% of pixels, and the shapes, shadows and lights stay in place. The large-world demo sets its own curve. The morph-flowers and walk-and-fly demos set ACES, by the owner's choice, because bright, saturated scenes keep their punch under ACES. The Creek showcase keeps punchy AgX, by the owner's choice after a full-size look at both curves (decision X1).
- Docs: `concepts/lighting` (the three surface defaults), `concepts/color-management`, `concepts/post-processing` and `api/post` (AgX). The mapping entries `MeshStandardMaterial` and `renderer.toneMapping`, and both skills' material and color notes.
- Open: the pin moves to r187, and the patch goes.
- Follow-ups: the look test leaves out S6, so it still needs a run on S6. No starter templates exist yet, so "Neutral in product templates" waits for the first product template.

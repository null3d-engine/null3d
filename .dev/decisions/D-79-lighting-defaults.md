# D-79: Lighting defaults: the roughness floor, specular anti-aliasing, horizon fading and AgX

Status: decided, 2026-10-05, under the rulings of [D-53](D-53-technique-defaults.md) (4 and 11). On 2026-10-06 the owner picked AgX's punchy look as the default. On 2026-10-08 the owner set the kernel's limit to 0.1², half of Filament's, after the shimmer page's runs on the Mac, the Pixel 9 and the Galaxy S25. The owner's iPad agreed later that day. Date: 2026-10-05. Task: M2-E7.

Summary: Roughness floors at 0.045, as in three.js r187 and Filament. Filament's specular anti-aliasing kernel replaces three.js's term, with its limit at 0.1² (the owner's ruling), since a lower limit flickers less. Horizon fading dims environment reflections that a normal map tilts below the surface. AgX with Filament's punchy look is the default curve, at no measurable cost on the Mac; ACES stays for ports.

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
- This first measure counted the 8-bit rounding and the dither as flicker, and the first "explanation" blamed 2 x 2 blocks of pixels. The second sweep below corrects both.

#### The second sweep (8 October 2026)

The page now counts only the part of each pixel's second difference above 4 levels, which rounding and dither cannot reach. It has four scenes:

- `small`: the scene above.
- `smooth`: large spheres of many triangles, 40 to 60 pixels across, with roughness 0.05 to 0.3.
- `tiny`: 1,152 smooth spheres about 4 pixels across, with roughness 0.045 to 0.15. Their highlights are narrower than a pixel.
- `bumps`: a sphere under a fine normal map.

 The variants now include the kernel at other limits. Shimmer, Chrome on the Mac's GPU, WebGPU, 48 frames:

| Variant | small | smooth | tiny |
| --- | --- | --- | --- |
| three.js's term (before) | 0.104 | 0.046 | 0.309 |
| Kernel, limit 0.2² (shipped) | 0.032 | 0.0093 | 0.223 |
| Kernel, variance 0.05, limit 0.2² | 0.030 | 0.0076 | not run |
| Kernel, limit 0.1² | 0.018 | 0.0027 | 0.142 |
| Kernel, limit 0.05² | 0.013 | 0.0014 | 0.081 |
| None | 0.0096 | 0.00096 | 0.020 |

- Less filtering gives less flicker, step by step, in every scene. No setting of the kernel flickers less than no filter.
- The cause: the kernel reads how fast the interpolated normal changes from pixel to pixel. Linear interpolation makes that rate constant inside each triangle, with jumps at triangle edges and outlines. As the camera moves, the jumps cross pixels, so each pixel's added roughness jumps from frame to frame. The widened highlights also cover more pixels, so more pixels flicker.
- 2 x 2 blocks are not the cause on the Mac. `dpdxFine` and `dpdyFine` gave the same pixels as `dpdx` and `dpdy`. The Mac's GPU already measures per pixel.
- Without a filter, small glossy shapes are darker. The tiny scene's mean light is 0.53 with no filter, 3.2 at the 0.1² limit and 3.5 at 0.2². The averaged row averages after the tone curve, which loses light where a narrow highlight clips. So the page cannot say which brightness is right.
- In the `bumps` scene every variant gives the same figure. The kernel never sees a normal map's detail. The averaged row there flickers more than the canvas. At 4 times the size, the GPU reads a finer level of the map, whose bumps alias. So `bumps` does not test the kernel, and the device plan leaves it out.
- Against the rule "halve shimmer against three.js's term": the 0.2² limit cuts it by 70%, 80% and 28%, and fails on `tiny`. The 0.1² limit cuts it by 83%, 94% and 54%, and passes on all three.
- The kernel costs two square roots and about six other operations per pixel, in place of three.js's term of about five. The difference is far below 1% of a frame. No phone has timed it yet.

#### Phones (8 October 2026)

Four builds of the lit shader ran the page's `small`, `smooth` and `tiny` scenes on BrowserStack's Pixel 9 (Mali-G715) and Galaxy S25 (Adreno 830), in Chrome 152. Each build passed 6 of 6 pages: the three scenes on WebGPU and on WebGL2. WebGL2 gave the WebGPU figures within 2%. The S25 gave the Pixel 9's figures within 1%. [Tested devices](../tested-devices.md) holds each run as a file. Shimmer on WebGPU, Pixel 9 / S25:

| Variant | small | smooth | tiny |
| --- | --- | --- | --- |
| three.js's term (before) | 0.107 / 0.108 | 0.028 / 0.028 | 0.309 / 0.309 |
| Kernel, limit 0.2² | 0.0240 / 0.0240 | 0.0053 / 0.0053 | 0.0667 / 0.0667 |
| Kernel, limit 0.1² | 0.0151 / 0.0152 | 0.0007 / 0.0007 | 0.0518 / 0.0519 |
| None | 0.0096 / 0.0095 | 0.0002 / 0.0002 | 0.0030 / 0.0030 |

The Pixel 9's error (distance from the averaged row) and mean light, `small` / `smooth` / `tiny`:

| Variant | Error | Light |
| --- | --- | --- |
| three.js's term (before) | 4.73 / 1.16 / 6.93 | 4.29 / 3.26 / 1.70 |
| Kernel, limit 0.2² | 2.30 / 1.09 / 2.84 | 3.51 / 3.11 / 3.08 |
| Kernel, limit 0.1² | 1.53 / 1.05 / 1.12 | 3.40 / 3.11 / 2.86 |
| None | 0.68 / 0.34 / 0.59 | 2.76 / 2.99 / 0.47 |

- The phones rank the variants as the Mac does: less filtering gives less flicker in every scene.
- Against three.js's term, the 0.2² limit cuts shimmer by 78%, 81% and 78%, and the 0.1² limit by 86%, 98% and 83%. Both pass the "halved" rule on the phones. Only 0.1² passes it on the Mac too.
- The 0.1² limit has a lower error than 0.2² in every scene, and on `tiny` less than half of it.
- With no filter, the `tiny` scene keeps about a sixth of the light that the kernel keeps (0.47 against 2.86), as on the Mac.

### The owner's ruling (8 October 2026)

The owner set the limit to 0.1² at about 11:00 on 8 October 2026. The figures above give the reasons:

- 0.1² halves shimmer against three.js's term in every scene, on the Mac and on both phones.
- 0.2², Filament's limit, cut shimmer by only 28% on the Mac's `tiny` scene, so it fails the rule of [D-53](D-53-technique-defaults.md).
- No filter flickers least, but small glossy shapes lose most of their highlights. The averaged row cannot say which brightness is right, so the page cannot prove that dark highlights are correct. D-53's ruling 11 also asks for a kernel.
- A lower limit (0.05²) flickered less on the Mac, but no phone ran it. It also moves further from Filament's tested value, toward no filter.

The iPad's runs, below, came after the ruling and agree with it.

#### The owner's iPad (8 October 2026)

The same four builds ran on the owner's iPad Pro 11-inch in Safari 26.6.2, from 10:54 to 11:07 on 8 October 2026. A heat check first held 60 frames a second for 59 of 59 seconds. Each build passed 6 of 6 pages, with no out-of-memory refusal. WebGL2 gave the WebGPU shimmer within 6%, except with no filter (0.0079 / 0.0005 / 0.0186). Error and light were the same on both paths. WebGPU, `small` / `smooth` / `tiny`:

| Variant | Shimmer | Error | Light |
| --- | --- | --- | --- |
| three.js's term (before) | 0.105 / 0.047 / 0.310 | 4.98 / 1.30 / 9.72 | 4.39 / 3.28 / 2.05 |
| Kernel, limit 0.2² | 0.0319 / 0.0094 / 0.224 | 2.49 / 1.20 / 3.89 | 3.58 / 3.13 / 3.52 |
| Kernel, limit 0.1² | 0.0176 / 0.0028 / 0.143 | 1.56 / 1.13 / 0.99 | 3.44 / 3.13 / 3.18 |
| None | 0.0096 / 0.0010 / 0.0204 | 0.51 / 0.28 / 0.63 | 2.79 / 3.00 / 0.53 |

- The iPad matches the Mac, not the phones. Against three.js's term, the 0.2² limit cuts shimmer by 70%, 80% and 28%, and fails the "halved" rule on `tiny`. The 0.1² limit cuts it by 83%, 94% and 54%, and passes on all three scenes.
- The phones flicker less on `tiny` with every filter, and rank the variants the same way. The cause of that difference was not looked for: it does not change the ruling.
- So on every device that ran the page, only the 0.1² limit halves shimmer in every scene.

### The look test (prototype L7, Mac only)

Five scenes drew on the Mac's GPU under plain AgX, AgX "punchy" and Neutral. They were S4, S5, the sphere grid under the sun and under the built-in room, and the bright tiles of the tone mapping tests. Punchy is Filament's look: power 1.35 and saturation 1.4 after the contrast curve. Plain AgX looks flat and gray: S4's sky and walls lose color. Punchy has the contrast and color that ACES users expect, without ACES's hue shifts. Neutral keeps base colors as authored and clips bright tiles to white sooner. L7 has no numeric rule, so the owner picks.

### three.js r187's floor

three.js r187 floors perceptual roughness at 0.045, Filament's desktop value, in place of 0.0525. [three.js PR #34645](https://github.com/mrdoob/three.js/pull/34645) made the change on 24 September 2026. r187 is due on 21 October 2026. three.js's `dev` branch ships no build files, so a package from it would need its 377 MB tarball and a build step.

## Decision

1. Roughness floor: 0.045 after every other change to roughness, as Filament and three.js r187 have it. The HALF builds keep their own floor of 0.089 in the direct light, which M2-R12 added. At 0.045, roughness to the fourth power is below the smallest normal 16-bit float.
2. Specular anti-aliasing: Filament's kernel, always on, in `null3d::lighting::specular_aa_kernel` and `pbr_material`. The kernel adds min(2 × 0.15 × (|du|² + |dv|²), 0.1²) to the squared GGX alpha. Filament's limit is 0.2². The owner halved it on 8 October 2026, because the lower limit halves shimmer against three.js's term in every scene of the shimmer page, on the Mac and on the phones. du and dv are the changes of the mesh's own normal across a pixel and up a row. Roughness is clamped after it. The normal is the mesh's own, before a normal map or a surface function bends it, as in Filament and three.js. No `derivativesScale`: Filament sets one only for TAA upscaling, and the engine has none. A lower render scale widens the kernel, which suits the coarser pixels. The asset tool's bake of normal-map variance into roughness mips (M2-B6) covers detail inside normal maps, which no kernel sees.
3. Specular occlusion: Lagarde's formula from the occlusion, times horizon fading in Unity's form. The fading is the square of saturate(1 + R · N). R is the view reflected about the shaded normal, and N the mesh's own normal. It fades the environment's specular light only. Without a normal map the two normals agree, so R · N is the view's cosine, 0 or more on a face toward the camera. The factor is then 1, and nothing changes.
4. Tone curve: AgX with Filament's punchy look, `'agx-punchy'`, is the default for new scenes (the owner's choice of 6 October 2026, after the look test). Punchy gives new scenes contrast and color at almost no cost: about ten more operations per pixel in the last pass. Plain AgX looked flat and gray, and Neutral covers exact colors. Plain AgX (`'agx'`) stays a value, with three.js's formulas, so it compares strictly with `AgXToneMapping`. Product templates take Neutral when they exist. three.js has no punchy look, so the default has null3D's own references, and ports that set `AgXToneMapping` keep plain AgX.
5. ACES stays in the core, marked to move to the `three-compat` add-on, until that add-on ships (the coordinator's ruling of 5 October 2026, which the owner may overrule). Color is strict under D-52, so a port that set `ACESFilmicToneMapping` must keep its colors. The add-on needs a public tone-curve hook, which M2-F5 adds, and it comes in M3. Removing ACES now would change every such port's colors until then. Reinhard and Cineon were never in the core.
6. The strict tests against three.js run on three.js 0.186.1 with r187's floor. A patch of the package, `patches/three@0.186.1.patch`, sets it through `patchedDependencies`. The patch changes the floor in the shader chunk, the node material and the three built files that the twin pages load, and nothing else. This replaces D-53's `three-next` package until the pin moves to r187, in one change with the patch's removal.

## Consequences

- `crates/null3d-shaders/wgsl/lib/lighting.wgsl`: `ROUGHNESS_FLOOR`, `specular_aa_kernel` and `horizon_occlusion`; `pbr_material` takes the kernel in place of three.js's geometry roughness. The shader library test checks both new functions on every GPU path.
- `crates/null3d-shaders/wgsl/lit.wgsl` calls them. Lines pass a kernel of 0.
- `ToneMapping::default()` and `post.set`'s first value are punchy AgX. The image tests of AO, bloom, grading and outlines, whose three.js twins draw the same scene, set plain AgX, and the twins draw with `AgXToneMapping`. The half precision copy of the bright scene under punchy AgX must draw the full precision image, as the other curves' copies do.
- Image references change wherever a lit surface is curved, has roughness under 0.0525, or draws with the default curve.
- Docs: `concepts/lighting` (the three surface defaults), `concepts/color-management`, `concepts/post-processing` and `api/post` (AgX). The mapping entries `MeshStandardMaterial` and `renderer.toneMapping`, and both skills' material and color notes.
- Open: the pin moves to r187, and the patch goes.
- Follow-ups: the look test leaves out S6, which no benchmark page draws yet; run it on S6 when S6 lands. No starter templates exist yet, so "Neutral in product templates" waits for the first product template.
- The image references change on almost every lit test, about 770 images in both sets. They are made on the final base, when no other pull request is open.

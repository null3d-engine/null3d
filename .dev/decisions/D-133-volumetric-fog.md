# D-133: Volumetric fog and light shafts

Status: decided by its landing, 2026-10-14. Date: 2026-10-11. Task: M2-EX21.

Summary: `scene.setFog({ volumetric })` lights the scene's fog with the main directional light and the point and spot lights, through their shadows. Sun rays then fall through trees, and lamps and headlights glow in cones. The engine lights a grid of cells that follow the camera's view (froxels), as Frostbite and Unreal do. It sums the cells front to back, and adds the light that the fog scatters toward the camera after the main pass. Four fragment steps run on every GPU path, and their code and shaders load on first use. The quality setting `fogSlices` sizes the grid. Low keeps the fog's analytic sun glow, at no cost. Data holds the figures per preset and the download sizes.

## Question

The showcase scenes need light shafts and lit fog ([D-132](D-132-showcase-look-and-features-2026-10-11.md), the owner's ruling of 11 October 2026). Creek wants sun rays through its trees at golden hour. Night town wants glowing cones around its street lamps and car headlights, and Battle wants dusty light. The fog of [D-74](D-74-native-fog.md) has a sun glow that no shadow blocks, and lamps do not light it. Which technique lights the fog through shadows on WebGPU, its compatibility mode and WebGL2? Where does it run, what does each preset draw, and what does it cost?

## Rule

- The best technique by default ([D-52](D-52-intent-parity.md)). Shadows block the light in the fog, from the sun's cascades and from the spot and point lights' shadow tiles.
- One look on all three GPU paths, with image references for each, or a stated fallback.
- Nothing costs anything while it is off: no pass, no target, no pipeline and no shader download (design principle 8).
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- Phones have a cheap path. The fog's height falloff and sun glow stay the cheap default.
- The main pass gains no texture binding. WebGPU's main pass reads 15 of its 16 textures, and screen-space reflections and contact shadows need room too (coordinator's slot plan, 11 October 2026).

## Options

### The technique

| Option | What it does | Verdict |
| --- | --- | --- |
| A: screen-space radial shafts (Mitchell, GPU Gems 3, 2007) | Blurs a mask of the sky toward the sun's place on the screen | Rejected as the default. It shows rays only while the sun is on the screen or near it, never from lamps, and never from shadows off the screen |
| B: a ray march per pixel at half or quarter size | Steps along each pixel's view ray, samples the shadow maps and the lights at each step, then blurs and upsamples | Rejected. Its cost follows the screen's pixels times the steps: at 1920 x 1080, half size and 24 steps light about 12 million points per frame, and each step loops over the lights of its cluster |
| C: froxels (Wronski, Assassin's Creed IV, 2014; Hillaire, Frostbite, 2015; Unreal Engine 4) | Lights each cell of a grid along the view once, sums the cells front to back, and reads the sum at each pixel's depth | Chosen |

Option C lights each cell once. A grid of 160 x 90 cells in 64 slices lights about 920,000 points, a thirteenth of option B's, whatever the screen's size. Each cell loops over the lights of its cluster in the clustered light grid, which the main pass already builds. A small offset in each frame, and a blend with the last frame's result, smooth the grid's steps over a few frames. Later, transparent surfaces and particles can read the same grid for their own fog.

### The steps

The grid is a texture of slices side by side, 8 slices to a row. Each slice is a tile of columns and rows across the view. The tiles follow the canvas's shape, with a fixed count of cells on its short side. So the grid's cost does not follow the screen's pixels or the render scale. Slice edges lie at `distance × (k / slices)²` along the view, so near slices are thin and far ones thick.

1. **Light**, one triangle over the grid's texture. Each texel is a cell. It finds a point in the cell, moved by the frame's offset. The scene fog's density and height falloff give the fog's density there. It adds the sun's light where the cascades see it, through the four texels nearest the point. Henyey-Greenstein's phase function weighs each light. It adds each point and spot light of the point's cluster, with its range, cone and shadow tile. It blends the result with the last frame's light at the same place in the world, where the last frame's grid held it. It writes the light that the fog scatters per meter and the fog's extinction. Two kept textures take turns, so each frame reads the last frame's grid from one and writes the other.
2. **Sum**, in two steps of one triangle each, into two more textures of the grid's size. The slices fall into blocks of 8, a row of tiles each. The block step sums, for each cell, the cells from its block's first slice to its own, front to back. Frostbite's integral over each slice keeps the light right however thick the slice is. The sum step then joins, for each cell, the sums of the whole blocks in front of it, front to back, and its own block's sum up to it. It writes the light scattered toward the camera up to the cell's far edge and the share of light that passes. A cell reads at most 8 slices in the first step and one texel per block in the second: 12 and 20 reads at 32 and 96 slices. Until 13 October 2026 one step summed every slice in front of each cell, so its work grew with the square of the slices, and 96 slices cost 3.2 times what 64 did (see Data).
3. **Apply**, one triangle at the render size. Each pixel finds its place in the grid from its depth. It reads the two nearest slices, each through a cubic B-spline over the 16 nearest cells (see [Smooth reads on a coarse grid](#smooth-reads-on-a-coarse-grid)), and adds that light to the scene's color. Past the grid's reach it adds the sun's light that the fog scatters there, without shadows, in closed form. So no edge shows where the grid ends. The background takes the grid's light in front of it, but none from past the reach. It takes none of D-74's fog either, and its sky holds its own haze around the sun. Adding the closed form there turned a low sun's sky white. The step writes a target that the custom effects, depth of field, bloom and the final pass read.

The light step binds the camera's frame group, as the background and the debug lines do. So it reads the cascades, the clustered lights and the shadow atlas with no new binding there. Its own group holds its block, the last frame's grid and a sampler: three bindings, which fit WebGL2's three slots of group 1.

### What the grid adds to the fog

The fog of D-74 stays. It dims each surface by the fog in front of it. It mixes in the fog's color, which stands for the light of the sky that the fog scatters. The grid adds only the light of the sun and the lamps that the fog scatters toward the camera, through their shadows. While the grid draws, the camera's frame values carry no sun glow, since the grid's sun light replaces it. Other views, such as scene passes and reflections, keep the glow.

The grid takes the fog's `density` as the density of exponential fog, with any curve. With the exponential curve, the fog that dims a surface and the fog that lights the air are then the same fog.

### Where it runs

On the HDR path, after the transparent passes and before the custom effects. The 8-bit path cannot add HDR light to display color, as bloom cannot. In WebGPU's compatibility mode with MSAA, turning the grid on moves the engine to HDR color with FXAA, as bloom and depth of field do. It moves only once `fogSlices` is above 0. With 0 slices, as on Low, the grid draws nothing, so the move would cost for nothing and change the edges. Until 13 October 2026 it moved anyway, and the image test `fog-volume-no-slices` on compatibility mode then differed from the plain fog's image at 0.53% of its pixels, all on edges. The test now guards it. On WebGL2 devices whose float targets fail the engine's test, the fog keeps its glow. That is the stated fallback.

Applying the grid in the main pass's shaders instead would dim and light each surface, transparent ones too, with no pass at the render size. It needs a texture binding in the main pass, which the slot plan keeps for other features. The pass after the main pass costs one read and one write of the scene color.

### Smooth reads on a coarse grid

A single filtered read blends the four nearest cells along straight lines. Where the light changes, the slope of that blend turns at each cell's edge, so the cells show as steps. On 13 October 2026 the light shafts demo showed square steps in the haze on WebGL2, and none on WebGPU. WebGL2 and WebGPU's compatibility mode stop at Medium, so they drew Medium's grid of 32 slices, with 64 cells on the short side. WebGPU drew High's, with 96. On a 720-pixel-high canvas, Medium's cells are about 11 pixels across, and their edges showed. Phones on Medium would show the same steps. Hold mode, which every image test and capture uses, draws its frame with no offset and no last frame, so nothing hid the steps there. In live play, the offsets and the blend with the last frame soften them over a few frames.

The apply step therefore reads each slice through a cubic B-spline over the four by four nearest cells. Four filtered reads, each placed between two pairs of cells by their weights, give the spline's sum, so the step takes 8 reads in place of 2. The spline's slope changes smoothly, so no cell's edge shows at any slice count. It softens the shafts' edges by about a cell, which the grid cannot resolve anyway. The cost is in the figures below.

The image test `fog-volume-medium` draws the sun scene at Medium's 32 slices on every GPU path, and each path must draw the first path's image. A plain filtered read would change its image and fail it. Hold mode has a second blind spot. Its frame never blends a last frame's grid, so no held image test runs the light step's blend, and WebGL2 runs that blend with code of its own, as its rows run bottom first. The test `fog-live.spec.ts` covers it: each GPU path draws the sun scene in play, at Medium's grid with a still camera, for 2 s, and compatibility mode and WebGL2 must draw WebGPU's frame. Comparing images by a roughness measure, the mean absolute Laplacian, did not catch the steps: each step spans many pixels, so the measure barely changes. Look at a zoomed crop when judging grid artifacts.

### See-through surfaces

The apply step reads the opaque depth. A surface that blends or lets light through, such as water, glass or a sprite, draws in the transparent pass before it. Such a surface takes the grid's light of the whole line of sight to the opaque surface behind it. It does not dim the part behind itself. In thin fog the difference is small. In thick fog, a dark pane shows the shafts behind it a little too brightly.

The grid's lookup is a function of the shader library, `fog_volume_place` and `fog_volume_blend` in `null3d::fog_volume`. It takes the summed grid as a texture and a sampler, and the grid's layout. It also takes a point's place on the screen and its distance along the view. It gives the light that the fog scatters toward the camera up to that point, and the share of light that passes. The apply step calls it, and reads each of the two slices through the cubic spline over the place's cell, which the place also holds. A shader with fewer reads to spare reads the two places with the linear sampler, and its cells may then show on a coarse grid. A shader that draws after the apply step, such as a particle add-on's, binds the summed grid in a group of its own. It calls the same function at its own depth. The engine's own transparent pass reads no grid in this version, because that needs a texture binding in the main pass.

### The API

`scene.setFog({ ..., volumetric: true })`, or an object of options:

| Option | Default | Meaning |
| --- | --- | --- |
| `intensity` | 1 | How much of the lights' light the fog scatters, on top of what its density gives |
| `anisotropy` | 0.6 | Henyey-Greenstein's g, from -0.95 to 0.95: how much light the fog scatters forward, toward a camera that looks into the light |
| `distance` | 100 | How far along the view the grid reaches, in world units |

The fog's other options keep their meaning. While the grid draws, `sunGlow` has no effect; it is the look where the grid does not draw.

### Quality

The quality setting `fogSlices` takes 0, 32, 64 or 96 slices. The grid's short side follows: 64, 96 or 128 columns. Low takes 0, so phones keep the analytic glow, at no cost. Medium takes 32, High 64 and Ultra 96. These are starting values, which the figures below set. A coarse grid on Low is a candidate once a phone measures it, as depth of field's was ([D-119](D-119-depth-of-field.md)).

The frame-budget governor's step halves the slices that a frame draws, into the same textures, so it makes no GPU object. The frame after a step reads no history.

### Budgets

The engine's start grows only by the option's check and the new values in the core's call. The steps' Rust code is in the WebAssembly files. Their shaders load on first use, in their own files.

### three.js

three.js has no volumetric fog in its core. Its `webgpu_volume_lighting` example marches rays through a box with `VolumeNodeMaterial`, lit by point and spot lights with shadows. Ports map it, and the god rays effects of add-on libraries, to `volumetric`.

## Data

The download sizes: the lit fog's shader builds load on the feature's first use, 7,397 bytes for WebGPU and 7,405 for WebGL2 after Brotli, and a page that uses none of them adds nothing. The feature's code in a page's start adds about 460 bytes after Brotli, mostly its pipeline tables and the scene API.

### Cost on the Mac

The fog cost test (`NULL3D_FOG_COST=1 bun run test:browser -- fog-cost.spec.ts`) times the effect cost page's fog scene with the volumetric fog off and on, in turns, three times each, at 1920 x 1080 and a render scale of 1, with the governor off. It ran on 13 October 2026 on the Mac's GPU in Chrome, on this record's branch with the smooth read, at loads of 3.4 to 7.1. The figures are the extra GPU time per frame with the grid on, from the medians of each side. The sun scene is a low sun behind pillars; the night scene has three shadowed spot lights and a point light.

| Slices (preset) | WebGPU sun / night | Compatibility mode sun / night | WebGL2 sun / night |
| --- | --- | --- | --- |
| 32 (Medium) | +0.52 / +0.52 ms | +0.52 / +0.46 ms | +0.50 / +0.71 ms |
| 64 (High) | +1.70 / +1.70 ms | +1.70 / +1.57 ms | +1.47 / +1.61 ms |
| 96 (Ultra) | +5.37 / +5.37 ms | +5.31 / +5.05 ms | +4.40 / +4.65 ms |

These figures are with the one step that summed every slice in front of each cell. From 32 to 96 slices the cells grow about 12 times and the cost about 10 times, but from 64 to 96 the cells grow 2.7 times and the cost 3.2 times: that step's work grew with the square of the slices. The block step and the sum split it on 14 October 2026, so a cell reads at most 8 slices and one texel per block, 12 and 20 texels at 32 and 96 slices. The CPU time per frame stayed within 0.04 ms of the fog's off side on every path. The lamps cost little: each cell loops over the lights of its own cluster.

### Allocation

The allocation check (`bun run bench:allocation --fog`) turns the volumetric fog on in S1, with height fog, while the camera orbits. It passed on WebGPU and on WebGL2 on 12 October 2026. On WebGPU the sketch worker allocated 248 bytes per frame, and on WebGL2 the sketch worker 222 and the render worker 174, each within its budget. On WebGPU the replay may allocate 192 bytes per frame more than without the fog: the browser's encoders of the three render passes, at bloom's 64 bytes per pass.

### Image tests

The fog's tests draw the sun scene and the night scene with the volumetric fog on and off, the fog turned on during play, half the render scale, Medium's grid, no slices and the 8-bit path, on WebGPU, compatibility mode and WebGL2, in both reference sets. At Medium's grid the three paths drew the same image within 0.8 levels of 255 on average on the Mac's GPU. The light shafts demo's held frame has references on each path in both sets.

## Decision

To come with the data.

## Consequences

To come with the data.

## Addendum: the grid's range

Status: fixed on 15 October 2026 by the helper of the code review's lighting findings (M-13), for
the owner's review. Date: 2026-10-15. Task: none.

The grid's textures hold 16-bit floats, whose largest value is 65504. Height fog grows without
bound below its height, and the grid's cells reach below the ground, behind the surfaces. The
scene docs' own example, `setFog({ density: 0.1, height: 0, heightFalloff: 0.5 })`, gives a
density of about 27,000 per unit 25 m below the ground, and more below that. A larger density, or
its scattered light, stored as infinity. The block step then multiplied infinity by 0, which is
not a number. That value spread down the cell's column through the sum, onto the scene's pixels
through the apply step's blend, and into later frames through the history.

The light step now limits the density and the scattered light to 65504 before it stores them
(`GRID_MAX` in `null3d::fog_volume`). The block and sum steps limit the light that they store in
the same way. At the limit, a slice a thousandth of a unit long passes under e^-65 of the light
behind it, so nothing that shows changes. The image test `fog-volume-dense` draws the docs'
example with the lit fog's default reach, whose cells pass the range far below the ground.

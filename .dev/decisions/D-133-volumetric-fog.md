# D-133: Volumetric fog and light shafts

Status: proposed, 2026-10-11. Date: 2026-10-11. Task: M2-EX21.

Summary: `scene.setFog({ volumetric })` lights the scene's fog with the main directional light and the point and spot lights, through their shadows. Sun rays then fall through trees, and lamps and headlights glow in cones. The engine lights a grid of cells that follow the camera's view (froxels), as Frostbite and Unreal do. It sums the cells front to back, and adds the light that the fog scatters toward the camera after the main pass. Three fragment steps run on every GPU path, and their code and shaders load on first use. The quality setting `fogSlices` sizes the grid. Low keeps the fog's analytic sun glow, at no cost. The figures per preset are to come.

## Question

The showcase scenes need light shafts and lit fog (D-132, the owner's ruling of 11 October 2026). Creek wants sun rays through its trees at golden hour. Night town wants glowing cones around its street lamps and car headlights, and Battle wants dusty light. The fog of [D-74](D-74-native-fog.md) has a sun glow that no shadow blocks, and lamps do not light it. Which technique lights the fog through shadows on WebGPU, its compatibility mode and WebGL2? Where does it run, what does each preset draw, and what does it cost?

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
2. **Sum**, one triangle over a second texture of the grid's size. Each cell sums the cells in front of it, front to back. Frostbite's integral over each slice keeps the light right however thick the slice is. It writes the light scattered toward the camera up to the cell's far edge and the share of light that passes.
3. **Apply**, one triangle at the render size. Each pixel finds its place in the grid from its depth. It reads the two nearest slices through the linear sampler, and adds that light to the scene's color. Past the grid's reach it adds the sun's light that the fog scatters there, without shadows, in closed form. So no edge shows where the grid ends. The step writes a target that the custom effects, depth of field, bloom and the final pass read.

The light step binds the camera's frame group, as the background and the debug lines do. So it reads the cascades, the clustered lights and the shadow atlas with no new binding there. Its own group holds its block, the last frame's grid and a sampler: three bindings, which fit WebGL2's three slots of group 1.

### What the grid adds to the fog

The fog of D-74 stays. It dims each surface by the fog in front of it. It mixes in the fog's color, which stands for the light of the sky that the fog scatters. The grid adds only the light of the sun and the lamps that the fog scatters toward the camera, through their shadows. While the grid draws, the camera's frame values carry no sun glow, since the grid's sun light replaces it. Other views, such as scene passes and reflections, keep the glow.

The grid takes the fog's `density` as the density of exponential fog, with any curve. With the exponential curve, the fog that dims a surface and the fog that lights the air are then the same fog.

### Where it runs

On the HDR path, after the transparent passes and before the custom effects. The 8-bit path cannot add HDR light to display color, as bloom cannot. In WebGPU's compatibility mode with MSAA, turning the grid on moves the engine to HDR color with FXAA, as bloom and depth of field do. On WebGL2 devices whose float targets fail the engine's test, the fog keeps its glow. That is the stated fallback.

Applying the grid in the main pass's shaders instead would dim and light each surface, transparent ones too, with no pass at the render size. It needs a texture binding in the main pass, which the slot plan keeps for other features. The pass after the main pass costs one read and one write of the scene color.

### See-through surfaces

The apply step reads the opaque depth. A surface that blends or lets light through, such as water, glass or a sprite, draws in the transparent pass before it. Such a surface takes the grid's light of the whole line of sight to the opaque surface behind it. It does not dim the part behind itself. In thin fog the difference is small. In thick fog, a dark pane shows the shafts behind it a little too brightly.

The grid's lookup is a function of the shader library, `fog_volume_place` and `fog_volume_blend` in `null3d::fog_volume`. It takes the summed grid as a texture and a sampler, and the grid's layout. It also takes a point's place on the screen and its distance along the view. It gives the light that the fog scatters toward the camera up to that point, and the share of light that passes. The apply step calls it. A shader that draws after the apply step, such as a particle add-on's, binds the summed grid in a group of its own. It calls the same function at its own depth. The engine's own transparent pass reads no grid in this version, because that needs a texture binding in the main pass.

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

To come: the GPU and CPU time per preset on the Mac, on WebGPU and WebGL2, with the grid on and off. Then the allocation check, the download sizes and the image tests.

## Decision

To come with the data.

## Consequences

To come with the data.

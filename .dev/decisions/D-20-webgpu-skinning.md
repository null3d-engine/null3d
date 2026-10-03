# D-20: WebGPU skinning

Status: proposed; the Mac and iPad timings pending. Date: 2026-10-04. Task: M2-C3.

## Question

On WebGPU, should the engine skin each animated mesh once per frame in a compute pass? The shadow and main passes would then draw the skinned vertices. Or should it skin each mesh in the vertex shader of every pass that draws it, as WebGL2 does ([D-10](D-10-webgl2-skinning.md))?

## Rule

Keep the compute pass if it saves at least 10% of the frame time with two or more cascades. It must do so on the Mac and on the iPad, with identical images. This is D-10's rule on the other GPU path.

## Both ways in the engine

The engine builds both, so the data can pick either. The compute pass is the default, and the `?skinning=vertex` switch picks the vertex shader on WebGPU. What both share:

- A loader links a mesh object to an animated instance with the scene command `SET_SKIN`. A skinned object draws from a bucket of its own, as any object with bounds of its own does.
- Each frame's skinning matrices reach the GPU in one RGBA32F texture: 1,024 joints per row, three texels per joint. The animation step writes one of two matrix buffers in turn. So each frame uploads straight from the buffer of its own step, with no copy. The WebGL2 path (M2-C4) can read the same texture.
- A skinned object culls with a sphere that its pose moves. Each mesh keeps a sphere per joint around the vertices that the joint moves. After each animation step the core moves those spheres by the pose and writes the sphere around them all. A skinned vertex is a weighted average of its joints' matrices applied to it, so it lies inside that sphere, whatever the pose. A Rust test checks every vertex of a column against 200 random poses. Each joint turns up to half a turn, scales by 0.5 to 2 and moves up to 3 m.

The compute pass (`gpu_driven/skin.rs`, `skin.wgsl`):

- Each skinned object gets a region of a skinned vertex buffer for each part of its mesh, when the scene's structure changes. A region holds the mesh's vertices without joints and weights, with positions, normals and tangents as 32-bit floats. The views' bundles draw the regions with the mesh page's indices, so they are recorded only when the structure changes.
- Each frame, the CPU tests each skinned object's world sphere against the views that draw. These are the cameras, and for casters, the cascades and the shadow tiles that draw that frame. One dispatch per mesh page skins the parts of the objects that some view draws, one thread per vertex, 64 to a workgroup. The shader reads every vertex type that glTF allows (D-25).
- The passes then draw the skinned vertices with the pipelines of plain meshes. So every template skins, custom materials and the debug views too, with no shader variant of its own.

The vertex shader (`?skinning=vertex`):

- The lit, standard maps, unlit, unlit map and shadow depth templates gain SKIN builds. Each blends its vertex's four joints from the joint texture. A bind group of its own holds the texture, after the frame's group or after the maps' group.
- Each skinned object's bucket names the first joint of its skin, and the culling pass copies it beside the material into each instance it draws.
- Custom materials and the debug views have no SKIN builds, so they draw skinned meshes at rest in this mode. Giving custom materials SKIN builds would double their WebGPU builds.

## Data

### Images and parity

| Measure | Result | Where |
| --- | --- | --- |
| The skinning scene against three.js's `SkinnedMesh` (`bun run parity -- --scene skinning`) | 0.000% of pixels differ on core WebGPU and 0.043% in compatibility mode; three.js's two renderers differ by 0.032% | Chrome on the Mac's GPU, 2026-10-03 |
| The vertex shader's images against the compute pass's: the skinning scene, with shadows, and with a see-through character | Within the default tolerance of the same references, on both WebGPU tiers | `bun run test:images -g skinning`, the Mac's GPU and SwiftShader |
| A quantized mesh (positions in 16-bit whole millimeters, 8-bit normals, joints and weights) against floats | Within the default tolerance of the float image | the same run |

### Download size

The WebGPU shader modules hold both ways while the decision is open. Against main on 2026-10-04, each WebGPU module grew from about 19.2 KB to 23.4 KB after Brotli. The SKIN builds take 2.3 to 3.5 KB of that, measured by building the modules with and without them. The compute pass's shader and the culling shader's new word take the rest. Each core WebAssembly file grew 3.3%, from 210.4 to 217.3 KB, for the bounds, the layout and the skinned passes, which both ways share. The WebGL2 modules did not change.

### Timing

The WebGPU skinning page (`tests/pages/skinning-webgpu.html`) is the twin of D-10's WebGL2 page. It draws the same scene both ways with WebGPU calls of its own, so no engine code runs. [Device sessions](../devices.md#the-skinning-plan) describes the scene and the timing. In short:

- A crowd of 50 to 500 generated characters. Each has 2,560 vertices, 5,040 triangles and a chain of 32 joints, with four joint weights per vertex. The page bends each chain every frame.
- A directional light with 1 to 4 cascades of 2048 x 2048 texels, each fitted to its slice of the view. Both paths cull the crowd per pass on the CPU.
- A frame of 1280 x 720 pixels on every device, with four shadow map taps per pixel.
- Both paths upload the joint matrices to a float texture each frame, as the engine does. The vertex shader path skins each character in each pass that draws it. The compute path skins each character that some pass draws once, with one thread per vertex, into one buffer of positions and normals. Each pass then draws that buffer with plain vertex shaders.
- Each frame goes to the GPU in a submit of its own. Each batch of frames ends when the GPU has finished its last frame. Where the adapter has timestamp queries, the page also times the GPU from each batch's first pass to its last.

The runs are pending: `bun tests/real-browsers.ts --plan skinning-webgpu --lan ipad-safari "Google Chrome"`. The engine's switch gives a second check in a real scene once S5 exists (M2-L2): the same scene with and without `?skinning=vertex`.

## Decision

Pending the timings. Until then the engine skins in the compute pass, as the plan has it.

## How three.js handles it

three.js's WebGPU renderer (0.186) skins in the vertex shader, as its WebGL renderer does, and its shadow passes skin each mesh again. Its skinning node reads each mesh's bone matrices from a uniform buffer of 4 × 4 matrices. Skeletons too large for the uniform buffer limit read them from a bone texture. A `computeSkinning` helper lets an app skin a mesh in a compute pass of its own, but the renderer never uses it itself. three.js culls a `SkinnedMesh` with a sphere that `computeBoundingSphere` works out from every skinned vertex. It does so once, at the pose of the mesh's first frustum test, and again only when the app calls it. So a limb that later swings out of that sphere can vanish at the view's edge. null3D moves its bounds with the pose each frame, from a sphere per joint.

## Consequences

- Whichever way loses leaves the engine. For the compute pass, that is `skin.wgsl`, `gpu_driven/skin.rs`'s pass and the skinned vertex buffer. For the vertex shader, that is the WGSL modules' SKIN builds, the joint texture's bind group on WebGPU and the bucket's first joint. That frees 2.3 to 3.5 KB per WebGPU page. The `?skinning=` switch then goes too.
- WebGL2 (M2-C4) skins in the vertex shader, by D-10, with the same joint texture and the GLSL builds of the same SKIN code.
- The record is in the table in [README.md](README.md).

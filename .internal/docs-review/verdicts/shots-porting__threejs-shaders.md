# Verdicts: screenshots and demo links for porting/threejs-shaders

## Shots

### shader-inputs: keep
- The reference image tests/image/references/chrome-real-gpu/webgpu/demo-shader-inputs.png exists. It shows the crystal spiral, colored row by row, and three banded stones. The middle stone is lit amber as the picked one. The alt text matches the picture.
- It helps the "Built-in values" section. The demo's custom materials read the row in its batch, the object's world matrix and its id.
- Note: the file is only 320x180. A larger capture would read better on a docs page.

### dissolve: keep, with the source changed to "reference"
- No capture step is needed. The image test custom-dissolve already has a reference: tests/image/references/chrome-real-gpu/webgpu/custom-dissolve.png (480x270, also under compat and webgl2).
- The test page tests/pages/sketches/custom-dissolve-sketch.ts uses the same WGSL as the page's port, character for character.
- The picture shows four spheres: whole, then at progress 0.3, 0.5 and 0.7, with orange edges on the holes. Change the alt text to: "Four spheres from whole to nearly gone, with an orange glow along the edges of the holes."

### wind-sway: drop
- The reference image exists, but it shows a still grove and a meadow. A still frame does not show sway, so the alt text "Plants bent by the wind" claims something the picture does not show.
- The vegetation-wind demo does not hold the pattern from the page. Its plants sway through a shared material in examples/lib/sway.ts. That material samples the wind add-on's field. It is not the small vertex offset from the worked example.

### fresnel-glow: drop
- No such test page exists. A "scripted" shot must use a demo or test page that can really take the steps. This one asks for a new page.
- No demo draws a fresnel rim glow either (see the concepts below).
- If the picture is wanted, first add a test page that uses the page's glow material, and an image test for it. Then use its reference image.

## Demo links

| Concept | Code | Verdict | Reason |
| --- | --- | --- | --- |
| Built-in values | shader-inputs/ | keep | It exists in demos.ts. Its WGSL reads input.instance, object.worldMatrix and object.id. |
| Wind sway vertex offset | vegetation-wind/ | drop | The vertex offset is in examples/lib/sway.ts, outside the linked folder, and it samples the wind add-on's field. Link compare/battle/ under "Wind sway from onBeforeCompile" instead. The battle comparison's grass is this exact port: in three.js, `transformed +=` after begin_vertex; in null3D, a vertexOffset in compare/battle/sketch.ts. |
| Displacement | relief/ | keep | The hills and boulders use the standard material's displacementMap and displacementScale. That is the first advice of the section. |
| gl_VertexID as vertex_index | rain/ | keep | Rain has no code value, so "rain/" follows the contract. Its shader's @vertex entry takes @builtin(vertex_index). Note: it is a draw from a vertex count (scene.createVertexDraw), not a mesh material. |
| onBeforeCompile sway ported to WGSL | compare/battle/ | keep | three-shaders.ts patches MeshStandardMaterial in onBeforeCompile for the grass and the flags. sketch.ts holds the same sway as a WGSL vertexOffset. The same file also has TSL positionNode and emissiveNode versions, so the link also suits "TSL and node materials". |
| A ShaderMaterial in both engines | compare/night-town/ | drop | Its three.js side uses onBeforeCompile and TSL node materials. It has no ShaderMaterial of its own. The only one is the Reflector's built-in material. |
| A ShaderMaterial in both engines (added) | compare/factory/ | add | Its cone of haze is a three.js ShaderMaterial (CONE_VERTEX and CONE_FRAGMENT in cone.ts, additive, no depth write). The null3D side ports it to materials.shader with a surface function. It shows steps 1 to 5 of the section: uniforms, material.set, deleting the vertex shader, and the flags. |

## Concepts said to have no demo

- Fresnel glow: confirmed. No demo or test page has a rim glow. The nearest is compare/factory/: its cone is a view-angle glow from a ShaderMaterial, with additive blending and no depth write. But it is brightest where the surface faces the camera, which is the reverse of a rim glow, and it uses a lit surface function, not fn unlit. Mention it only as a ShaderMaterial port.
- Full shaders as a port target: confirmed for a lit full shader. No demo uses a mesh material with @vertex and @fragment and the null3d::lighting helpers. rain/ is the only demo with a full shader, but it is an unlit draw shader from a vertex count.

# Verdicts: porting/threejs-mapping (slice porting-shaders)

Source to edit: docs/data/threejs-mapping.json (the page is generated from it).

## Shots

None proposed. Nothing to check.

## Demo links

All 14 codes exist as demo names in examples/demos.ts, with a matching folder under examples/.

| Concept | Code | Keep | Reason |
| --- | --- | --- | --- |
| Geometry generators | generators/ | yes | Sketch builds the nine geometry shapes with the parameters of three.js's geometry classes. Matches the BoxGeometry-style rows. |
| Extra geometry classes | extra-shapes/ | yes | Torus knot, polyhedra, lathe, extrude, tube and shape from @null3d/geometry. Matches the TorusKnot/Lathe/Extrude row. |
| Split screens | multiple-views/ | yes, move | Sketch uses scene.createView with two cameras and a Split/Inset switch. The main row for this (renderer.setViewport / setScissor) is in "Renderer and loop", not "Cameras". Put the link there; the Cameras section only names split screens in the ArrayCamera/StereoCamera row. |
| Shadows | hero-shadow/ | yes | Directional light with castShadows, cascades, and sun.setShadow({ hero }), which the DirectionalLight row's note names. Better labelled "Shadows and the hero shadow". |
| RectAreaLight | area-lights/ | yes | Sketch calls scene.createRectAreaLight several times (and tube lights). |
| GLTFLoader | gltf-model/ | yes | Loads the BoomBox with assets.loadGltf. |
| InstancedMesh | instances/ | yes | scene.createInstances with dynamic: true and per-column writes. |
| AnimationMixer | character/ | yes | obj.animator(), playBlend, a masked layer and play() of a one-shot clip. |
| Raycaster and pointer events | picking/ | yes, relabel | The demo finds objects with obj.on('pointerenter' / 'click') and event.point. Its own comment says "object.on finds the piece with no raycast". It does not show the Raycaster row (camera.screenToRay + scene.raycast). Label it "Pointer events on objects" and place it by the "DOM pointer, mouse, touch and keyboard listeners" row. |
| TransformControls | gizmos/ | yes | createTransformControls from @null3d/controls, attach(piece), Translate/Rotate/Scale switch. |
| Vector3 and Quaternion | math/ | yes | vec3 and quat helpers place and turn 300 drones without allocation. |
| EffectComposer passes | post-effects/ | yes | post.set with bloom, AO, outline, DOF, vignette, grade. |
| Sprites and Line2 | sprites-lines/ | yes | scene.createSprites, and scene.createLines with worldUnits and dashed lines. Matches both rows. |
| Points | galaxy/ | yes | scene.createPoints with per-star colors. |

## Concepts said to have no demo

- Renderer and loop: not confirmed. multiple-views/ shows the renderer.setViewport / setScissor row in this section (scene.createView). Every demo shows defineSketch and onUpdate, so that part needs no own link.
- Helpers and debugging: confirmed. No demo sketch calls debug.axes, grid, box, sphere, arrow, frustum, light or skeleton. Only the skyway showcase calls debug.stats, which belongs to the renderer.info row, and a large showcase is a poor link for it.

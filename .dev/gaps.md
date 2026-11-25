# Gaps

This guide tracks what null3D lacks: features that are not built and limits of built features. The user docs and the skills state each limit as a present fact, with its workaround, and promise nothing ([D-395](decisions/D-395-limits-without-promises.md)). This guide is where the maintainers plan the work. A branch that finds a gap adds it here, and a branch that closes one removes its line.

Each line gives the feature, the pages that cover it, and the workaround, where one exists.

## Gaps on the docs pages

- Orbit controls: zoom toward the pointer (`zoomToCursor`); key movement (`keys`, `keyPanSpeed`, `keyRotateSpeed`); target limits (`cursor`, `minTargetRadius`, `maxTargetRadius`); `saveState` and `reset`. docs/api/controls.md. No workaround.
- Gizmos: position limits `minX` to `maxZ`. docs/api/controls.md. No workaround.
- A call that skins a mesh built in code (joints and weights do not move its vertices). docs/api/geometry.md. The mesh draws in the pose of its positions.
- `assets impostor` command that writes impostor atlases from a file. docs/api/impostors.md. No workaround.
- Lines, points and sprites: no shadows cast or received, and overlap queries do not find them. docs/api/lines.md, points.md, sprites.md. No workaround.
- Particles: cast no shadows, lights do not light them, no back-to-front sort inside a system. docs/api/particles.md. No workaround.
- `materials.shader` and custom materials take no standard texture maps. docs/api/materials.md, docs/concepts/materials.md. They take up to 6 textures of their own.
- Preset settings marked "planned" (`maxLights`, `maxLightsPerCluster`): the presets do not apply them. docs/api/quality.md, docs/concepts/quality-presets.md, docs/concepts/lighting.md ("The quality presets cap area lights, but not yet the other light limits"). The generated preset table leaves out the two rows.
- Terrain has no collision. docs/api/terrain.md. No workaround.
- Materials cannot sample a cube map. docs/api/textures.md. A cube map can be a background (`assets.loadCubemap`).
- Direct array writes to a single object. docs/concepts/static-dynamic.md. Move a single object with its setters.
- Shader built-ins: light values. docs/shaders/builtins.md. No workaround.
- Shaders other than surface functions and full shaders. docs/shaders/wgsl-rules.md. No workaround.
- Command line tool: `docs`, `port`, `skills`, `mcp` and `doctor` commands; behavior tests in `test`. docs/cli/null3d.md. No workaround.
- In-page inspector and MCP server (step 0.3). docs/guides/debugging.md, docs/guides/agents.md ("Coming later" section removed).
- Feature draws in a scene pass or a reflection pass. docs/api/feature-draws.md. Naming one throws E1223.
- Add-on effects after the tone curve, or in a scene or reflection pass; effect reads of normals, motion vectors, history and the shadow atlas. docs/api/feature-effects.md, docs/api/features.md. Other frame points throw E1223.
- Transparent instance draws for add-ons. docs/api/feature-instances.md.
- `'normals'` scene resource: no pass makes it. docs/api/features.md, docs/concepts/render-graph.md (table row removed).
- Registered feature outputs are bound to no texture; nothing reads a lighting slot's provider. docs/api/features.md. A compute pass publishes its texture and a material reads it with `textures.fromPass`.
- Feature callbacks: `ready` is not asked by the draw, instance, compute and sky-layer adapters; nothing calls `resize` and `reset`. docs/api/features.md. The add-on keeps its own size and reset state.
- Hooks with no payload: material lobes, baked-data formats, glTF extension handlers, scene inputs behind a material. docs/api/features.md (table removed).
- Scene inputs that custom materials do not read (E1217). docs/api/materials.md.
- Wind: layered and volume grids; High and Ultra use the flat 128 and 256 grids. docs/api/wind.md.
- Anisotropy in a surface function (needs the tangent frame). docs/shaders/surface-functions.md.
- Picking inside a view's rectangle (`screenToRay` and `worldToScreen` take no view). docs/guides/multiple-views.md.
- Project templates other than `empty`. docs/getting-started/project-structure.md.
- Wide debug lines (debug lines are one pixel wide). docs/api/debug.md. Use the lines API.

## Gaps in the skills

- CLI `docs show` / `docs search`; null3d-develop/SKILL.md, references/testing-and-debugging.md, null3d-port-threejs/SKILL.md; read `node_modules/@null3d/engine/docs/<id>.md`
- CLI `doctor` and `doctor --device`; null3d-develop/references/testing-and-debugging.md, evals/evals.json; check `crossOriginIsolated`, `engine.capabilities.tier`, `engine.mode.preset` by hand
- CLI `mcp` (MCP server, tools null3d_list_objects, null3d_get_object, null3d_set_transform, null3d_set_material, null3d_capture, null3d_stats, null3d_errors, null3d_render_graph, null3d_set_quality, null3d_set_gpu); null3d-develop/SKILL.md, references/testing-and-debugging.md (old section 6); none
- CLI `port compare`; null3d-port-threejs/references/verification.md; `bunx @null3d/cli test` with the three.js images as references
- Physics add-on (and @null3d/rapier); null3d-develop/SKILL.md add-on table, evals/evals.json (eval 9); Rapier or cannon-es in the sketch worker
- MSDF text add-on (troika-three-text, drei `<Text>`); null3d-develop/SKILL.md, null3d-port-threejs/references/architecture-and-loop.md, react-three-fiber.md; HTML labels (ui.trackLabel), a text texture, or a text mesh baked into glTF
- drei `<Text3D>` ("not in 1.0"); react-three-fiber.md; same as above
- Shared poses between identical skinned characters; null3d-develop/references/performance.md; longer pose interval for far characters
- Post effects of @react-three/postprocessing beyond tone mapping, autoExposure, bloom, ao, dof, outline, lut, vignette ("0.2, not built yet"); react-three-fiber.md; points to references/post-processing.md
- TAA of a moving view ("comes after 1.0"); null3d-port-threejs/references/post-processing.md; keep MSAA
- On-demand frame loop (`frameloop="demand"`, "not in 1.0"); react-three-fiber.md; `engine.setPaused(true)`
- Blurred, distance-faded contact shadows of drei `<ContactShadows />`; react-three-fiber.md; `materials.shadowCatcher`
- Surface functions cannot read the scene's lights; null3d-port-threejs/references/materials.md; pass the light's direction as a uniform
- Preset table rows marked "planned" (light caps maxLights, maxLightsPerCluster); null3d-develop/references/performance.md; none

## Gaps in the three.js mapping

- An add-on that draws text with MSDF fonts. The `geo-text` entry. DOM labels, a text texture or a text mesh in glTF.
- An official Rapier adapter, `@null3d/rapier`. The `physics` entry. Run the physics library in the sketch worker.
- Orbit controls: `zoomToCursor`, `keys`, `keyPanSpeed`, `keyRotateSpeed`, `cursor`, `minTargetRadius`, `maxTargetRadius`, `saveState` and `reset`. Trackball and Arcball controls. The `orbit-controls` entry.
- Gizmos: `minX` to `maxZ`, and `showXY`, `showYZ` and `showXZ`. The `gizmos` entry.
- WebXR and stereo cameras. The `xr` and `stereo-camera` entries. The mapping's `post-1.0` status is gone, and both entries are `unsupported`.

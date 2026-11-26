# porting-shaders-substance-11

Finding as given:

```json
{
 "page": "shaders/surface-functions",
 "anchor": "## The scene's depth, lines 361-363 (engine_frame.camera_range, engine_frame.camera_position.w)",
 "category": "term-before-definition",
 "severity": "medium",
 "claim": "The example reads engine_frame, which the built-in inputs page never documents and which the Rules list as a reserved engine name. A reader cannot tell if it is public or what camera_position.w means. Documented values give the same result.",
 "evidence": "docs/shaders/builtins.md (only frame, camera, object, material); docs/shaders/surface-functions.md:611; docs/shaders/library.md null3d::depth (is_orthographic, linear_depth, orthographic_depth_to_view_z); same value in docs/guides/custom-passes.md:421",
 "proposedEdit": "Rewrite distance_of with '#import null3d::depth::{is_orthographic, linear_depth, orthographic_depth_to_view_z}' and 'if is_orthographic(camera.projection) { return -orthographic_depth_to_view_z(depth, camera.near, camera.far); } return linear_depth(depth, camera.near, camera.far);'. Or document engine_frame on the built-ins page.",
 "generatedSource": "",
 "id": "porting-shaders-substance-11",
 "slice": "porting-shaders",
 "role": "substance"
}
```

Verdict: partly

## Evidence

The problem holds:

- docs/shaders/surface-functions.md:361-363 reads `engine_frame.camera_range.x/.y` and `engine_frame.camera_position.w > 0.5`. Nothing on the page says what the w value means.
- docs/shaders/builtins.md documents only `frame`, `camera`, `object` and `material`. `engine_frame` is not there. The Rules list at surface-functions.md:611 names `engine_frame` only as a name the reader must not declare.
- The same undocumented values are in docs/api/materials.md:779-781 and :809, and in docs/guides/custom-passes.md:421.
- Documented values do give the same result. In the built-ins module (crates/null3d-shaders/wgsl, the `null3d::builtins` fill function, around lines 84-91), `camera.near` and `camera.far` are filled from `camera_range.x` and `.y`, and `camera.projection` is the frame's projection. `is_orthographic` (crates/null3d-shaders/wgsl/lib/depth.wgsl) tests `projection[3][3] > 0.5`, which is true for the same cameras where `camera_position.w > 0.5` is false (lit.wgsl:2747 uses w > 0 to mean perspective). The math also matches: `linear_depth` is `near*far/(near + depth*(far-near))`, and `-orthographic_depth_to_view_z` is `far - depth*(far-near)`.

The proposed edit is wrong and would break the example:

- The engine joins the user's WGSL to the end of the standard material's file (crates/null3d-shaders/src/material.rs:979, `format!("{}{own_source}...", template.source)`).
- When the WGSL calls `sceneDepth` or `sceneDistance`, the build defines SCENE_DEPTH (material.rs, around the `calls_scene_depth` check). The template then runs `#import null3d::depth::{linear_depth, orthographic_depth_to_view_z}` (crates/null3d-shaders/wgsl/lit.wgsl:145-147).
- The shader composer (naga_oil 0.23, src/compose/parse_imports.rs:77) adds a second entry for a name that is imported twice. It does not merge the entries. Then substitute_identifiers (parse_imports.rs:136, called with allow_ambiguous false from preprocess.rs:486) fails with "Ambiguous import path for item" when the name has two entries. So a user import of `linear_depth` or `orthographic_depth_to_view_z` would stop the build of every shading variant of this material. Importing only `is_orthographic` is safe, because the template does not import it.
- The other fallback, "document engine_frame on the built-ins page", would make an internal struct public. The built-ins page exists to keep that struct out of view, so the edit should use the public built-ins.

## Corrected claim

The example reads the engine's internal `engine_frame`, which no page documents. The reader cannot tell what `camera_position.w` means. The public `camera.near`, `camera.far` and `camera.projection` built-ins give the same result. The same values appear in docs/api/materials.md:779-781 and :809, and in docs/guides/custom-passes.md:421. The rewrite must not import `linear_depth` or `orthographic_depth_to_view_z`: the engine's material already imports them when the WGSL reads the scene's depth, and a second import of the same name stops the build.

## Corrected edit

In docs/shaders/surface-functions.md (lines 357-367) and docs/api/materials.md (around lines 775-785), replace `distance_of` with:

```wgsl
#import null3d::depth::{is_orthographic}

/// The distance in front of the camera of a depth value, as sceneDistance converts the copy's.
fn distance_of(depth: f32) -> f32 {
    let near = camera.near;
    let far = camera.far;
    if is_orthographic(camera.projection) {
        return far - depth * (far - near);
    }
    return near * far / (near + depth * (far - near));
}
```

In docs/api/materials.md:809 and docs/guides/custom-passes.md:421, replace "with `engine_frame.camera_range`" with "with `camera.near` and `camera.far`".

The engine's water package (packages/water/src/water.wgsl, ocean.wgsl and fall.wgsl) uses the same internal pattern. That is engine code, so this finding does not cover it.

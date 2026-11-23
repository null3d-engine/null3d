// An environment or a cube map behind every object: a box around the camera at the far plane, drawn
// in the camera's opaque pass behind the objects (see the renderer's `background` module), whose
// fragments read the cube map in their direction, as three.js draws a cube texture or a PMREM
// texture in `scene.background`. An environment reads the level that holds the blur's roughness, as
// three.js reads its PMREM with `backgroundBlurriness`; a cube map reads its only level. The
// fragment shader writes linear color as the mesh shaders write theirs: into the HDR scene color,
// or tone mapped and encoded on the 8-bit path (the TONE_MAP builds). On the 8-bit path with the
// vignette on, a plain background color draws through this shader too, so the vignette darkens it
// before the tone mapping as it does on the HDR path.
#import null3d::globals::Frame
#import null3d::tonemap
#import null3d::ibl::{roughness_level}
#import null3d::backdrop::{Backdrop, box_corner}
#import null3d::fog

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> backdrop: Backdrop;
@group(1) @binding(1) var cube_map: texture_cube<f32>;
@group(1) @binding(2) var cube_sampler: sampler;

struct CubeOut {
    @builtin(position) clip: vec4f,
    @location(0) direction: vec3f,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> CubeOut {
    let corner = box_corner(vertex, frame.view_proj, frame.camera_position);
    var out: CubeOut;
    out.clip = corner.clip;
    out.direction = corner.direction;
    return out;
}

/// The cube map's light in the fragment's direction, turned by the background's rotation, at the
/// level that holds the blur's roughness, times the intensity and the exposure. A plain color is
/// exposed already. Either light takes the fog that a surface at the camera's far plane takes in
/// its direction, so the sky behind the land continues the land's haze.
@fragment
fn fs(in: CubeOut) -> @location(0) vec4f {
    let d = in.direction;
    if backdrop.color.w > 0.0 {
        let plain = null3d::fog::fogged_background(
            frame.fog,
            backdrop.color.rgb,
            d,
            frame.camera_range.y,
            frame.sun_direction.xyz,
            frame.sun_color.xyz,
        );
        return null3d::tonemap::finish(
            plain,
            in.clip.xy,
            frame.occlusion.y,
            frame.output,
            frame.target_size.xy,
            frame.vignette,
        );
    }
    let turned = vec3f(
        dot(backdrop.rotation[0].xyz, d),
        dot(backdrop.rotation[1].xyz, d),
        dot(backdrop.rotation[2].xyz, d),
    );
    let level = roughness_level(backdrop.params.y, backdrop.params.z);
    let light = textureSampleLevel(cube_map, cube_sampler, turned, level).rgb;
    let scale = backdrop.params.x * frame.output.exposure;
    // The background takes the same fog as a surface at the camera's far plane.
    let exposed = light * scale;
    let fogged = null3d::fog::fogged_background(
        frame.fog,
        exposed,
        d,
        frame.camera_range.y,
        frame.sun_direction.xyz,
        frame.sun_color.xyz,
    );
    return null3d::tonemap::finish(
        fogged,
        in.clip.xy,
        frame.occlusion.y,
        frame.output,
        frame.target_size.xy,
        frame.vignette,
    );
}

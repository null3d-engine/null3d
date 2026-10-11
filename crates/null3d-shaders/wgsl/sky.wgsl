// three.js's sky behind every object: its `Sky` object (examples/jsm/objects/Sky.js, r186), the
// Preetham daylight model with a sun disc and drifting clouds, drawn as a box around the camera at
// the far plane, in the camera's opaque pass behind the objects. The model lives in
// null3d::atmosphere, which the sky's environment draws too. The values that three.js's vertex
// shader finds once go to the fragments as flat values. The fragment shader writes linear color as
// the mesh shaders write theirs: into the HDR scene color, or tone mapped and encoded on the 8-bit
// path (the TONE_MAP builds). It binds the background's group as the cube map background does, and
// reads no texture.
#import null3d::globals::Frame
#import null3d::tonemap
#import null3d::backdrop::{Backdrop, box_corner}
#import null3d::atmosphere::{SkySettings, SkyWhole, second_sun, sky_light, sky_whole}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> backdrop: Backdrop;

struct SkyOut {
    @builtin(position) clip: vec4f,
    @location(0) direction: vec3f,
    @location(1) @interpolate(flat, either) sun_direction: vec3f,
    @location(2) @interpolate(flat, either) beta_r: vec3f,
    @location(3) @interpolate(flat, either) beta_m: vec3f,
    /// The sun's light, how low the sun stands, and how much daylight the clouds take: values of
    /// the whole sky, found once per vertex.
    @location(4) @interpolate(flat, either) sun: vec3f,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> SkyOut {
    let corner = box_corner(vertex, frame.view_proj, frame.camera_position);
    var out: SkyOut;
    out.clip = corner.clip;
    out.direction = corner.direction;
    let whole = sky_whole(backdrop.sun.xyz, backdrop.scattering);
    out.sun_direction = whole.sun_direction;
    out.beta_r = whole.beta_r;
    out.beta_m = whole.beta_m;
    out.sun = whole.sun;
    return out;
}

/// The sky's light in the fragment's direction, times the intensity and the exposure.
@fragment
fn fs(in: SkyOut) -> @location(0) vec4f {
    let whole = SkyWhole(in.sun_direction, in.beta_r, in.beta_m, in.sun);
    let settings =
        SkySettings(backdrop.sun, backdrop.scattering, backdrop.clouds, backdrop.cloud_place);
    let direction = normalize(in.direction);
    var color = sky_light(direction, whole, settings, backdrop.sun.w);
    // A second sky, of a second sun, adds its light at its weight.
    let second_sky_weight = backdrop.params.w;
    if second_sky_weight > 0.0 {
        let second = sky_whole(second_sun(backdrop.cloud_place), backdrop.scattering);
        color += second_sky_weight * sky_light(direction, second, settings, backdrop.sun.w);
    }
    let scale = backdrop.params.x * frame.output.exposure;
    return null3d::tonemap::finish(color * scale, in.clip.xy, frame.output);
}

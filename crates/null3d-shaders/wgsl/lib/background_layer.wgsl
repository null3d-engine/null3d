#define_import_path null3d::background_layer

// A sky layer that an add-on draws over the core sky: a box around the camera at the far plane,
// recorded right after the background in the camera's opaque pass (see the renderer's `background`
// module), before the first opaque object. It runs on every GPU path and in every thread mode,
// because it is the background's own pass and not a new one.
//
// The file sits under lib/ while it has no entry of its own in shaders.toml: the build compiles
// every entry shader alone, and this one calls the add-on's `skyLayer`, which only the shader
// compiler's stitching supplies, as it supplies `effect` to the custom effect template. Its entry
// table follows the manifest marker that makes the build prove it with a stub, the way
// `custom_effects` proves the effect template.
//
// The add-on writes one function, `skyLayer`, which returns the layer's linear color and its
// coverage. The template owns everything else: the vertex stage, the frame's bindings, the depth
// state and the blend. The core sky's cloud settings reach the layer, so a developer's clouds obey
// the same coverage, density, elevation and scale that the core's flat clouds obey, and the sun's
// visibility reaches it so the layer can dim the disc that the core sky draws.
//
// The pass blends straight alpha over the sky. On the 8-bit path the blend mixes encoded colors, as
// the engine's transparent objects do, so a layer that covers fully draws the same on both paths and
// one that covers partly differs by the encode's rounding.
#import null3d::globals::Frame
#import null3d::tonemap
#import null3d::backdrop::box_corner

/// What the layer's shader reads: the direction of the fragment's view ray, the core sky's cloud
/// settings, the sketch time in seconds, and how much of the sun the layer hides, from 0 for none
/// to 1 for all of it.
struct SkyLayerInput {
    direction: vec3f,
    clouds: vec4f,
    time: f32,
    sun: f32,
}

/// What the add-on's shader writes. The template's `skyLayer` call is the one function that an
/// add-on gives: linear color in the pass's own format, and coverage from 0 to 1.
struct SkyLayer {
    color: vec3f,
    coverage: f32,
}

struct Layer {
    /// The core sky's cloud coverage, cloud density, cloud elevation and cloud scale.
    clouds: vec4f,
    /// The share of the sun that the layer hides, then the layer's own opacity, then two spare
    /// values.
    view: vec4f,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> layer: Layer;

struct LayerOut {
    @builtin(position) clip: vec4f,
    @location(0) direction: vec3f,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> LayerOut {
    let corner = box_corner(vertex, frame.view_proj, frame.camera_position);
    var out: LayerOut;
    out.clip = corner.clip;
    out.direction = corner.direction;
    return out;
}

@fragment
fn fs(in: LayerOut) -> @location(0) vec4f {
    let drawn = skyLayer(SkyLayerInput(in.direction, layer.clouds, frame.clock.x, layer.view.x));
    let coverage = clamp(drawn.coverage * layer.view.y, 0.0, 1.0);
    if coverage <= 0.0 {
        discard;
    }
    let finished = null3d::tonemap::finish(
        drawn.color,
        in.clip.xy,
        frame.output,
        frame.target_size.xy,
        frame.vignette,
    );
    return vec4f(finished.rgb, coverage);
}

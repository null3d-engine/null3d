// The template of a sky layer that an add-on draws over the core sky: a box around the camera at the
// far plane, recorded right after the background in the camera's opaque pass (see the renderer's
// `background` module), before the first opaque object. It runs on every GPU path and in every
// thread mode, because it is the background's own pass and not a new one.
//
// The manifest marks this shader with `sky_layers`, so the build proves it with the stub at the end
// of this file and writes no module of it, as `custom_effects` proves the effect template. The
// shader compiler adds an add-on's WGSL after the file's last line and builds every variant with the
// shader def SKY_LAYER, so that the add-on's function replaces the stub.
//
// The add-on writes one function, `skyLayer`, which returns the layer's linear color and its
// coverage. The template owns everything else: the vertex stage, the frame's bindings, the depth
// state and the blend. The core sky's cloud settings reach the layer, so a developer's clouds obey
// the same coverage, density, elevation and scale that the core's flat clouds obey, and the sun's
// visibility reaches it so the layer can dim the disc that the core sky draws.
//
// The pass blends the layer over the sky as the engine's transparent objects blend, with the color
// premultiplied by the coverage, which the fragment writes. On the 8-bit path the blend mixes
// encoded colors, as those objects do, so a layer that covers fully draws the same on both paths
// and one that covers partly differs by the encode's rounding.
#import null3d::globals::Frame
#import null3d::sky_layer::{SkyLayer, SkyLayerInput, SkyLayerValues}
#import null3d::tonemap
#import null3d::backdrop::box_corner

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> layer: SkyLayerValues;

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
    return vec4f(finished.rgb * coverage, coverage);
}

#ifndef SKY_LAYER
/// What the build compiles the template with where no layer's WGSL joins it: a layer that draws
/// nothing. The add-on's function takes this one's place in every build of a layer.
fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    return SkyLayer(vec3f(0.0), 0.0);
}
#endif

#define_import_path null3d::sky_layer

// What a sky layer's WGSL gives and takes, shared by the engine's sky-layer templates: the box
// that draws over the background, and the draws that fill a sky map's cube faces. An add-on
// declares one function, `skyLayer`, and the shader compiler joins it to each template.

/// What the layer's shader reads: the direction of the view ray in the world, the core sky's cloud
/// settings, the sketch time in seconds, and how much of the sun the layer hides, from 0 for none
/// to 1 for all of it.
struct SkyLayerInput {
    direction: vec3f,
    clouds: vec4f,
    time: f32,
    sun: f32,
}

/// What the add-on's shader writes: linear color, and coverage from 0 for none to 1 for all of
/// the pixel.
struct SkyLayer {
    color: vec3f,
    coverage: f32,
}

/// The values that the engine writes for a layer each time it changes, as a template binds them.
struct SkyLayerValues {
    /// The core sky's cloud coverage, cloud density, cloud elevation and cloud scale.
    clouds: vec4f,
    /// The share of the sun that the layer hides, then the layer's own opacity, then the clock that
    /// a map's fill reads, then the background's intensity, which the box that draws over the
    /// background multiplies into the layer's color.
    view: vec4f,
}

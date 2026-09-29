// A test shader for the GPU layer's texture commands. Each draw covers its viewport with one
// quad, and its parameters pick what the quad shows: a solid color, a layer of a texture array
// with the sampler's own mip level or a chosen one, a 2D texture, or a depth comparison on a
// layer of a depth array. WebGL2 (the WEBGL2 variant) stores what a render pass draws bottom row
// first, so there the quad flips the texture coordinates of a target that a pass drew.

struct Params {
    /// What the quad shows: one of the SHOW_ values.
    show: u32,
    /// The array layer to read.
    layer: u32,
    /// The mip level that SHOW_LEVEL reads.
    level: f32,
    /// The depth that the quad writes, from 0 to 1.
    depth: f32,
    /// The texture coordinates at the quad's top-left and bottom-right corners.
    uv_min: vec2f,
    uv_max: vec2f,
    /// The color that SHOW_COLOR writes, and that SHOW_DEPTH shows where the comparison passes.
    color: vec4f,
    /// 1 when a render pass drew the texture that the quad reads.
    drawn: u32,
}

const SHOW_LAYER: u32 = 1u;
const SHOW_LEVEL: u32 = 2u;
const SHOW_FLAT: u32 = 3u;
const SHOW_DEPTH: u32 = 4u;

@group(0) @binding(0) var<uniform> params: Params;
@group(1) @binding(0) var layers: texture_2d_array<f32>;
@group(1) @binding(1) var flat_image: texture_2d<f32>;
@group(1) @binding(2) var color_sampler: sampler;
@group(2) @binding(0) var depths: texture_depth_2d_array;
@group(2) @binding(1) var depth_sampler: sampler_comparison;

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
    @location(1) corner: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> VertexOut {
    // Two triangles over the viewport, with corner (0, 0) at its top-left.
    var corners = array<vec2f, 6>(
        vec2f(0.0, 0.0),
        vec2f(1.0, 0.0),
        vec2f(0.0, 1.0),
        vec2f(0.0, 1.0),
        vec2f(1.0, 0.0),
        vec2f(1.0, 1.0),
    );
    let corner = corners[vertex];
    var out: VertexOut;
    out.clip = vec4f(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, params.depth, 1.0);
    out.uv = mix(params.uv_min, params.uv_max, corner);
    out.corner = corner;
    return out;
}

/// Where to read a texture: the quad's coordinates, flipped on WebGL2 for a target that a render
/// pass drew.
fn read_at(uv: vec2f) -> vec2f {
#ifdef WEBGL2
    if params.drawn != 0u {
        return vec2f(uv.x, 1.0 - uv.y);
    }
#endif
    return uv;
}

@fragment
fn fs_solid() -> @location(0) vec4f {
    return params.color;
}

@fragment
fn fs_sample(in: VertexOut) -> @location(0) vec4f {
    let uv = read_at(in.uv);
    switch params.show {
        case SHOW_LAYER: {
            return textureSample(layers, color_sampler, uv, params.layer);
        }
        case SHOW_LEVEL: {
            return textureSampleLevel(layers, color_sampler, uv, params.layer, params.level);
        }
        case SHOW_FLAT: {
            return textureSample(flat_image, color_sampler, uv);
        }
        case SHOW_DEPTH: {
            // The reference rises from 0 at the quad's left edge to 1 at its right edge, and
            // passes where the sampler's compare function holds against the stored depth.
            let reference = in.corner.x;
            let passed = textureSampleCompareLevel(depths, depth_sampler, uv, params.layer, reference);
            return mix(vec4f(0.1, 0.1, 0.1, 1.0), params.color, passed);
        }
        default: {
            return params.color;
        }
    }
}

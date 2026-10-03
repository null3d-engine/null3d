// A test shader for cube, 3D and high dynamic range textures in the GPU layer. Each draw covers
// its viewport with one quad, or a part of it, and its parameters pick what the quad shows: a
// solid color, one face of a cube texture, a slice of a 3D texture or a layer of a texture array.
// Every read names its mip level, which may lie between two levels. The colors that it reads are
// scaled, so a texture can hold values above 1.
//
// WebGL2 stores what a render pass draws bottom row first. The face pipeline therefore turns its
// quad upside down in the WEBGL2 variant, so a whole cube face that it draws holds its rows in
// WebGPU's order, and a read of the cube needs no change of direction on either path.

struct Params {
    /// What the quad shows: one of the SHOW_ values.
    show: u32,
    /// The cube face that SHOW_FACE reads, from 0 to 5: +X, -X, +Y, -Y, +Z, -Z.
    face: u32,
    /// The mip level to read, which may lie between two levels.
    lod: f32,
    /// The factor that multiplies the color read.
    scale: f32,
    /// The quad's corners in its viewport, from 0 at the top-left to 1 at the bottom-right.
    rect_min: vec2f,
    rect_max: vec2f,
    /// The color that SHOW_COLOR writes.
    color: vec4f,
    /// The depth of the slice that SHOW_SLICE reads, from 0 to 1.
    slice: f32,
    /// The layer that SHOW_LAYER reads.
    layer: u32,
}

const SHOW_FACE: u32 = 1u;
const SHOW_SLICE: u32 = 2u;
const SHOW_LAYER: u32 = 3u;

@group(0) @binding(0) var<uniform> params: Params;
@group(1) @binding(0) var cube: texture_cube<f32>;
@group(1) @binding(1) var cube_sampler: sampler;
@group(2) @binding(0) var volume: texture_3d<f32>;
@group(2) @binding(1) var volume_sampler: sampler;
@group(3) @binding(0) var layers: texture_2d_array<f32>;
@group(3) @binding(1) var layer_sampler: sampler;

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
}

/// One corner of the quad: its place in the viewport, from the parameters' rectangle.
fn quad(vertex: u32) -> VertexOut {
    var corners = array<vec2f, 6>(
        vec2f(0.0, 0.0),
        vec2f(1.0, 0.0),
        vec2f(0.0, 1.0),
        vec2f(0.0, 1.0),
        vec2f(1.0, 0.0),
        vec2f(1.0, 1.0),
    );
    let corner = corners[vertex];
    let at = mix(params.rect_min, params.rect_max, corner);
    var out: VertexOut;
    out.clip = vec4f(at.x * 2.0 - 1.0, 1.0 - at.y * 2.0, 0.5, 1.0);
    out.uv = corner;
    return out;
}

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> VertexOut {
    return quad(vertex);
}

@vertex
fn vs_face(@builtin(vertex_index) vertex: u32) -> VertexOut {
    var out = quad(vertex);
#ifdef WEBGL2
    out.clip.y = -out.clip.y;
#endif
    return out;
}

/// The direction that reads texel coordinates (s, t) of a cube face, from the cube's face
/// selection rules, which WebGPU and WebGL2 share.
fn face_direction(face: u32, st: vec2f) -> vec3f {
    let a = st.x * 2.0 - 1.0;
    let b = st.y * 2.0 - 1.0;
    switch face {
        case 0u: {
            return vec3f(1.0, -b, -a);
        }
        case 1u: {
            return vec3f(-1.0, -b, a);
        }
        case 2u: {
            return vec3f(a, 1.0, b);
        }
        case 3u: {
            return vec3f(a, -1.0, -b);
        }
        case 4u: {
            return vec3f(a, -b, 1.0);
        }
        default: {
            return vec3f(-a, -b, -1.0);
        }
    }
}

@fragment
fn fs_solid() -> @location(0) vec4f {
    return params.color;
}

@fragment
fn fs_sample(in: VertexOut) -> @location(0) vec4f {
    var color = params.color;
    switch params.show {
        case SHOW_FACE: {
            let direction = face_direction(params.face, in.uv);
            color = textureSampleLevel(cube, cube_sampler, direction, params.lod);
        }
        case SHOW_SLICE: {
            let at = vec3f(in.uv, params.slice);
            color = textureSampleLevel(volume, volume_sampler, at, params.lod);
        }
        case SHOW_LAYER: {
            color = textureSampleLevel(layers, layer_sampler, in.uv, params.layer, params.lod);
        }
        default: {
            return color;
        }
    }
    return vec4f(color.rgb * params.scale, 1.0);
}

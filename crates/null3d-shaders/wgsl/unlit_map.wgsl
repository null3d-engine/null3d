enable draw_index;

// Meshes drawn by instance in their material's color times its map, as three.js's
// MeshBasicMaterial draws them with a `map`. The map is a layer of a texture array, read at the
// first texture coordinates. Materials whose maps share an array and a sampler share the maps'
// bind group, and each material's row in the material table gives its layer. A map whose image is
// not on the GPU yet has no layer, and the material draws as without it. The VERTEX_COLOR builds
// multiply the color by the mesh's vertex colors too. The ALPHA_MASK builds draw nothing where the
// alpha of the color, the map and the vertex colors falls below the material's cutoff. A material
// that blends writes premultiplied color, and takes a premultiplied map's colors as they are.
// null3d::mesh finds each instance on both GPU paths.
#import null3d::color
#import null3d::mesh::{InstanceIn, clip_of, find_instance, fogged, fragment_color}
#import null3d::mesh::{map_layer, map_ready, material_of, premultiplied_map, relative_position}

// The maps' bind group comes after the frame's group, and on WebGL2 after the groups of the draw
// records and the data textures.
#ifdef WEBGL2
@group(3) @binding(0) var map_layers: texture_2d_array<f32>;
@group(3) @binding(1) var map_sampler: sampler;
#else
@group(1) @binding(0) var map_layers: texture_2d_array<f32>;
@group(1) @binding(1) var map_sampler: sampler;
#endif

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(2) uv0: vec2f,
#ifdef VERTEX_COLOR
    @location(5) vertex_color: vec4f,
#endif
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) uv0: vec2f,
    @location(1) @interpolate(flat, either) material: u32,
#ifdef VERTEX_COLOR
    @location(2) vertex_color: vec4f,
#endif
    /// The position relative to the camera.
    @location(3) relative: vec3f,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.relative = relative_position(found, v.position);
    out.clip = clip_of(found, out.relative);
    out.uv0 = v.uv0;
    out.material = found.material;
#ifdef VERTEX_COLOR
    out.vertex_color = v.vertex_color;
#endif
    return out;
}

/// The base color times the map. Sampling decodes an sRGB map to linear values, and reads a
/// linear map as it is. The texture is sampled whether the map is ready or not, as sampling needs
/// the same control flow in every invocation, and a map that is not ready reads as white.
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let m = material_of(in.material);
    let texel = textureSample(map_layers, map_sampler, in.uv0, map_layer(m.maps.x));
    let map = select(vec4f(1.0), texel, map_ready(m.maps.x));
    var base = m.color.rgb * map.rgb;
    // The alpha besides the map's, which a premultiplied map's colors do not hold yet.
    var rest = m.color.a;
#ifdef VERTEX_COLOR
    base *= in.vertex_color.rgb;
    rest *= in.vertex_color.a;
#endif
    let alpha = rest * map.a;
#ifdef ALPHA_MASK
    if alpha < m.emissive.w {
        discard;
    }
#endif
    let color_alpha = select(alpha, rest, premultiplied_map(m));
    let encoded = null3d::color::linear_to_srgb(fogged(base, in.relative, m));
    return fragment_color(m, encoded, alpha, color_alpha);
}

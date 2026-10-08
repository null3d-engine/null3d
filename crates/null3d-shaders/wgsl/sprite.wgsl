enable draw_index;

// Sprites: the rows of a sprite batch drawn as quads that face the camera, as three.js's Sprite
// draws them with a SpriteMaterial. Each row's world matrix holds its sprite packed, as
// null3d_core::sprites lays it out: the size on the diagonal, the rotation, the color and the
// frame bits as small values, and the position relative to the camera in the last column. The mesh
// is a unit quad around the sprite's anchor, with texture coordinates from 0 to 1.
//
// A world-sized sprite moves each corner across the screen as three.js does: the corner, scaled by
// the size and turned by the rotation, moves the center's clip position by the projection's scale
// along x and y. A screen-sized sprite moves it by its size in CSS pixels, so it keeps its size on
// screen at every distance. The color is the material's color times the sprite's, and in the MAP
// builds times the map at the sprite's frame: the frame's column and row move the texture
// coordinates, and the material's texture coordinate transform scales them into the atlas. The
// ALPHA_MASK builds draw nothing where the alpha falls below the material's cutoff, the
// ALPHA_COVERAGE builds fade it there for alpha to coverage, and the ALPHA_HASH builds test it
// against the alpha hash (null3d::cutout), whose pattern stays on the quad, in the sprite's units.
// A material that blends writes premultiplied color. Fog takes the sprite's center, as three.js's
// fog depth does.
#import null3d::mesh::{InstanceIn, clip_of, exposed, find_instance, finish_exposed, fogged}
#import null3d::mesh::{fragment_color}
#import null3d::mesh::{frame as engine_frame, material_of}
#import null3d::vertex::{mesh_position, mesh_uv}
#ifdef MAP
#import null3d::mesh::{map_layer, map_ready, straight_texel}
#endif
#ifdef ALPHA_COVERAGE
#import null3d::cutout::{alpha_coverage}
#endif
#ifdef ALPHA_HASH
#import null3d::cutout::{alpha_hash_threshold}
#endif
#ifdef SAMPLE_MASK
#import null3d::cutout::{MaskedFragment, masked_fragment}
#endif

#ifdef MAP
// The maps' bind group comes after the frame's group, and on WebGL2 after the groups of the draw
// records and the data textures.
#ifdef WEBGL2
@group(3) @binding(0) var map_layers: texture_2d_array<f32>;
@group(3) @binding(1) var map_sampler: sampler;
#else
@group(1) @binding(0) var map_layers: texture_2d_array<f32>;
@group(1) @binding(1) var map_sampler: sampler;
#endif
#endif

/// The factor that undoes the packing of the colors and the rotation: 2^20.
const SMALL_INVERSE: f32 = 1048576.0;
/// The factor that undoes the packing of the frame bits: 2^32.
const BITS_INVERSE: f32 = 4294967296.0;
/// The frame bits: the column in the low bits, the row from the bottom above them, then the bit
/// of a sprite sized in pixels of the screen.
const FRAME_SHIFT: u32 = 11u;
const FRAME_MASK: u32 = 2047u;
const SCREEN_SIZE_BIT: u32 = 4194304u;

/// The vertex attributes that the template reads.
struct VertexIn {
    /// The quad's corner around the sprite's anchor, in units of the sprite's size.
    @location(0) position: vec3f,
    @location(2) uv0: vec2f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    /// The texture coordinates in the atlas's grid of frames: whole numbers pick the frame.
    @location(0) uv: vec2f,
    @location(1) @interpolate(flat, either) material: u32,
    /// The sprite's linear color.
    @location(2) color: vec4f,
    /// The sprite's center relative to the camera.
    @location(3) relative: vec3f,
#ifdef ALPHA_HASH
    /// The corner on the quad, in the sprite's units, where the alpha hash finds its pattern.
    @location(4) mesh_place: vec3f,
#endif
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    let center = vec3f(found.row_x.w, found.row_y.w, found.row_z.w);
    let size = vec2f(found.row_x.x, found.row_y.y);
    let rotation = found.row_x.y * SMALL_INVERSE;
    let bits = u32(round(found.row_x.z * BITS_INVERSE));
    let corner = mesh_position(v.position).xy * size;
    let c = cos(rotation);
    let s = sin(rotation);
    let turned = vec2f(c * corner.x - s * corner.y, s * corner.x + c * corner.y);

    var out: VertexOut;
    out.relative = center;
    var clip = clip_of(found, center);
    if (bits & SCREEN_SIZE_BIT) != 0u {
        clip = vec4f(clip.xy + turned * engine_frame.camera_range.zw * clip.w, clip.zw);
    } else {
        // The view-projection's first two rows are the camera's right and up axes times the
        // projection's scale along x and y.
        let m = engine_frame.view_proj;
        let scale = vec2f(
            length(vec3f(m[0].x, m[1].x, m[2].x)),
            length(vec3f(m[0].y, m[1].y, m[2].y)),
        );
        clip = vec4f(clip.xy + turned * scale, clip.zw);
    }
    out.clip = clip;
    let cell = vec2f(f32(bits & FRAME_MASK), f32((bits >> FRAME_SHIFT) & FRAME_MASK));
    out.uv = mesh_uv(v.uv0) + cell;
    out.material = found.material;
    out.color = vec4f(found.row_y.x, found.row_z.x, found.row_z.y, found.row_z.z) * SMALL_INVERSE;
#ifdef ALPHA_HASH
    out.mesh_place = vec3f(corner, 0.0);
#endif
    return out;
}

/// The material's color times the sprite's, times the map at the sprite's frame in the MAP builds.
/// Sampling decodes an sRGB map to linear values, and reads a linear map as it is.
@fragment
#ifdef SAMPLE_MASK
fn fs(in: VertexOut) -> MaskedFragment {
#else
fn fs(in: VertexOut) -> @location(0) vec4f {
#endif
    let m = material_of(in.material);
    var base = m.color.rgb * in.color.rgb;
    var alpha = m.color.a * in.color.a;
#ifdef MAP
    let raw = vec3f(in.uv, 1.0);
    let uv = vec2f(dot(m.uv_u.xyz, raw), dot(m.uv_v.xyz, raw));
    let texel = textureSample(map_layers, map_sampler, uv, map_layer(m.maps.x));
    let map = select(vec4f(1.0), straight_texel(m, texel), map_ready(m.maps.x));
    base *= map.rgb;
    alpha *= map.a;
#endif
#ifdef ALPHA_HASH
    if alpha < alpha_hash_threshold(in.mesh_place) {
        discard;
    }
#else ifdef ALPHA_COVERAGE
    alpha = alpha_coverage(alpha, fwidth(alpha), m.emissive.w);
    if alpha <= 0.0 {
        discard;
    }
#else ifdef ALPHA_MASK
    if alpha < m.emissive.w {
        discard;
    }
#endif
    let finished = finish_exposed(fogged(exposed(base), in.relative, m), in.clip.xy);
#ifdef SAMPLE_MASK
    return masked_fragment(vec4f(finished.rgb, alpha));
#else ifdef ALPHA_COVERAGE
    return vec4f(finished.rgb, alpha);
#else
    return fragment_color(m, finished.rgb, alpha);
#endif
}

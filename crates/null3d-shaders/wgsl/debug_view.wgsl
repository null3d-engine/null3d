enable draw_index;

// The debug views of development builds: meshes drawn by instance with one debug shading in place
// of their material's. The debug view bits pick the view:
//
// - none, normals: the world-space normal as a color, each axis from -1 to 1 as 0 to 1;
// - DEBUG_VIEW_LOW, depth: a gray, white at the camera's near plane and black at its far plane.
//   A perspective camera's distance takes a logarithmic scale, so near and far objects both show.
//   An orthographic camera's depth is linear already. The gray comes from the clip position that
//   the vertex shader passes on, the same in every depth mode, since compatibility mode cannot
//   read the depth target with textureLoad;
// - DEBUG_VIEW_HIGH, overdraw: a little warm light for each fragment, which the pipeline adds
//   without a depth test, so the pixels that many surfaces cover glow;
// - both bits, wireframe: lines in the material's base color, from each mesh's edge list;
// - DEBUG_VIEW_LEVELS and LOD_FADE, levels: one color for each level of detail, and a dither of
//   two colors where two levels hand over in a fading band. A source that the size rule or a draw
//   range hid draws at its base level in a striped marker color, so the view shows what the
//   culling dropped;
// - RECEIVE_SHADOWS, shadows: the main directional light's shadow factor as a gray, black in full
//   shadow and white in full light, so a pixel's value is the factor that lit shading multiplies
//   the sun's light by. A surface that faces away from the sun is black. With the low bit too, the surface shows no shadows and shows white: it
//   receives none, or with the high bit as well, its material takes no light.
//
// The engine draws debug views without tone mapping or exposure, so each color reaches the canvas
// as an sRGB color here gives it. null3d::mesh finds each instance on both GPU paths.
#import null3d::color::{srgb_to_linear}
#import null3d::mesh::{InstanceIn, clip_of, find_instance, finish, frame, material_of}
#import null3d::mesh::{relative_position, world_normal}
#import null3d::vertex::{mesh_position}
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_direction, skinned_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#endif
#ifdef RECEIVE_SHADOWS
#import null3d::shadows::{sun_shadow}
#endif
#ifdef LOD_FADE
#import null3d::mesh::{lod_hash, lod_kept}
#ifdef WEBGL2
#import null3d::mesh::{INDEX_ROW_SHIFT, draw_record, visible}
#endif
#endif

/// The light that each fragment adds in the overdraw view, as linear color.
const OVERDRAW_STEP: vec3f = vec3f(0.05, 0.025, 0.01);

/// The levels view's color for a level of detail, from the base mesh down, as sRGB. The levels
/// past the last one take the last color.
fn level_color(level: u32) -> vec3f {
    switch level {
        case 0u: { return vec3f(0.20, 0.45, 0.95); }
        case 1u: { return vec3f(0.20, 0.80, 0.35); }
        case 2u: { return vec3f(0.95, 0.85, 0.20); }
        case 3u: { return vec3f(0.95, 0.50, 0.15); }
        case 4u: { return vec3f(0.90, 0.20, 0.20); }
        case 5u: { return vec3f(0.85, 0.30, 0.80); }
        case 6u: { return vec3f(0.20, 0.85, 0.85); }
        default: { return vec3f(0.70, 0.70, 0.70); }
    }
}
/// The two sRGB colors of the levels view's marker for a source that the size rule or a draw
/// range hid. The marker alternates them in squares, so it reads as a mark rather than a level.
const HIDDEN_DARK: vec3f = vec3f(0.22, 0.0, 0.28);
const HIDDEN_LIGHT: vec3f = vec3f(1.0, 0.05, 0.85);

#ifdef LOD_FADE
/// The level code that the culling wrote beside the instance that this vertex shader invocation
/// draws: its level, a mark for a hidden source, the share of a fading band that it keeps and the
/// band's side. WebGPU carries it in the copy's fourth id, and WebGL2 in the word after the
/// instance's entry in the index list.
fn instance_level_code(i: InstanceIn) -> u32 {
#ifdef WEBGL2
    let record = draw_record(i);
    let index_row = (1u << INDEX_ROW_SHIFT) - 1u;
    let slot = record.x + i.instance * 2u + 1u;
    return textureLoad(visible, vec2u(slot & index_row, slot >> INDEX_ROW_SHIFT), 0).x;
#else
    return i.ids.w;
#endif
}
#endif

/// The vertex attributes that the template reads: every vertex format has both.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
#ifdef SKIN
    @location(6) joints: vec4u,
    @location(7) weights: vec4f,
#endif
#ifdef MORPH
    @location(8) morph: vec2f,
#endif
}

struct VertexOut {
    /// Invariant, so the depth prepass finds the same depth for each vertex as this template.
    @invariant @builtin(position) clip: vec4f,
    @location(0) normal: vec3f,
    /// The clip position's z and w, before any depth mode maps them.
    @location(1) depth: vec2f,
    @location(2) @interpolate(flat, either) material: u32,
    /// The position relative to the camera, which the shadows view looks up in the shadow map.
    @location(3) relative: vec3f,
#ifdef DEBUG_VIEW_LEVELS
#ifdef LOD_FADE
    /// The level code of the instance, and the phase of its dither in a fading band, which the
    /// levels view reads.
    @location(4) @interpolate(flat, either) level_code: u32,
    @location(5) @interpolate(flat, either) level_phase: u32,
#endif
#endif
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
#ifdef MORPH
    let rest = morph_vertex(found, v.morph, Morphed(mesh_position(v.position), v.normal, vec3f(0.0), vec4f(1.0)));
    let rest_position = rest.position;
    let rest_normal = rest.normal;
#else
    let rest_position = mesh_position(v.position);
    let rest_normal = v.normal;
#endif
#ifdef SKIN
    let skin = skin_of(found, v.joints, v.weights);
    out.relative = relative_position(found, skinned_point(skin, rest_position));
    out.normal = world_normal(found, skinned_direction(skin, rest_normal));
#else
    out.relative = relative_position(found, rest_position);
    out.normal = world_normal(found, rest_normal);
#endif
    out.clip = clip_of(found, out.relative);
    out.depth = out.clip.zw;
    out.material = found.material;
#ifdef DEBUG_VIEW_LEVELS
#ifdef LOD_FADE
    out.level_code = instance_level_code(i);
    out.level_phase = lod_hash(found.source);
#endif
#endif
    return out;
}

/// The depth view's gray: 1 at the near plane, 0 at the far plane.
fn depth_gray(depth: vec2f) -> f32 {
    let near = frame.camera_range.x;
    let far = frame.camera_range.y;
    // An orthographic camera's view rays are parallel, and its reversed depth is linear.
    if frame.camera_position.w == 0.0 {
        return clamp(depth.x / depth.y, 0.0, 1.0);
    }
    // A perspective camera's clip w is the distance along its view.
    let distance = max(depth.y, near);
    return clamp(1.0 - log(distance / near) / log(far / near), 0.0, 1.0);
}

/// The color of level `level`, or the striped marker of a source that the size rule or a draw
/// range hid, at `pixel`.
fn tint(level: u32, hidden: bool, pixel: vec2f) -> vec3f {
    if hidden {
        let cell = (u32(pixel.x) >> 2u) ^ (u32(pixel.y) >> 2u);
        return srgb_to_linear(select(HIDDEN_DARK, HIDDEN_LIGHT, (cell & 1u) == 0u));
    }
    return srgb_to_linear(level_color(level));
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
#ifdef DEBUG_VIEW_LEVELS
#ifdef LOD_FADE
    // The code's low bits name the level, its next bit marks a hidden source, and its upper bits
    // carry the share of the fading band that the level keeps, with the band's side.
    let level = in.level_code & 7u;
    let hidden = (in.level_code & 8u) != 0u;
    let share = f32((in.level_code >> 4u) & 63u) / 63.0;
    let fade = select(-share, share, (in.level_code & (1u << 10u)) == 0u);
    if !lod_kept(fade, in.clip.xy, in.level_phase) {
        discard;
    }
    let linear = tint(level, hidden, in.clip.xy);
#else
    // A levels view's keys always carry the fading bit, so this build never draws.
    let linear = vec3f(0.0);
#endif
#else
#ifdef RECEIVE_SHADOWS
#ifdef DEBUG_VIEW_LOW
    let lit = 1.0;
#else
    // A surface that faces away from the sun gets none of its light, so it shows full shadow, as
    // lit shading darkens it, and the depth tests of its own back faces never show.
    let normal = normalize(in.normal);
    let to_light = -frame.sun_direction.xyz;
    let lit = select(0.0, sun_shadow(in.relative, normal, normal, to_light), dot(normal, to_light) > 0.0);
#endif
    let linear = srgb_to_linear(vec3f(lit));
#else
#ifdef DEBUG_VIEW_HIGH
#ifdef DEBUG_VIEW_LOW
    let linear = material_of(in.material).color.rgb;
#else
    let linear = OVERDRAW_STEP;
#endif
#else
#ifdef DEBUG_VIEW_LOW
    let linear = srgb_to_linear(vec3f(depth_gray(in.depth)));
#else
    let linear = srgb_to_linear(normalize(in.normal) * 0.5 + 0.5);
#endif
#endif
#endif
#endif
    return finish(linear, in.clip.xy);
}

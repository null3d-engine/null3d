enable draw_index;

// The depth of shadow casters, drawn from a light into one cascade's layer of the shadow map or one
// tile of the shadow atlas. The frame's view-projection matrix is the cascade's or the tile's.
// null3d::mesh finds each instance, as it does for the lit templates, so casters stand exactly where
// they draw.
//
// A caster between the light and the cascade's box would fall outside the box's depth range and
// be clipped away. The vertex shader flattens it onto the box's face toward the light instead,
// where its depth of 1 hides everything behind it. Its place across the light does not change,
// because the cascade's projection is orthographic.
//
// Casters draw only their back faces, unless they are double-sided. A back face can lie on a
// receiver, as a box's bottom lies on the ground. The ground just past the box's foot then compares
// equal with the bottom in some of the filter's reads, and they come out lit, so a thin line of
// light shows at the foot. The CASTER_OFFSET builds move such faces toward the light, so that the
// box's bottom stays in front of the ground. A double-sided caster keeps its depth, because it
// holds its own lit side, which would then shadow itself. The frame's camera is the light: its
// position, or the direction toward it for the cascades' orthographic views. Its target size is
// the texels on each side of the cascade's layer or the tile.
//
// The PREPASS builds draw the depth of a camera's opaque objects before the opaque pass shades
// them, on WebGPU. They clip what lies in front of the camera's near plane, as the templates that
// shade do. The position is invariant, as in those templates, so both compute the same depth for
// the same vertex, and the opaque pass's test for equal depth passes on exactly the nearest
// surfaces. WebGL2 draws the prepass with each mesh template's own vertex shader, because there two
// programs can give different depths although both mark the position invariant.
//
// The CUTOUT builds draw masked casters, so masked surfaces cut holes in their shadows. Each
// fragment tests its alpha as the caster's material tests it: the opacity, times the vertex alpha
// in the VERTEX_COLOR builds and the base color map's alpha in the MAP builds, against the cutoff
// in the ALPHA_MASK builds, or against the alpha hash in the ALPHA_HASH builds, whose pattern then
// takes the light's pixels. Alpha to coverage casts at its cutoff, where its fade starts.
#import null3d::mesh::{InstanceIn, clip_of, find_instance, frame, relative_position, world_normal}
#import null3d::vertex::{mesh_position}
#ifdef CUTOUT
#import null3d::mesh::{material_of}
#endif
#ifdef MAP
#import null3d::mesh::{map_layer, map_ready}
#import null3d::vertex::{mesh_second_uv, mesh_uv}
#endif
#ifdef ALPHA_HASH
#import null3d::cutout::{alpha_hash_threshold}
#endif
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_direction, skinned_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#endif

/// How far a back face that faces straight away from the light moves toward it, in texels of the
/// map where it stands.
const CASTER_OFFSET_TEXELS: f32 = 1.0;
/// The most that a back face moves, in meters. A floor that casts shadows compares its lit top with
/// its own bottom, so a larger offset in a far cascade's coarse texels would shadow the top of a
/// floor 20 cm thick.
const CASTER_OFFSET_MAX: f32 = 0.05;

#ifdef MAP
// The map's bind group comes after the frame's group, and on WebGL2 after the groups of the draw
// records and the data textures.
#ifdef WEBGL2
@group(3) @binding(0) var map_layers: texture_2d_array<f32>;
@group(3) @binding(1) var map_sampler: sampler;
#else
@group(1) @binding(0) var map_layers: texture_2d_array<f32>;
@group(1) @binding(1) var map_sampler: sampler;
#endif

/// The bit of a material's flags for a base color map on the second texture coordinates.
const SECOND_UV: u32 = 256u;
#endif

/// The vertex attributes that the template reads: every vertex format has the first two.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
#ifdef MAP
    @location(2) uv0: vec2f,
    /// The second texture coordinates, or the first on a mesh without a second set.
    @location(3) uv1: vec2f,
#endif
#ifdef VERTEX_COLOR
    @location(5) vertex_color: vec4f,
#endif
#ifdef SKIN
    @location(6) joints: vec4u,
    @location(7) weights: vec4f,
#endif
#ifdef MORPH
    @location(8) morph: vec2f,
#endif
}

#ifdef CUTOUT
/// What a masked caster's fragments read to test their alpha.
struct VertexOut {
    @invariant @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) material: u32,
#ifdef MAP
    /// The first texture coordinates, then the second.
    @location(1) uv: vec4f,
#endif
#ifdef VERTEX_COLOR
    @location(2) vertex_alpha: f32,
#endif
#ifdef ALPHA_HASH
    /// The position in the mesh's own space, where the alpha hash finds its pattern.
    @location(3) mesh_place: vec3f,
#endif
}
#endif

@vertex
#ifdef CUTOUT
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
#else
fn vs(v: VertexIn, i: InstanceIn) -> @invariant @builtin(position) vec4f {
#endif
    let found = find_instance(i);
#ifdef MORPH
    let rest = morph_vertex(found, v.morph, Morphed(mesh_position(v.position), v.normal, vec3f(0.0)));
    let rest_position = rest.position;
    let rest_normal = rest.normal;
#else
    let rest_position = mesh_position(v.position);
    let rest_normal = v.normal;
#endif
#ifdef SKIN
    let skin = skin_of(found, v.joints, v.weights);
    let position = skinned_point(skin, rest_position);
    let normal = skinned_direction(skin, rest_normal);
#else
    let position = rest_position;
    let normal = rest_normal;
#endif
    let relative = relative_position(found, position);
    var clip = clip_of(found, relative);
#ifdef CASTER_OFFSET
    // A texel spans two clip units over the map's texels across. The first row of the matrix turns
    // that into meters, at the caster's distance from a spot or point light.
    let m = frame.view_proj;
    let texel = 2.0 * clip.w * frame.target_size.z / length(vec3f(m[0].x, m[1].x, m[2].x));
    let light = frame.camera_position;
    let toward = normalize(light.xyz - relative * light.w);
    // A face that lies on a receiver faces away from the light as squarely as the receiver faces
    // it, and the share squared moves it. A face seen nearly edge-on from the light moves little,
    // so the caster's lit faces beside it keep their light up to the edge.
    let away = clamp(-dot(world_normal(found, normal), toward), 0.0, 1.0);
    let offset = min(CASTER_OFFSET_TEXELS * away * away * texel, CASTER_OFFSET_MAX);
    clip = clip_of(found, relative + toward * offset);
#endif
#ifndef PREPASS
    clip.z = min(clip.z, clip.w);
#endif
#ifdef CUTOUT
    var out: VertexOut;
    out.clip = clip;
    out.material = found.material;
#ifdef MAP
    out.uv = vec4f(mesh_uv(v.uv0), mesh_second_uv(v.uv1));
#endif
#ifdef VERTEX_COLOR
    out.vertex_alpha = v.vertex_color.a;
#endif
#ifdef ALPHA_HASH
    out.mesh_place = mesh_position(v.position);
#endif
    return out;
#else
    return clip;
#endif
}

#ifdef CUTOUT
/// Writes no color, and keeps the depth of the fragments whose alpha passes the material's test.
/// The map is sampled whether it is ready or not, as sampling needs the same control flow in every
/// invocation, and a map that is not ready counts as opaque.
@fragment
fn fs(in: VertexOut) {
    let m = material_of(in.material);
    var alpha = m.color.a;
#ifdef VERTEX_COLOR
    alpha *= in.vertex_alpha;
#endif
#ifdef MAP
    let second = (u32(m.strengths.z) & SECOND_UV) != 0u;
    let raw = vec3f(select(in.uv.xy, in.uv.zw, second), 1.0);
    let uv = vec2f(dot(m.uv_u.xyz, raw), dot(m.uv_v.xyz, raw));
    let texel = textureSample(map_layers, map_sampler, uv, map_layer(m.maps.x));
    alpha *= select(1.0, texel.a, map_ready(m.maps.x));
#endif
#ifdef ALPHA_HASH
    if alpha < alpha_hash_threshold(in.mesh_place) {
        discard;
    }
#else ifdef ALPHA_MASK
    if alpha < m.emissive.w {
        discard;
    }
#endif
}
#else
/// Writes no color: the pass keeps the depth alone.
@fragment
fn fs() {
}
#endif

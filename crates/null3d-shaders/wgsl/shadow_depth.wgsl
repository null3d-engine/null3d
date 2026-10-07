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
#import null3d::mesh::{InstanceIn, clip_of, find_instance, frame, relative_position, world_normal}
#import null3d::vertex::{mesh_position}
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

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> @invariant @builtin(position) vec4f {
    let found = find_instance(i);
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
    return clip;
}

/// Writes no color: the pass keeps the depth alone.
@fragment
fn fs() {
}

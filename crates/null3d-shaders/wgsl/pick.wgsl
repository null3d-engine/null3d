// GPU picking: each object of the camera's view drawn with the camera's view-projection, writing
// the object's id and the row of its batch where the scene's depth leaves it. A pick pass runs
// after the opaque pass and draws into a small id target, its scissor around the pointer, with the
// scene's depth as its depth target and an EQUAL test that writes no depth. So a pixel takes the id
// of the object that owns the depth there, and a fragment that a material's mask discarded (which
// wrote no depth) never matches: masked objects pick by their mask, not by their whole geometry.
//
// null3d::mesh finds each instance exactly as the templates that shade do, so the position matches
// the scene's depth to the last bit, which the EQUAL test needs. The instance's id comes from the
// table of object ranges (`object_ids`): the object's slot for a scene object, the batch's id for a
// row of an instance batch. The fragment writes the object's id in red and the row in green, so a
// 32-bit id and its row read back in one texel.
//
// On WebGL2, exact equality across two programs is not certain. In Chrome on the Mac (ANGLE on
// Metal), the depth template's prepass build and the shading programs gave positions a rounding
// step apart, though every program marks its position invariant (decision record D-43). So before
// a frame emits the pick pass, a page that reads back its own picks must show that this template
// matches the scene's depth on WebGL2 there. Where it does not, the pass needs a test with a small
// bias toward the camera, as the outline mask's (decision record D-36), and the mask's alpha test
// in this template.
//
// The SKIN builds skin each vertex with the joint texture, as WebGL2 and the other engine templates
// do, so a skinned character picks where it draws. The MORPH builds, which only WebGL2 has, add a
// morphed mesh's deltas first, as the lit templates' MORPH builds do; WebGPU morphs in the
// skinning pass. A custom material's vertex offset moves its vertices where this template cannot
// follow, so such a material picks with its own PICK builds (lit.wgsl). A full shader of a sketch's
// own places its vertices as it likes, so the pass leaves its objects out.
#import null3d::mesh::{InstanceIn, clip_of, find_instance, object_ids, relative_position}
#import null3d::vertex::{mesh_position}
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#endif

/// The vertex attributes that the template reads. The mask's and the material's values are not
/// needed: the scene's depth already holds where each object draws.
struct VertexIn {
    @location(0) position: vec3f,
#ifdef SKIN
    @location(6) joints: vec4u,
    @location(7) weights: vec4f,
#endif
#ifdef MORPH
    @location(8) morph: vec2f,
#endif
}

/// The vertex's clip position and the instance's id and row, which the fragment writes.
struct VertexOut {
    @invariant @builtin(position) position: vec4f,
    @location(0) @interpolate(flat, either) ids: vec2u,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
#ifdef MORPH
    let source = Morphed(mesh_position(v.position), vec3f(0.0), vec3f(0.0), vec4f(1.0));
    let rest_position = morph_vertex(found, v.morph, source).position;
#else
    let rest_position = mesh_position(v.position);
#endif
#ifdef SKIN
    let position = skinned_point(skin_of(found, v.joints, v.weights), rest_position);
#else
    let position = rest_position;
#endif
    var out: VertexOut;
    out.position = clip_of(found, relative_position(found, position));
    out.ids = object_ids(found);
    return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4u {
    // Red: the object's or the batch's id. Green: the instance's row within its batch, 0 for an
    // object of the scene.
    return vec4u(in.ids.y, in.ids.x, 0u, 0u);
}

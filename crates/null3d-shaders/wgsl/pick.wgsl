// GPU picking: each object of the camera's view drawn with the camera's view-projection, writing
// the source key of the object or of the instance's row where the scene's depth leaves it. A pick
// pass runs after the opaque pass and draws into an id target the size of the render size, with
// the scene's depth as its depth target and a test that writes no depth. So a pixel takes the key
// of the object that owns the depth there, and a fragment that a material's mask discarded (which
// wrote no depth) never matches: masked objects pick by their mask, not by their whole geometry.
//
// null3d::mesh finds each instance exactly as the templates that shade do, so the position matches
// the scene's depth to the last bit, which the test needs. The fragment writes the source key as
// four bytes, which an 8-bit target stores as the bytes themselves. The sketch turns the key into
// an object or a batch and a row.
//
// On WebGL2, exact equality across two programs is not certain. In Chrome on the Mac (ANGLE on
// Metal), the depth template's prepass build and the shading programs gave positions a rounding
// step apart, though every program marks its position invariant (decision record D-43). The
// WebGL2 pipeline therefore tests for a nearer depth with a small bias toward the camera, as the
// outline mask's does (decision record D-36), so the surface that wrote the depth passes.
//
// The SKIN builds skin each vertex with the joint texture, as WebGL2 and the other engine templates
// do, so a skinned character picks where it draws. The MORPH builds, which only WebGL2 has, add the
// morph targets' deltas before that, as its shading templates do, so a morphed mesh picks where it
// draws too. A mesh drawn with a material that moves its vertices in its own WGSL has no build
// here: the material's own template has pick builds when it moves vertices only by its vertex
// offset, and otherwise the scene query answers it with a raycast.
#import null3d::mesh::{Instance, InstanceIn, clip_of, find_instance, relative_position}
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

/// The key of an instance's source: its slot for an object of the scene, or its row of the data
/// texture that the object ranges name, marked for a streamed row. The sketch turns the key back
/// into an object and a row.
fn pick_key(found: Instance) -> u32 {
#ifdef WEBGL2
    // The bit above every resident row marks a row of the streamed data texture.
    return found.source | select(0u, 1u << 31u, found.streamed);
#else
    return found.source;
#endif
}

/// The color that the id target holds for a source key: its four bytes, each as the fraction an
/// 8-bit target stores. The four bytes read back as the key itself.
fn pick_color(key: u32) -> vec4f {
    let bytes = vec4u(
        (key >> 24u) & 0xffu,
        (key >> 16u) & 0xffu,
        (key >> 8u) & 0xffu,
        key & 0xffu,
    );
    return vec4f(bytes) / 255.0;
}

/// The vertex's clip position and the source key, which the fragment writes.
struct VertexOut {
    @invariant @builtin(position) position: vec4f,
    @location(0) @interpolate(flat, either) key: u32,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
#ifdef MORPH
    // Only the position matters here, so the normal and the tangent enter as zero.
    let rest = morph_vertex(
        found,
        v.morph,
        Morphed(mesh_position(v.position), vec3f(0.0), vec3f(0.0), vec4f(1.0)),
    );
    let rest_position = rest.position;
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
    out.key = pick_key(found);
    return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    return pick_color(in.key);
}

enable draw_index;

// Meshes drawn by instance in their material's color alone, as three.js's MeshBasicMaterial draws
// them, times the mesh's vertex colors in the VERTEX_COLOR builds. The ALPHA_MASK builds draw
// nothing where the alpha falls below the material's cutoff, the ALPHA_COVERAGE builds fade it
// there for alpha to coverage, and the ALPHA_HASH builds test it against the alpha hash
// (null3d::cutout). A material that blends writes premultiplied color. null3d::mesh finds each instance on both GPU paths.
#import null3d::mesh::{InstanceIn, clip_of, exposed, find_instance, finish_exposed, fogged}
#import null3d::mesh::{fragment_color}
#import null3d::mesh::{material_of, relative_position}
#import null3d::vertex::{mesh_position}
#ifdef ALPHA_COVERAGE
#import null3d::cutout::{alpha_coverage}
#endif
#ifdef ALPHA_HASH
#import null3d::cutout::{alpha_hash_threshold}
#endif
#ifdef SAMPLE_MASK
#import null3d::cutout::{MaskedFragment, masked_fragment}
#endif
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_direction, skinned_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#endif

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
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

struct VertexOut {
    /// Invariant, so the depth prepass finds the same depth for each vertex as this template.
    @invariant @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) material: u32,
#ifdef VERTEX_COLOR
    @location(1) vertex_color: vec4f,
#endif
    /// The position relative to the camera.
    @location(2) relative: vec3f,
#ifdef ALPHA_HASH
    /// The position in the mesh's own space, where the alpha hash finds its pattern.
    @location(3) mesh_place: vec3f,
#endif
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
#ifdef MORPH
    let rest = morph_vertex(found, v.morph, Morphed(mesh_position(v.position), vec3f(0.0), vec3f(0.0)));
    let rest_position = rest.position;
#else
    let rest_position = mesh_position(v.position);
#endif
#ifdef SKIN
    let skin = skin_of(found, v.joints, v.weights);
    let position = skinned_point(skin, rest_position);
#else
    let position = rest_position;
#endif
    out.relative = relative_position(found, position);
    out.clip = clip_of(found, out.relative);
    out.material = found.material;
#ifdef VERTEX_COLOR
    out.vertex_color = v.vertex_color;
#endif
#ifdef ALPHA_HASH
    out.mesh_place = mesh_position(v.position);
#endif
    return out;
}

@fragment
#ifdef SAMPLE_MASK
fn fs(in: VertexOut) -> MaskedFragment {
#else
fn fs(in: VertexOut) -> @location(0) vec4f {
#endif
    let m = material_of(in.material);
    var base = m.color.rgb;
    var alpha = m.color.a;
#ifdef VERTEX_COLOR
    base *= in.vertex_color.rgb;
    alpha *= in.vertex_color.a;
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

enable draw_index;

// Meshes drawn by instance in their material's color alone, as three.js's MeshBasicMaterial draws
// them, times the mesh's vertex colors in the VERTEX_COLOR builds. The ALPHA_MASK builds draw
// nothing where the alpha falls below the material's cutoff, and a material that blends writes
// premultiplied color. null3d::mesh finds each instance on both GPU paths.
#import null3d::mesh::{InstanceIn, clip_of, find_instance, finish, fogged, fragment_color}
#import null3d::mesh::{material_of, relative_position}

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
#ifdef VERTEX_COLOR
    @location(5) vertex_color: vec4f,
#endif
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) material: u32,
#ifdef VERTEX_COLOR
    @location(1) vertex_color: vec4f,
#endif
    /// The position relative to the camera.
    @location(2) relative: vec3f,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.relative = relative_position(found, v.position);
    out.clip = clip_of(found, out.relative);
    out.material = found.material;
#ifdef VERTEX_COLOR
    out.vertex_color = v.vertex_color;
#endif
    return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let m = material_of(in.material);
    var base = m.color.rgb;
    var alpha = m.color.a;
#ifdef VERTEX_COLOR
    base *= in.vertex_color.rgb;
    alpha *= in.vertex_color.a;
#endif
#ifdef ALPHA_MASK
    if alpha < m.emissive.w {
        discard;
    }
#endif
    let finished = finish(fogged(base, in.relative, m), in.clip.xy);
    return fragment_color(m, finished.rgb, alpha);
}

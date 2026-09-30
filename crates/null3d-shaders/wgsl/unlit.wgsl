enable draw_index;

// Meshes drawn by instance in their material's color alone, as three.js's MeshBasicMaterial draws
// them, times the mesh's vertex colors in the VERTEX_COLOR builds. The ALPHA_MASK builds draw
// nothing where the alpha falls below the material's cutoff. null3d::mesh finds each instance on
// both GPU paths.
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish, material_of}

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
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.clip = clip_position(found, v.position);
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
    return finish(base, in.clip.xy);
}

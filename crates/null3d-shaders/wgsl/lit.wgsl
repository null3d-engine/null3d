enable draw_index;

// Meshes drawn by instance with the standard material: glTF's metallic-roughness model, shaded
// with the formulas of three.js's MeshStandardMaterial. null3d::mesh finds each instance on both
// GPU paths, and null3d::lighting holds the formulas. `light_surface` gathers the scene's lights,
// so the rest of the shader does not change with where the lights come from. The ALPHA_MASK builds
// draw nothing where the surface's alpha falls below the material's cutoff.
#import null3d::lighting
#import null3d::mesh::{InstanceIn, clip_of, find_instance, finish, fogged, frame, material_of}
#import null3d::mesh::{relative_position, world_normal}

/// The bit of a material's flags that lights each triangle with its face's normal.
const FLAT_SHADING: u32 = 1u;

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
#ifdef VERTEX_COLOR
    @location(5) vertex_color: vec4f,
#endif
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    /// The position relative to the camera.
    @location(0) relative: vec3f,
    @location(1) normal: vec3f,
    @location(2) @interpolate(flat, either) material: u32,
#ifdef VERTEX_COLOR
    @location(3) vertex_color: vec4f,
#endif
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.relative = relative_position(found, v.position);
    out.clip = clip_of(found, out.relative);
    out.normal = world_normal(found, v.normal);
    out.material = found.material;
#ifdef VERTEX_COLOR
    out.vertex_color = v.vertex_color;
#endif
    return out;
}

/// The light that a surface reflects toward the camera from the scene's lights: the sun and the
/// ambient light. `to_view` points from the surface toward the camera, and `dfg` holds the
/// split-sum terms at the surface's roughness and view angle.
fn light_surface(
    m: null3d::lighting::PbrMaterial,
    normal: vec3f,
    to_view: vec3f,
    dfg: vec2f,
) -> vec3f {
    let compensation = null3d::lighting::multiscatter_compensation(m.specular_blended, dfg);
    let sun = null3d::lighting::direct_light(
        m,
        normal,
        to_view,
        -frame.sun_direction.xyz,
        frame.sun_color.rgb,
        compensation,
    );
    let ambient = null3d::lighting::indirect_diffuse(m, frame.ambient.rgb, dfg);
    return sun.diffuse + sun.specular + ambient;
}

@fragment
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    let m = material_of(in.material);
    var base = m.color.rgb;
    var alpha = m.color.a;
#ifdef VERTEX_COLOR
    base *= in.vertex_color.rgb;
    alpha *= in.vertex_color.a;
#endif
    // Toward the camera: from the point for a perspective camera, and one direction for an
    // orthographic camera, whose view rays are parallel.
    let to_view = normalize(frame.camera_position.xyz - in.relative * frame.camera_position.w);
    // A face's normal comes from how the position changes between pixels. The two GPU paths count
    // pixel rows in opposite directions, so the normal is turned to face the camera, as three.js's
    // flat normals face it.
    let face = normalize(cross(dpdx(in.relative), dpdy(in.relative)));
    let face_normal = select(-face, face, dot(face, to_view) >= 0.0);
    // Back faces draw only for double-sided materials, and light as front faces do.
    let smooth_normal = normalize(in.normal) * select(-1.0, 1.0, front);
    let use_face = (u32(m.strengths.z) & FLAT_SHADING) != 0u;
    let normal = select(smooth_normal, face_normal, use_face);
    // Where the normal changes fast between pixels, highlights soften, as three.js softens them.
    let change = max(abs(dpdx(normal)), abs(dpdy(normal)));
    let geometry_roughness = max(max(change.x, change.y), change.z);
    let pbr = null3d::lighting::pbr_material(base, m.surface.x, m.surface.y, geometry_roughness);
    let n_dot_v = saturate(dot(normal, to_view));
    let dfg = null3d::lighting::dfg_lut(n_dot_v, pbr.roughness);
    let emitted = m.emissive.rgb * m.strengths.w;
    let outgoing = light_surface(pbr, normal, to_view, dfg) + emitted;
    // The test comes last, after every derivative, which a discarded fragment still helps compute.
#ifdef ALPHA_MASK
    if alpha < m.emissive.w {
        discard;
    }
#endif
    return finish(fogged(outgoing, in.relative, m), in.clip.xy);
}

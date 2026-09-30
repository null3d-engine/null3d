enable draw_index;

// Meshes drawn by instance with the standard material: glTF's metallic-roughness model, shaded
// with the formulas of three.js's MeshStandardMaterial. null3d::mesh finds each instance on both
// GPU paths, and null3d::lighting holds the formulas. `light_surface` gathers the scene's lights,
// so the rest of the shader does not change with where the lights come from.
//
// The MAPS builds sample the material's texture maps: base color, metal-rough, normal, occlusion,
// emissive and light maps, each a layer of a texture array with a sampler of its own. A map reads
// the first texture coordinates, or the second where the material's flags say so, through the
// material's texture coordinate transform. A map whose image is not on the GPU yet has no layer,
// and the material draws as without it. The normal map bends the normal in a frame from the mesh's
// tangents with VERTEX_TANGENT, and otherwise from how the position and the texture coordinates
// change between pixels, as three.js's getTangentFrame makes it.
#import null3d::color
#import null3d::lighting
#import null3d::mesh::{InstanceIn, clip_of, find_instance, frame, material_of}
#import null3d::mesh::{map_layer, map_ready, relative_position, world_direction, world_normal}

/// The bit of a material's flags that lights each triangle with its face's normal.
const FLAT_SHADING: u32 = 1u;

#ifdef MAPS
/// The bit of a material's flags for the map of slot 0 on the second texture coordinates; the
/// next slots take the bits above it.
const SECOND_UV: u32 = 2u;

// The maps' bind group comes after the frame's group, and on WebGL2 after the groups of the draw
// records and the data textures: each slot's texture array, then each slot's sampler.
#ifdef WEBGL2
@group(3) @binding(0) var base_color_map: texture_2d_array<f32>;
@group(3) @binding(1) var metal_rough_map: texture_2d_array<f32>;
@group(3) @binding(2) var normal_map: texture_2d_array<f32>;
@group(3) @binding(3) var occlusion_map: texture_2d_array<f32>;
@group(3) @binding(4) var emissive_map: texture_2d_array<f32>;
@group(3) @binding(5) var light_map: texture_2d_array<f32>;
@group(3) @binding(6) var base_color_sampler: sampler;
@group(3) @binding(7) var metal_rough_sampler: sampler;
@group(3) @binding(8) var normal_sampler: sampler;
@group(3) @binding(9) var occlusion_sampler: sampler;
@group(3) @binding(10) var emissive_sampler: sampler;
@group(3) @binding(11) var light_sampler: sampler;
#else
@group(1) @binding(0) var base_color_map: texture_2d_array<f32>;
@group(1) @binding(1) var metal_rough_map: texture_2d_array<f32>;
@group(1) @binding(2) var normal_map: texture_2d_array<f32>;
@group(1) @binding(3) var occlusion_map: texture_2d_array<f32>;
@group(1) @binding(4) var emissive_map: texture_2d_array<f32>;
@group(1) @binding(5) var light_map: texture_2d_array<f32>;
@group(1) @binding(6) var base_color_sampler: sampler;
@group(1) @binding(7) var metal_rough_sampler: sampler;
@group(1) @binding(8) var normal_sampler: sampler;
@group(1) @binding(9) var occlusion_sampler: sampler;
@group(1) @binding(10) var emissive_sampler: sampler;
@group(1) @binding(11) var light_sampler: sampler;
#endif

/// Pixel rows count upward on WebGL2 and downward on WebGPU, so derivatives along y take this
/// sign to follow three.js, which counts them upward.
#ifdef WEBGL2
const ROWS_UP: f32 = 1.0;
#else
const ROWS_UP: f32 = -1.0;
#endif

/// Where a map reads: texture coordinates, and how they change across a pixel and up a row.
struct MapUv {
    uv: vec2f,
    dx: vec2f,
    dy: vec2f,
}

/// The coordinates of the map of `slot`: the second set where the flags say so, else the first.
fn map_uv(flags: u32, slot: u32, first: MapUv, second: MapUv) -> MapUv {
    if (flags & (SECOND_UV << slot)) != 0u {
        return second;
    }
    return first;
}

/// Texture coordinates through the material's transform, with their derivatives.
fn transformed_uv(uv: vec2f, uv_u: vec4f, uv_v: vec4f) -> MapUv {
    let at = vec2f(dot(uv_u.xyz, vec3f(uv, 1.0)), dot(uv_v.xyz, vec3f(uv, 1.0)));
    return MapUv(at, dpdx(at), dpdy(at));
}
#endif

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
#ifdef MAPS
    @location(2) uv0: vec2f,
    /// The second texture coordinates, or the first on a mesh without a second set.
    @location(3) uv1: vec2f,
#endif
#ifdef VERTEX_TANGENT
    @location(4) tangent: vec4f,
#endif
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
#ifdef MAPS
    /// The first texture coordinates, then the second.
    @location(4) uv: vec4f,
#endif
#ifdef VERTEX_TANGENT
    @location(5) tangent: vec3f,
    @location(6) bitangent: vec3f,
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
#ifdef MAPS
    out.uv = vec4f(v.uv0, v.uv1);
#endif
#ifdef VERTEX_TANGENT
    // As three.js does: the tangent through the world matrix, and the bitangent at right angles
    // to the normal and the tangent, on the side that the tangent's w gives.
    let tangent = normalize(world_direction(found, v.tangent.xyz));
    out.tangent = tangent;
    out.bitangent = normalize(cross(out.normal, tangent) * v.tangent.w);
#endif
    return out;
}

/// The light that a surface reflects toward the camera from the scene's lights: the sun, the
/// ambient light, and `extra` irradiance such as a light map's, which `occlusion` darkens with the
/// ambient light. `to_view` points from the surface toward the camera, and `dfg` holds the
/// split-sum terms at the surface's roughness and view angle.
fn light_surface(
    m: null3d::lighting::PbrMaterial,
    normal: vec3f,
    to_view: vec3f,
    dfg: vec2f,
    extra: vec3f,
    occlusion: f32,
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
    let ambient = null3d::lighting::indirect_diffuse(m, frame.ambient.rgb + extra, dfg);
    return sun.diffuse + sun.specular + ambient * occlusion;
}

@fragment
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    let m = material_of(in.material);
    let flags = u32(m.strengths.z);
    var base = m.color.rgb;
#ifdef VERTEX_COLOR
    base *= in.vertex_color.rgb;
#endif
    var metalness = m.surface.x;
    var roughness = m.surface.y;
    var emitted = m.emissive.rgb * m.strengths.w;
    var extra = vec3f(0.0);
    var occlusion = 1.0;
    // Toward the camera: from the point for a perspective camera, and one direction for an
    // orthographic camera, whose view rays are parallel.
    let to_view = normalize(frame.camera_position.xyz - in.relative * frame.camera_position.w);
    // A face's normal comes from how the position changes between pixels. The two GPU paths count
    // pixel rows in opposite directions, so the normal is turned to face the camera, as three.js's
    // flat normals face it.
    let face = normalize(cross(dpdx(in.relative), dpdy(in.relative)));
    let face_normal = select(-face, face, dot(face, to_view) >= 0.0);
    // Back faces draw only for double-sided materials, and light as front faces do.
    let facing = select(-1.0, 1.0, front);
    let smooth_normal = normalize(in.normal) * facing;
    let use_face = (flags & FLAT_SHADING) != 0u;
    var normal = select(smooth_normal, face_normal, use_face);
    // Where the normal changes fast between pixels, highlights soften, as three.js softens them.
    let change = max(abs(dpdx(normal)), abs(dpdy(normal)));
    let geometry_roughness = max(max(change.x, change.y), change.z);
#ifdef MAPS
    // The coordinates' derivatives come first, where every pixel of the quad runs them; each map
    // then samples with them inside its branch.
    let first = transformed_uv(in.uv.xy, m.uv_u, m.uv_v);
    let second = transformed_uv(in.uv.zw, m.uv_u, m.uv_v);
    let position_dy = dpdy(in.relative) * ROWS_UP;
    let position_dx = dpdx(in.relative);
    if map_ready(m.maps.x) {
        let at = map_uv(flags, 0u, first, second);
        let texel = textureSampleGrad(
            base_color_map,
            base_color_sampler,
            at.uv,
            map_layer(m.maps.x),
            at.dx,
            at.dy,
        );
        base *= texel.rgb;
    }
    if map_ready(m.maps.y) {
        let at = map_uv(flags, 1u, first, second);
        let layer = map_layer(m.maps.y);
        let texel = textureSampleGrad(metal_rough_map, metal_rough_sampler, at.uv, layer, at.dx, at.dy);
        roughness *= texel.g;
        metalness *= texel.b;
    }
    if map_ready(m.maps.w) {
        let at = map_uv(flags, 3u, first, second);
        let layer = map_layer(m.maps.w);
        let texel = textureSampleGrad(occlusion_map, occlusion_sampler, at.uv, layer, at.dx, at.dy);
        occlusion = (texel.r - 1.0) * m.strengths.x + 1.0;
    }
    if map_ready(m.more_maps.x) {
        let at = map_uv(flags, 4u, first, second);
        let layer = map_layer(m.more_maps.x);
        let texel = textureSampleGrad(emissive_map, emissive_sampler, at.uv, layer, at.dx, at.dy);
        emitted *= texel.rgb;
    }
    if map_ready(m.more_maps.y) {
        let at = map_uv(flags, 5u, first, second);
        let layer = map_layer(m.more_maps.y);
        let texel = textureSampleGrad(light_map, light_sampler, at.uv, layer, at.dx, at.dy);
        extra = texel.rgb * m.strengths.y;
    }
    if map_ready(m.maps.z) {
        let at = map_uv(flags, 2u, first, second);
        let layer = map_layer(m.maps.z);
        let texel = textureSampleGrad(normal_map, normal_sampler, at.uv, layer, at.dx, at.dy);
        let bent = vec3f((texel.xy * 2.0 - 1.0) * m.surface.zw, texel.z * 2.0 - 1.0);
#ifdef VERTEX_TANGENT
        let tangent = normalize(in.tangent) * facing;
        let bitangent = normalize(in.bitangent) * facing;
#else
        // three.js's getTangentFrame, with rows counted upward.
        let q1perp = cross(position_dy, normal);
        let q0perp = cross(normal, position_dx);
        let st_dy = at.dy * ROWS_UP;
        var tangent = q1perp * at.dx.x + q0perp * st_dy.x;
        var bitangent = q1perp * at.dx.y + q0perp * st_dy.y;
        let det = max(dot(tangent, tangent), dot(bitangent, bitangent));
        let scale = select(inverseSqrt(det), 0.0, det == 0.0);
        tangent *= scale * facing;
        bitangent *= scale * facing;
#endif
        normal = normalize(tangent * bent.x + bitangent * bent.y + normal * bent.z);
    }
#endif
    let pbr = null3d::lighting::pbr_material(base, metalness, roughness, geometry_roughness);
    let n_dot_v = saturate(dot(normal, to_view));
    let dfg = null3d::lighting::dfg_lut(n_dot_v, pbr.roughness);
    let outgoing = light_surface(pbr, normal, to_view, dfg, extra, occlusion) + emitted;
    return vec4f(null3d::color::linear_to_srgb(outgoing), 1.0);
}

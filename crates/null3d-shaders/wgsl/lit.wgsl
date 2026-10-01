enable draw_index;

// Meshes drawn by instance with the standard material: glTF's metallic-roughness model, shaded
// with the formulas of three.js's MeshStandardMaterial. null3d::mesh finds each instance on both
// GPU paths, and null3d::lighting holds the formulas. `light_surface` gathers the scene's lights,
// so the rest of the shader does not change with where the lights come from.
//
// The fragment shader works in two steps. First a surface function fills a `Surface` from a
// `SurfaceInput`: `defaultSurface` reads the material's own values and maps, and a custom
// material's surface function starts from it. Then `shade` lights the surface with the scene's
// lights. Code that reads the material's options belongs in `defaultSurface`, and code that
// lights, shadows, fogs or blends the surface belongs in `shade`, so custom materials get all of
// it. The ALPHA_MASK builds draw nothing where the surface's alpha falls below the material's
// cutoff. The RECEIVE_SHADOWS builds dim the sun's light where the main directional light's
// shadows fall.
//
// The MAPS builds sample the material's texture maps: base color, metal-rough, normal, occlusion,
// emissive and light maps, each a layer of a texture array with a sampler of its own. A map reads
// the first texture coordinates, or the second where the material's flags say so, through the
// material's texture coordinate transform. A map whose image is not on the GPU yet has no layer,
// and the material draws as without it. The normal map bends the normal in a frame from the mesh's
// tangents with VERTEX_TANGENT, and otherwise from how the position and the texture coordinates
// change between pixels, as three.js's getTangentFrame makes it.
//
// Custom materials build this template with their WGSL added after its last line, and with the
// shader defs CUSTOM and UV0, which reads the first texture coordinates. CUSTOM_SURFACE makes the
// fragment shader call their `fn surface`, and CUSTOM_VERTEX_OFFSET makes the vertex shader move
// each vertex by their `fn vertexOffset`. Their WGSL reads the built-in values `frame`, `camera` and
// `object`, which each stage fills under CUSTOM; the frame's uniform block is `engine_frame` here.
// When their WGSL declares `struct Uniforms`, the build adds `load_material_uniforms` after it, and
// CUSTOM_UNIFORMS makes each stage fill `material` with the uniforms. Their WGSL shares this file's
// names, so the template imports library items by name and keeps its own names few. It never
// imports a module whole, which would reserve the module's name in their WGSL too. Names that only
// the MAPS builds declare stay free for custom materials, which build without maps.
#import null3d::lighting::{PbrMaterial, dfg_lut, direct_light, indirect_diffuse}
#import null3d::lighting::{multiscatter_compensation, pbr_material}
#import null3d::globals::{Material}
#import null3d::mesh::{InstanceIn, clip_of, find_instance, fogged, frame as engine_frame, material_of}
#import null3d::mesh::{custom_value, finish, relative_position, world_normal}
#ifdef MAPS
#import null3d::mesh::{map_layer, map_ready, world_direction}
#endif
#ifdef RECEIVE_SHADOWS
#import null3d::shadows::{sun_shadow}
#endif

/// The bit of a material's flags that lights each triangle with its face's normal.
const FLAT_SHADING: u32 = 1u;

/// The row of the material that the pixel shows, which the fragment shader reads once.
var<private> material_row: Material;

#ifdef CUSTOM_UNIFORMS
/// The custom material's uniforms, which each stage reads once.
var<private> material: Uniforms;
#endif

#ifdef CUSTOM
/// The frame's values that a custom material reads as `frame`.
struct FrameValues {
    /// The sketch time in seconds, as `time.now` gives it to the sketch.
    time: f32,
    /// The seconds since the frame before, as `time.dt` gives them.
    deltaTime: f32,
    /// The frame's number, counting from 1, as `time.frame` gives it.
    index: u32,
    /// The size of the render target in pixels.
    resolution: vec2f,
}

/// The camera's values that a custom material reads as `camera`.
struct CameraValues {
    /// The camera's position in the world. Far from the world's origin, it holds fewer digits than
    /// positions relative to the camera.
    position: vec3f,
    /// The matrix from positions relative to the camera to clip space.
    viewProjection: mat4x4f,
}

/// The values of the object, or of the instance, that a custom material reads as `object`.
struct ObjectValues {
    /// The position of the object's origin in the world.
    position: vec3f,
}

var<private> frame: FrameValues;
var<private> camera: CameraValues;
var<private> object: ObjectValues;

/// Fills the built-in values from the frame's uniform block and the object's origin, relative to
/// the camera.
fn fill_builtins(origin: vec3f) {
    let clock = engine_frame.clock;
    let world = engine_frame.camera_world.xyz;
    frame = FrameValues(clock.x, clock.y, bitcast<u32>(clock.z), engine_frame.target_size.xy);
    camera = CameraValues(world, engine_frame.view_proj);
    object = ObjectValues(world + origin);
}
#endif

#ifdef MAPS
/// The bit of a material's flags for the map of slot 0 on the second texture coordinates; the
/// next slots take the bits above it.
const SECOND_UV: u32 = 256u;

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
#else ifdef UV0
    @location(2) uv0: vec2f,
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
#else ifdef UV0
    /// The first texture coordinates.
    @location(4) uv: vec2f,
#endif
#ifdef VERTEX_TANGENT
    @location(5) tangent: vec3f,
    @location(6) bitangent: vec3f,
#endif
#ifdef CUSTOM
    /// The object's origin, relative to the camera.
    @location(8) @interpolate(flat, either) origin: vec3f,
#endif
}

#ifdef CUSTOM
/// What a vertex offset function knows of a vertex of the mesh, in the mesh's own space, before
/// the object's transform and instancing move it.
struct VertexInput {
    /// The vertex's position.
    position: vec3f,
    /// The vertex's unit normal.
    normal: vec3f,
    /// The vertex's first texture coordinates.
    uv: vec2f,
}
#endif

/// What a surface function knows of the point of the surface that a pixel shows. Positions and
/// directions are in world space, relative to the camera.
struct SurfaceInput {
    /// The position relative to the camera, which stays precise far from the world's origin.
    relativePosition: vec3f,
#ifdef CUSTOM
    /// The position in the world. Far from the world's origin, it holds fewer digits than
    /// `relativePosition`.
    worldPosition: vec3f,
#endif
    /// The unit normal of the mesh, or of the triangle's face with flat shading, turned toward the
    /// camera on the back faces of double-sided materials.
    normal: vec3f,
    /// The unit direction from the surface toward the camera.
    viewDirection: vec3f,
    /// The mesh's vertex color when the material takes vertex colors and the mesh has them, else
    /// white.
    vertexColor: vec4f,
#ifdef MAPS
    /// The mesh's first texture coordinates.
    uv: vec2f,
    /// The mesh's second texture coordinates, or the first on a mesh without a second set.
    uv1: vec2f,
#else ifdef UV0
    /// The mesh's first texture coordinates.
    uv: vec2f,
#endif
#ifdef VERTEX_TANGENT
    /// The mesh's tangent and bitangent in world space, as the vertices give them.
    tangent: vec3f,
    bitangent: vec3f,
#endif
    /// True on the front face of a triangle.
    frontFacing: bool,
}

/// A point of a surface, ready to light. Colors are linear.
struct Surface {
    /// The base color, which the surface reflects.
    baseColor: vec3f,
    /// The opacity, from 0 to 1.
    alpha: f32,
    /// How much the surface acts like a metal, from 0 to 1.
    metalness: f32,
    /// The perceptual roughness, from 0 (a mirror) to 1 (fully matte).
    roughness: f32,
    /// The unit normal that lights the surface, in world space.
    normal: vec3f,
    /// The light that the surface gives off, added after lighting.
    emissive: vec3f,
    /// How much light from all directions reaches the surface, from 0 (none) to 1 (all).
    occlusion: f32,
    /// Baked light that reaches the surface, such as a light map's, added to the ambient light.
    irradiance: vec3f,
}

#ifdef MAPS
/// The surface with the material's texture maps: each map that has an image multiplies or
/// replaces the values that it holds, and the normal map bends the normal last.
fn with_maps(surface: Surface, input: SurfaceInput) -> Surface {
    let m = material_row;
    let flags = u32(m.strengths.z);
    var s = surface;
    // The coordinates' derivatives come first, where every pixel of the quad runs them; each map
    // then samples with them inside its branch.
    let first = transformed_uv(input.uv, m.uv_u, m.uv_v);
    let second = transformed_uv(input.uv1, m.uv_u, m.uv_v);
    let position_dy = dpdy(input.relativePosition) * ROWS_UP;
    let position_dx = dpdx(input.relativePosition);
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
        s.baseColor *= texel.rgb;
        s.alpha *= texel.a;
    }
    if map_ready(m.maps.y) {
        let at = map_uv(flags, 1u, first, second);
        let layer = map_layer(m.maps.y);
        let texel = textureSampleGrad(metal_rough_map, metal_rough_sampler, at.uv, layer, at.dx, at.dy);
        s.roughness *= texel.g;
        s.metalness *= texel.b;
    }
    if map_ready(m.maps.w) {
        let at = map_uv(flags, 3u, first, second);
        let layer = map_layer(m.maps.w);
        let texel = textureSampleGrad(occlusion_map, occlusion_sampler, at.uv, layer, at.dx, at.dy);
        s.occlusion = (texel.r - 1.0) * m.strengths.x + 1.0;
    }
    if map_ready(m.more_maps.x) {
        let at = map_uv(flags, 4u, first, second);
        let layer = map_layer(m.more_maps.x);
        let texel = textureSampleGrad(emissive_map, emissive_sampler, at.uv, layer, at.dx, at.dy);
        s.emissive *= texel.rgb;
    }
    if map_ready(m.more_maps.y) {
        let at = map_uv(flags, 5u, first, second);
        let layer = map_layer(m.more_maps.y);
        let texel = textureSampleGrad(light_map, light_sampler, at.uv, layer, at.dx, at.dy);
        s.irradiance = texel.rgb * m.strengths.y;
    }
    if map_ready(m.maps.z) {
        let at = map_uv(flags, 2u, first, second);
        let layer = map_layer(m.maps.z);
        let texel = textureSampleGrad(normal_map, normal_sampler, at.uv, layer, at.dx, at.dy);
        let bent = vec3f((texel.xy * 2.0 - 1.0) * m.surface.zw, texel.z * 2.0 - 1.0);
        let normal = input.normal;
        let facing = select(-1.0, 1.0, input.frontFacing);
#ifdef VERTEX_TANGENT
        let tangent = normalize(input.tangent) * facing;
        let bitangent = normalize(input.bitangent) * facing;
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
        s.normal = normalize(tangent * bent.x + bitangent * bent.y + normal * bent.z);
    }
    return s;
}
#endif

/// The surface as the material's own values make it: its base color times the vertex color, its
/// metalness, roughness and emissive light, and the normal of the input, with the material's
/// texture maps in the builds that have them.
fn defaultSurface(input: SurfaceInput) -> Surface {
    let m = material_row;
    var s: Surface;
    s.baseColor = m.color.rgb * input.vertexColor.rgb;
    s.alpha = m.color.a * input.vertexColor.a;
    s.metalness = m.surface.x;
    s.roughness = m.surface.y;
    s.normal = input.normal;
    s.emissive = m.emissive.rgb * m.strengths.w;
    s.occlusion = 1.0;
    s.irradiance = vec3f(0.0);
#ifdef MAPS
    s = with_maps(s, input);
#endif
    return s;
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
#ifdef CUSTOM
    let origin = relative_position(found, vec3f(0.0));
    fill_builtins(origin);
#endif
#ifdef CUSTOM_UNIFORMS
    material = load_material_uniforms(found.material);
#endif
    var out: VertexOut;
#ifdef CUSTOM_VERTEX_OFFSET
    let offset = vertexOffset(VertexInput(v.position, v.normal, v.uv0));
    out.relative = relative_position(found, v.position + offset);
#else
    out.relative = relative_position(found, v.position);
#endif
    out.clip = clip_of(found, out.relative);
    out.normal = world_normal(found, v.normal);
    out.material = found.material;
#ifdef VERTEX_COLOR
    out.vertex_color = v.vertex_color;
#endif
#ifdef MAPS
    out.uv = vec4f(v.uv0, v.uv1);
#else ifdef UV0
    out.uv = v.uv0;
#endif
#ifdef VERTEX_TANGENT
    // As three.js does: the tangent through the world matrix, and the bitangent at right angles
    // to the normal and the tangent, on the side that the tangent's w gives.
    let tangent = normalize(world_direction(found, v.tangent.xyz));
    out.tangent = tangent;
    out.bitangent = normalize(cross(out.normal, tangent) * v.tangent.w);
#endif
#ifdef CUSTOM
    out.origin = origin;
#endif
    return out;
}

/// The light that a surface reflects toward the camera from the scene's lights: the sun, less
/// where its shadows fall, the ambient light, and `extra` irradiance such as a light map's, which
/// `occlusion` darkens with the ambient light. `relative` is the surface's position relative to the
/// camera, `to_view` points from the surface toward the camera, and `dfg` holds the split-sum
/// terms at the surface's roughness and view angle.
fn light_surface(
    m: PbrMaterial,
    relative: vec3f,
    normal: vec3f,
    to_view: vec3f,
    dfg: vec2f,
    extra: vec3f,
    occlusion: f32,
) -> vec3f {
    let compensation = multiscatter_compensation(m.specular_blended, dfg);
    var sun_color = engine_frame.sun_color.rgb;
#ifdef RECEIVE_SHADOWS
    sun_color *= sun_shadow(relative, normal);
#endif
    let sun = direct_light(
        m,
        normal,
        to_view,
        -engine_frame.sun_direction.xyz,
        sun_color,
        compensation,
    );
    let ambient = indirect_diffuse(m, engine_frame.ambient.rgb + extra, dfg);
    return sun.diffuse + sun.specular + ambient * occlusion;
}

/// The color of a pixel that shows the surface: the light it reflects and the light it gives off,
/// in the scene's fog, finished for the screen at the pixel's position.
fn shade(s: Surface, input: SurfaceInput, pixel: vec2f) -> vec4f {
    let normal = normalize(s.normal);
    // Where the mesh's normal changes fast between pixels, highlights soften, as three.js softens
    // them. As in three.js, the normal is the mesh's own, before a map or a surface function bends
    // it.
    let change = max(abs(dpdx(input.normal)), abs(dpdy(input.normal)));
    let geometry_roughness = max(max(change.x, change.y), change.z);
    let pbr = pbr_material(s.baseColor, s.metalness, s.roughness, geometry_roughness);
    let n_dot_v = saturate(dot(normal, input.viewDirection));
    let dfg = dfg_lut(n_dot_v, pbr.roughness);
    let reflected = light_surface(
        pbr,
        input.relativePosition,
        normal,
        input.viewDirection,
        dfg,
        s.irradiance,
        s.occlusion,
    );
    let outgoing = reflected + s.emissive;
    // The test comes last, after every derivative, which a discarded fragment still helps compute.
#ifdef ALPHA_MASK
    if s.alpha < material_row.emissive.w {
        discard;
    }
#endif
    return finish(fogged(outgoing, input.relativePosition, material_row), pixel);
}

@fragment
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    material_row = material_of(in.material);
#ifdef CUSTOM
    fill_builtins(in.origin);
#endif
#ifdef CUSTOM_UNIFORMS
    material = load_material_uniforms(in.material);
#endif
    var input: SurfaceInput;
    input.relativePosition = in.relative;
    // Toward the camera: from the point for a perspective camera, and one direction for an
    // orthographic camera, whose view rays are parallel.
    let eye = engine_frame.camera_position;
    input.viewDirection = normalize(eye.xyz - in.relative * eye.w);
    // A face's normal comes from how the position changes between pixels. The two GPU paths count
    // pixel rows in opposite directions, so the normal is turned to face the camera, as three.js's
    // flat normals face it.
    let face = normalize(cross(dpdx(in.relative), dpdy(in.relative)));
    let face_normal = select(-face, face, dot(face, input.viewDirection) >= 0.0);
    // Back faces draw only for double-sided materials, and light as front faces do.
    let smooth_normal = normalize(in.normal) * select(-1.0, 1.0, front);
    let flat_shading = (u32(material_row.strengths.z) & FLAT_SHADING) != 0u;
    input.normal = select(smooth_normal, face_normal, flat_shading);
    input.vertexColor = vec4f(1.0);
#ifdef VERTEX_COLOR
    input.vertexColor = in.vertex_color;
#endif
#ifdef CUSTOM
    input.worldPosition = in.relative + engine_frame.camera_world.xyz;
#endif
#ifdef MAPS
    input.uv = in.uv.xy;
    input.uv1 = in.uv.zw;
#else ifdef UV0
    input.uv = in.uv;
#endif
#ifdef VERTEX_TANGENT
    input.tangent = in.tangent;
    input.bitangent = in.bitangent;
#endif
    input.frontFacing = front;
#ifdef CUSTOM_SURFACE
    let s = surface(input);
#else
    let s = defaultSurface(input);
#endif
    return shade(s, input, in.clip.xy);
}

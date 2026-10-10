enable draw_index;

// Meshes drawn by instance with the standard material: glTF's metallic-roughness model, shaded
// with the formulas of three.js's MeshStandardMaterial. null3d::mesh finds each instance on both
// GPU paths, and null3d::lighting holds the formulas. `light_surface` gathers the scene's lights,
// so the rest of the shader does not change with where the lights come from. null3d::lights finds
// the point and spot lights of each surface's cluster, and null3d::ibl reads the scene's
// environment, which every build reads when the frame's values say the scene has one.
//
// The fragment shader works in two steps. First a surface function fills a `Surface` from a
// `SurfaceInput`: `defaultSurface` reads the material's own values and maps, and a custom
// material's surface function starts from it. Then `shade` lights the surface with the scene's
// lights. Code that reads the material's options belongs in `defaultSurface`, and code that
// lights, shadows, fogs or blends the surface belongs in `shade`, so custom materials get all of
// it. The ALPHA_MASK builds draw nothing where the surface's alpha falls below the material's
// cutoff, the ALPHA_COVERAGE builds fade it there for alpha to coverage, and the ALPHA_HASH builds
// test it against the alpha hash (null3d::cutout). A material that blends writes premultiplied
// color. The RECEIVE_SHADOWS builds dim the
// sun's light where the main directional light's shadows fall. The SKIN builds skin each vertex by
// its joints (null3d::mesh), before the instance's world matrix places it, and the MORPH builds
// of WebGL2 add its morph targets' deltas before that.
//
// The TRANSMISSION builds let light through the surface, as three.js's MeshPhysicalMaterial does
// (null3d::refraction): the light from behind it takes the share of its diffuse light that the
// material's transmission gives. Such materials draw in the transparent pass, after the camera's
// view copied the color of its opaque objects, which they sample. On the 8-bit path, where the copy
// holds display color, the light from behind joins the surface's own light after the tone mapping.
// Custom materials' surfaces have the transmission and the thickness in every build, and the
// builds that let light through only where their WGSL sets the surface's transmission.
//
// The MAPS builds sample the material's texture maps: base color, metal-rough, normal, occlusion,
// emissive, light, specular intensity and specular color maps, each a layer of a texture array with
// a sampler. A map reads
// the first texture coordinates, or the second where the material's flags say so, through the
// material's texture coordinate transform. A map whose image is not on the GPU yet has no layer,
// and the material draws as without it. The normal map bends the normal in a frame from the mesh's
// tangents with VERTEX_TANGENT, and otherwise from how the position and the texture coordinates
// change between pixels, as three.js's getTangentFrame makes it. On WebGPU each map has a texture
// array and a sampler of its own. WebGL2 gives a stage only 16 texture units, so there the maps
// share a few units: maps whose texture arrays and samplers are the same share one, and each map's
// layer in the row also names its unit.
//
// Custom materials build this template with their WGSL added after its last line, and with the
// shader defs CUSTOM and UV0, which reads the first texture coordinates. CUSTOM_SURFACE makes the
// fragment shader call their `fn surface`, and CUSTOM_VERTEX_OFFSET makes the vertex shader move
// each vertex by their `fn vertexOffset`. Their WGSL reads the built-in values `frame`, `camera` and
// `object` of null3d::builtins, which each stage fills under CUSTOM; the frame's uniform block is
// `engine_frame` here. When their WGSL declares `struct Uniforms`, the build adds
// `load_material_uniforms` after it, and CUSTOM_UNIFORMS makes each stage fill `material` with the
// uniforms. When their WGSL declares textures, the build binds them in the maps' bind group and
// adds `load_custom_texture_layers`, which CUSTOM_TEXTURES makes each stage call. Their WGSL
// shares this file's names, so the template imports library items by name and keeps its own names
// few. It never imports a module whole, which would reserve the module's name
// in their WGSL too. Names that only the MAPS builds declare stay free for custom materials, which
// build without maps.
#import null3d::lighting::{PbrMaterial, dfg_lut, multiscatter_compensation, pbr_material}
#import null3d::lighting::{with_specular}
#ifdef HALF
#import null3d::half::{direct_light, indirect_diffuse}
#else
#import null3d::lighting::{direct_light, indirect_diffuse}
#endif
#import null3d::builtins::{camera, fill_builtins, frame, object}
#import null3d::globals::{Material}
#import null3d::gtao::{screen_occlusion}
#import null3d::ibl::{environment_irradiance, environment_radiance, has_environment}
#import null3d::lighting::{indirect_specular, specular_occlusion}
#import null3d::lights::{clustered_light}
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_direction, skinned_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#endif
#import null3d::mesh::{InstanceIn, clip_of, find_instance, finish_exposed, fogged, fragment_color}
#import null3d::mesh::{BLEND_FLAG, ambient_light, custom_value, frame as engine_frame, material_of}
#import null3d::mesh::{relative_position, world_normal}
#import null3d::vertex::{mesh_position, mesh_second_uv, mesh_uv}
#ifdef MAPS
#import null3d::mesh::{map_layer, map_ready, map_unit, straight_texel, world_direction}
#else ifdef TRANSMISSION
#import null3d::mesh::{world_direction}
#endif
#ifdef TRANSMISSION
#import null3d::globals::{MaterialTransmission}
#import null3d::mesh::{NO_FOG, material_transmission}
#import null3d::refraction::{transmitted_light}
#ifdef TONE_MAP
#import null3d::fog::{fog_factor}
#import null3d::tonemap::{encode, tone_map}
#endif
#endif
#ifdef RECEIVE_SHADOWS
#import null3d::shadows::{sun_shadow}
#endif
#ifdef ALPHA_COVERAGE
#import null3d::cutout::{alpha_coverage}
#endif
#ifdef ALPHA_HASH
#import null3d::cutout::{alpha_hash_threshold}
#endif
#ifdef SAMPLE_MASK
#import null3d::cutout::{MaskedFragment, masked_fragment}
#endif

/// The bit of a material's flags that lights each triangle with its face's normal.
const FLAT_SHADING: u32 = 1u;

/// The row of the material that the pixel shows, which the fragment shader reads once.
var<private> material_row: Material;

#ifdef ALPHA_HASH
/// The pixel's position in the mesh's own space, where the alpha hash finds its pattern.
var<private> hash_place: vec3f;
#endif

#ifdef CUSTOM_UNIFORMS
/// The custom material's uniforms, which each stage reads once.
var<private> material: Uniforms;
#endif

#ifdef TRANSMISSION
/// The values of the material that lets light through, which the fragment shader reads once.
var<private> transmission_row: MaterialTransmission;

/// The diffuse light that `light_surface` gathers, of which the light through the surface takes
/// the transmission's share.
var<private> diffuse_light: vec3f;

/// The object's scale along each of its axes.
var<private> object_scale: vec3f;
#endif


#ifdef MAPS
/// The bit of a material's flags for the map of slot 0 on the second texture coordinates; the
/// next slots take the bits above it.
const SECOND_UV: u32 = 256u;

/// The specular maps' factors at the pixel: the specular color map's color, and the specular
/// intensity map's alpha. `with_maps` sets them, and `shade` multiplies the material's specular
/// values by them. They live outside the surface record, which holds no specular values.
var<private> specular_texel: vec4f;

// The maps' bind group comes after the frame's group, and on WebGL2 after the groups of the draw
// records and the data textures. On WebGPU it holds each slot's texture array, then each slot's
// sampler. On WebGL2 it holds the shared units' texture arrays from binding 0, and their samplers
// from the binding after the last slot's texture.
#ifdef WEBGL2
@group(3) @binding(0) var unit_0_map: texture_2d_array<f32>;
@group(3) @binding(1) var unit_1_map: texture_2d_array<f32>;
@group(3) @binding(2) var unit_2_map: texture_2d_array<f32>;
@group(3) @binding(3) var unit_3_map: texture_2d_array<f32>;
@group(3) @binding(4) var unit_4_map: texture_2d_array<f32>;
@group(3) @binding(5) var unit_5_map: texture_2d_array<f32>;
@group(3) @binding(8) var unit_0_sampler: sampler;
@group(3) @binding(9) var unit_1_sampler: sampler;
@group(3) @binding(10) var unit_2_sampler: sampler;
@group(3) @binding(11) var unit_3_sampler: sampler;
@group(3) @binding(12) var unit_4_sampler: sampler;
@group(3) @binding(13) var unit_5_sampler: sampler;
#else
@group(1) @binding(0) var base_color_map: texture_2d_array<f32>;
@group(1) @binding(1) var metal_rough_map: texture_2d_array<f32>;
@group(1) @binding(2) var normal_map: texture_2d_array<f32>;
@group(1) @binding(3) var occlusion_map: texture_2d_array<f32>;
@group(1) @binding(4) var emissive_map: texture_2d_array<f32>;
@group(1) @binding(5) var light_map: texture_2d_array<f32>;
@group(1) @binding(6) var specular_intensity_map: texture_2d_array<f32>;
@group(1) @binding(7) var specular_color_map: texture_2d_array<f32>;
@group(1) @binding(8) var base_color_sampler: sampler;
@group(1) @binding(9) var metal_rough_sampler: sampler;
@group(1) @binding(10) var normal_sampler: sampler;
@group(1) @binding(11) var occlusion_sampler: sampler;
@group(1) @binding(12) var emissive_sampler: sampler;
@group(1) @binding(13) var light_sampler: sampler;
@group(1) @binding(14) var specular_intensity_sampler: sampler;
@group(1) @binding(15) var specular_color_sampler: sampler;
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

#ifdef WEBGL2
/// The texel of a map whose layer, as the row holds it, is `layer`, at `at`. The layer also names
/// the shared unit that holds the map. GLSL ES 3.00 picks a sampler only with a constant, so a
/// switch picks the unit at run time.
fn map_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    switch map_unit(layer) {
        case 0u: { return textureSampleGrad(unit_0_map, unit_0_sampler, at.uv, l, at.dx, at.dy); }
        case 1u: { return textureSampleGrad(unit_1_map, unit_1_sampler, at.uv, l, at.dx, at.dy); }
        case 2u: { return textureSampleGrad(unit_2_map, unit_2_sampler, at.uv, l, at.dx, at.dy); }
        case 3u: { return textureSampleGrad(unit_3_map, unit_3_sampler, at.uv, l, at.dx, at.dy); }
        case 4u: { return textureSampleGrad(unit_4_map, unit_4_sampler, at.uv, l, at.dx, at.dy); }
        default: { return textureSampleGrad(unit_5_map, unit_5_sampler, at.uv, l, at.dx, at.dy); }
    }
}

// Each map reads through the shared unit that its layer names.
fn base_color_texel(layer: f32, at: MapUv) -> vec4f { return map_texel(layer, at); }
fn metal_rough_texel(layer: f32, at: MapUv) -> vec4f { return map_texel(layer, at); }
fn normal_texel(layer: f32, at: MapUv) -> vec4f { return map_texel(layer, at); }
fn occlusion_texel(layer: f32, at: MapUv) -> vec4f { return map_texel(layer, at); }
fn emissive_texel(layer: f32, at: MapUv) -> vec4f { return map_texel(layer, at); }
fn light_texel(layer: f32, at: MapUv) -> vec4f { return map_texel(layer, at); }
fn specular_intensity_texel(layer: f32, at: MapUv) -> vec4f { return map_texel(layer, at); }
fn specular_color_texel(layer: f32, at: MapUv) -> vec4f { return map_texel(layer, at); }
#else
// Each map samples its own texture directly. A switch on the map's slot, though the slot is a
// constant at each call, made every textured draw many times slower in Chrome on Apple GPUs with a
// multisampled target (decision record D-89).
fn base_color_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    return textureSampleGrad(base_color_map, base_color_sampler, at.uv, l, at.dx, at.dy);
}
fn metal_rough_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    return textureSampleGrad(metal_rough_map, metal_rough_sampler, at.uv, l, at.dx, at.dy);
}
fn normal_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    return textureSampleGrad(normal_map, normal_sampler, at.uv, l, at.dx, at.dy);
}
fn occlusion_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    return textureSampleGrad(occlusion_map, occlusion_sampler, at.uv, l, at.dx, at.dy);
}
fn emissive_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    return textureSampleGrad(emissive_map, emissive_sampler, at.uv, l, at.dx, at.dy);
}
fn light_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    return textureSampleGrad(light_map, light_sampler, at.uv, l, at.dx, at.dy);
}
fn specular_intensity_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    return textureSampleGrad(specular_intensity_map, specular_intensity_sampler, at.uv, l, at.dx, at.dy);
}
fn specular_color_texel(layer: f32, at: MapUv) -> vec4f {
    let l = map_layer(layer);
    return textureSampleGrad(specular_color_map, specular_color_sampler, at.uv, l, at.dx, at.dy);
}
#endif
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
#ifdef ALPHA_HASH
    /// The position in the mesh's own space, where the alpha hash finds its pattern.
    @location(7) mesh_place: vec3f,
#endif
#ifdef CUSTOM
    /// The object's origin, relative to the camera.
    @location(8) @interpolate(flat, either) origin: vec3f,
#endif
#ifdef TRANSMISSION
    /// The object's scale along each of its axes, which turns the volume's thickness into world
    /// units.
    @location(9) @interpolate(flat, either) scale: vec3f,
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
#ifdef CUSTOM
    /// Light from the mirror direction, such as a reflection pass's color, in `rgb`, and how much
    /// of it takes the place of the environment's reflection, from 0 to 1, in `a`.
    reflection: vec4f,
    /// How much of the light behind the surface passes through it, from 0 to 1, in place of that
    /// share of its diffuse light, where the material lets light through.
    transmission: f32,
    /// The thickness of the volume under the surface, in the mesh's own units, which bends the
    /// light that passes through: 0 for a thin wall.
    thickness: f32,
#else ifdef TRANSMISSION
    transmission: f32,
    thickness: f32,
#endif
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
        let texel = straight_texel(m, base_color_texel(m.maps.x, map_uv(flags, 0u, first, second)));
        s.baseColor *= texel.rgb;
        s.alpha *= texel.a;
    }
    if map_ready(m.maps.y) {
        let texel = metal_rough_texel(m.maps.y, map_uv(flags, 1u, first, second));
        s.roughness *= texel.g;
        s.metalness *= texel.b;
    }
    if map_ready(m.maps.w) {
        let texel = occlusion_texel(m.maps.w, map_uv(flags, 3u, first, second));
        s.occlusion = (texel.r - 1.0) * m.strengths.x + 1.0;
    }
    if map_ready(m.more_maps.x) {
        s.emissive *= emissive_texel(m.more_maps.x, map_uv(flags, 4u, first, second)).rgb;
    }
    if map_ready(m.more_maps.y) {
        let texel = light_texel(m.more_maps.y, map_uv(flags, 5u, first, second));
        s.irradiance = texel.rgb * m.strengths.y;
    }
    specular_texel = vec4f(1.0);
    if map_ready(m.more_maps.z) {
        specular_texel.a = specular_intensity_texel(m.more_maps.z, map_uv(flags, 6u, first, second)).a;
    }
    if map_ready(m.more_maps.w) {
        let texel = specular_color_texel(m.more_maps.w, map_uv(flags, 7u, first, second));
        specular_texel = vec4f(texel.rgb, specular_texel.a);
    }
    if map_ready(m.maps.z) {
        let at = map_uv(flags, 2u, first, second);
        let texel = normal_texel(m.maps.z, at);
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
#ifdef CUSTOM
    s.reflection = vec4f(0.0);
#endif
#ifdef TRANSMISSION
    s.transmission = transmission_row.values.x;
    s.thickness = transmission_row.values.y;
#else ifdef CUSTOM
    s.transmission = 0.0;
    s.thickness = 0.0;
#endif
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
#ifdef CUSTOM_TEXTURES
    load_custom_texture_layers(found.material);
#endif
    var out: VertexOut;
#ifdef VERTEX_TANGENT
    let source_tangent = v.tangent.xyz;
#else
    let source_tangent = vec3f(0.0);
#endif
#ifdef MORPH
    var source = Morphed(mesh_position(v.position), v.normal, source_tangent, vec4f(1.0));
#ifdef VERTEX_COLOR
    source.color = v.vertex_color;
#endif
    let rest = morph_vertex(found, v.morph, source);
    let rest_position = rest.position;
    let rest_normal = rest.normal;
    let rest_tangent = rest.tangent;
#else
    let rest_position = mesh_position(v.position);
    let rest_normal = v.normal;
    let rest_tangent = source_tangent;
#endif
#ifdef SKIN
    let skin = skin_of(found, v.joints, v.weights);
    let position = skinned_point(skin, rest_position);
    let normal = skinned_direction(skin, rest_normal);
#else
    let position = rest_position;
    let normal = rest_normal;
#endif
#ifdef CUSTOM_VERTEX_OFFSET
    let offset = vertexOffset(VertexInput(position, normal, mesh_uv(v.uv0)));
    out.relative = relative_position(found, position + offset);
#else
    out.relative = relative_position(found, position);
#endif
    out.clip = clip_of(found, out.relative);
    out.normal = world_normal(found, normal);
    out.material = found.material;
#ifdef VERTEX_COLOR
#ifdef MORPH
    out.vertex_color = rest.color;
#else
    out.vertex_color = v.vertex_color;
#endif
#endif
#ifdef MAPS
    out.uv = vec4f(mesh_uv(v.uv0), mesh_second_uv(v.uv1));
#else ifdef UV0
    out.uv = mesh_uv(v.uv0);
#endif
#ifdef VERTEX_TANGENT
    // As three.js does: the tangent through the world matrix, and the bitangent at right angles
    // to the normal and the tangent, on the side that the tangent's w gives.
#ifdef SKIN
    let mesh_tangent = skinned_direction(skin, rest_tangent);
#else
    let mesh_tangent = rest_tangent;
#endif
    let tangent = normalize(world_direction(found, mesh_tangent));
    out.tangent = tangent;
    out.bitangent = normalize(cross(out.normal, tangent) * v.tangent.w);
#endif
#ifdef ALPHA_HASH
    out.mesh_place = mesh_position(v.position);
#endif
#ifdef CUSTOM
    out.origin = origin;
#endif
#ifdef TRANSMISSION
    out.scale = vec3f(
        length(world_direction(found, vec3f(1.0, 0.0, 0.0))),
        length(world_direction(found, vec3f(0.0, 1.0, 0.0))),
        length(world_direction(found, vec3f(0.0, 0.0, 1.0))),
    );
#endif
    return out;
}

/// The light that a surface reflects toward the camera from the scene's lights: the sun, less
/// where its shadows fall, the point and spot lights of the surface's cluster, the ambient and
/// hemisphere lights, `extra` irradiance such as a light map's, and the environment's light times
/// the material's factor of it. The environment's light adds to the ambient and hemisphere lights,
/// as three.js adds it, and neither its intensity nor the material's factor scales them.
/// `occlusion` darkens the ambient and hemisphere lights and the environment's diffuse light, and
/// its specular light as three.js's `computeSpecularOcclusion` does. `relative` is the surface's
/// position relative to the camera, `to_view` points from the surface toward the camera, and
/// `dfg` holds the split-sum terms at the surface's roughness and view angle. In custom materials,
/// `reflection` holds light from the mirror direction and its share, which takes the place of
/// that share of the environment's reflection, with or without an environment.
fn light_surface(
    m: PbrMaterial,
    relative: vec3f,
    normal: vec3f,
    to_view: vec3f,
    dfg: vec2f,
    extra: vec3f,
    occlusion: f32,
#ifdef CUSTOM
    reflection: vec4f,
#endif
) -> vec3f {
    let compensation = multiscatter_compensation(m.specular_blended, dfg);
    var sun_color = engine_frame.sun_color.rgb;
#ifdef RECEIVE_SHADOWS
    // A surface that faces away from the sun gets none of its light whatever the shadow map
    // holds, so it skips the lookup and the filter's reads.
    let to_sun = -engine_frame.sun_direction.xyz;
    if dot(normal, to_sun) > 0.0 {
        sun_color *= sun_shadow(relative, normal, to_sun);
    }
#endif
    let sun = direct_light(
        m,
        normal,
        to_view,
        -engine_frame.sun_direction.xyz,
        sun_color,
        compensation,
    );
    let clustered = clustered_light(m, relative, normal, to_view, compensation);
    let ambient = indirect_diffuse(m, ambient_light(normal) + extra, dfg);
    let direct = sun.diffuse + sun.specular + clustered.diffuse + clustered.specular;
    var indirect = ambient * occlusion;
#ifdef TRANSMISSION
    diffuse_light = sun.diffuse + clustered.diffuse + indirect;
#endif
    let env = engine_frame.environment;
#ifdef CUSTOM
    let mirrored = saturate(reflection.a);
    if has_environment(env) || mirrored > 0.0 {
        let strength = select(0.0, material_row.uv_u.w, has_environment(env));
        let irradiance = environment_irradiance(env, normal) * strength;
        let surrounding = environment_radiance(env, to_view, normal, m.roughness) * strength;
        let radiance = mix(surrounding, reflection.rgb, mirrored);
#else
    if has_environment(env) {
        let strength = material_row.uv_u.w;
        let irradiance = environment_irradiance(env, normal) * strength;
        let radiance = environment_radiance(env, to_view, normal, m.roughness) * strength;
#endif
        let image = indirect_specular(m, radiance, irradiance, dfg);
        let n_dot_v = saturate(dot(normal, to_view));
        let specular = image.specular * specular_occlusion(n_dot_v, occlusion, m.roughness);
        indirect += image.diffuse * occlusion + specular;
#ifdef TRANSMISSION
        diffuse_light += image.diffuse * occlusion;
#endif
    }
    return direct + indirect;
}

/// The color of a pixel that shows the surface: the light it reflects and the light it gives off,
/// in the scene's fog, finished for the screen at the pixel's position, and premultiplied by its
/// alpha when the material blends. `pixel` is the fragment's position, whose depth places it in
/// the frame's ambient occlusion. That darkens the indirect light, with the surface's own
/// occlusion.
fn shade(s: Surface, input: SurfaceInput, pixel: vec4f) -> vec4f {
    let normal = normalize(s.normal);
    // Where the mesh's normal changes fast between pixels, highlights soften, as three.js softens
    // them. As in three.js, the normal is the mesh's own, before a map or a surface function bends
    // it.
    let change = max(abs(dpdx(input.normal)), abs(dpdy(input.normal)));
    let geometry_roughness = max(max(change.x, change.y), change.z);
    // The material's dielectric specular values, times its specular maps in the MAPS builds.
    var specular = material_row.specular;
#ifdef MAPS
    specular *= specular_texel;
#endif
    let plain = pbr_material(s.baseColor, s.metalness, s.roughness, geometry_roughness);
    let pbr = with_specular(plain, material_row.uv_v.w, specular.rgb, specular.a);
    let n_dot_v = saturate(dot(normal, input.viewDirection));
    let dfg = dfg_lut(n_dot_v, pbr.roughness);
    // The frame's lights are exposed already. The surface's own light and its baked light take the
    // exposure here.
#ifdef TRANSMISSION
    // The surface draws over the surfaces that ambient occlusion saw, as a blended one does.
    let blended = true;
#else
    let blended = (u32(material_row.strengths.z) & BLEND_FLAG) != 0u;
#endif
    let reflected = light_surface(
        pbr,
        input.relativePosition,
        normal,
        input.viewDirection,
        dfg,
        s.irradiance * engine_frame.output.exposure,
        s.occlusion * screen_occlusion(pixel.xyz, blended),
#ifdef CUSTOM
        s.reflection,
#endif
    );
#ifdef TRANSMISSION
    // three.js's getIBLVolumeRefraction: the light from behind, through the diffuse color and less
    // what the specular layer reflects, takes the transmission's share of the diffuse light.
    let share = saturate(s.transmission);
    let fresnel = pbr.specular_blended * dfg.x + pbr.specular_grazing * dfg.y;
    let through = transmitted_light(
        input.relativePosition,
        normal,
        input.viewDirection,
        pbr.roughness,
        s.thickness,
        transmission_row.values.z,
        transmission_row.attenuation,
        object_scale,
    ) * pbr.diffuse * (1.0 - fresnel);
#ifdef TONE_MAP
    let emitted = s.emissive * engine_frame.output.exposure;
    let outgoing = reflected - diffuse_light * share + emitted;
#else
    let emitted = s.emissive * engine_frame.output.exposure;
    let outgoing = reflected + (through - diffuse_light) * share + emitted;
#endif
#else
    let outgoing = reflected + s.emissive * engine_frame.output.exposure;
#endif
    // The test comes last, after every derivative, which a discarded fragment still helps compute.
#ifdef ALPHA_HASH
    if s.alpha < alpha_hash_threshold(hash_place) {
        discard;
    }
#else ifdef ALPHA_COVERAGE
    let coverage = alpha_coverage(s.alpha, fwidth(s.alpha), material_row.emissive.w);
    if coverage <= 0.0 {
        discard;
    }
#else ifdef ALPHA_MASK
    if s.alpha < material_row.emissive.w {
        discard;
    }
#endif
#ifdef TRANSMISSION
#ifdef TONE_MAP
    // The copy holds display color, so the light from behind joins after the tone mapping, as far
    // as the fog lets it.
    let unfogged = (u32(material_row.strengths.z) & NO_FOG) != 0u;
    let fog = select(fog_factor(engine_frame.fog, input.relativePosition), 0.0, unfogged);
    let toned = tone_map(fogged(outgoing, input.relativePosition, material_row), engine_frame.output);
    let display = toned + through * share * (1.0 - fog);
    let finished = vec4f(encode(saturate(display), pixel.xy), 1.0);
#else
    let finished = finish_exposed(fogged(outgoing, input.relativePosition, material_row), pixel.xy);
#endif
#else
    let finished = finish_exposed(fogged(outgoing, input.relativePosition, material_row), pixel.xy);
#endif
#ifdef ALPHA_COVERAGE
    return vec4f(finished.rgb, coverage);
#else
    return fragment_color(material_row, finished.rgb, s.alpha);
#endif
}

@fragment
#ifdef SAMPLE_MASK
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> MaskedFragment {
#else
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
#endif
    material_row = material_of(in.material);
#ifdef TRANSMISSION
    transmission_row = material_transmission(in.material);
    object_scale = in.scale;
#endif
#ifdef ALPHA_HASH
    hash_place = in.mesh_place;
#endif
#ifdef CUSTOM
    fill_builtins(in.origin);
#endif
#ifdef CUSTOM_UNIFORMS
    material = load_material_uniforms(in.material);
#endif
#ifdef CUSTOM_TEXTURES
    load_custom_texture_layers(in.material);
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
#ifdef SAMPLE_MASK
    return masked_fragment(shade(s, input, in.clip));
#else
    return shade(s, input, in.clip);
#endif
}

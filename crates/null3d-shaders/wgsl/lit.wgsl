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
// The COAT_SHEEN builds light a clear coat and a sheen above the base, as three.js's
// MeshPhysicalMaterial does (null3d::coat_sheen). In them the map slots of the light map and the
// specular maps hold the coat map, the coat normal map and the sheen map, since a layered material
// has neither, and the row's flags say which channels of the coat and sheen maps apply. Custom
// materials' surfaces have the layers' values in every build, and the COAT_SHEEN builds only where
// their WGSL names them.
//
// The ROW_VALUES builds draw the rows of instance batches with row values (null3d::mesh): the row's
// color multiplies the vertex color, so it tints the base color and the alpha as three.js's
// instance colors do, and custom materials read the row's own values as `object.values` in both
// stages. The CASTER builds, which only custom materials with a vertex offset have, draw a shadow
// caster's depth: the vertex shader moves each vertex by the offset, then places it as the shadow
// depth template places a caster's, flattened onto the near face of the light's box. Their
// pipelines have no fragment stage on WebGPU, and on WebGL2 their fragment shader writes nothing
// that the pass keeps.
//
// The LOD_FADE builds draw a level of detail inside the band where it hands over to the next
// (null3d::mesh): the vertex shader passes on the instance's fade value, and the fragment shader
// keeps the pixels of its side of a 4 × 4 ordered dither, with the alpha test, after every
// derivative.
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
// The normal map's slot may hold a height map instead, as the row's flags say. With BUMP_MAP, it is
// a bump map: the BUMP builds bend the normal as three.js's bump mapping does, by the height's
// change from one pixel to the next, against the screen's directions normalized. With HEIGHT_NORMALS, it is the
// displacement map, which bends the normal by its slope in world units, so the light follows the
// vertices that the DISPLACEMENT builds move. Those builds move each vertex along its normal by the
// displacement map, after skinning and morph targets, in the mesh's own space, as three.js's
// displacementMap does. The vertex stage reads the map from a binding of its own in the maps
// group, and its layer, scale, bias and coordinate transform from the material's custom values.
//
// The DECAL builds draw decals: a material projected onto every surface inside an object's box,
// in a pass of their own after the camera's opaque pass. Each draws the back faces of the box's
// mesh, a cube from -0.5 to 0.5 on each axis, through the instance's world matrix. Each pixel
// reads the scene's depth there and at its four neighbors, and finds the surface that the pixel
// shows and the surface's normal, from the neighbor on each axis whose depth lies closer. A pixel
// whose surface lies outside the box draws nothing. The box's x and y axes give the texture
// coordinates, as three.js's DecalGeometry gives them, and the frame of the normal map. The
// material's values then fill the surface as for any mesh, and `shade` lights it. The decal fades
// where the surface turns away from the box's z axis, and near the box's two ends along it. It
// writes its color times its alpha, beside the alpha, which blends over the scene's color.
//
// Custom materials build this template with their WGSL added after its last line, and with the
// shader defs CUSTOM and UV0, which reads the first texture coordinates. CUSTOM_SURFACE makes the
// fragment shader call their `fn surface`, and CUSTOM_VERTEX_OFFSET makes the vertex shader move
// each vertex by their `fn vertexOffset`. Their WGSL reads the built-in values `frame`, `camera` and
// `object` of null3d::builtins, which each stage fills under CUSTOM; the frame's uniform block is
// `engine_frame` here. When their WGSL declares `struct Uniforms`, the build adds
// `load_material_uniforms` after it, and CUSTOM_UNIFORMS makes each stage fill `material` with the
// uniforms. When their WGSL declares textures, the build binds them in the maps' bind group and
// adds `load_custom_texture_layers`, which CUSTOM_TEXTURES makes each stage call. Inputs that cost
// something come only to WGSL that reads them: CUSTOM_UV1 reads the second texture coordinates,
// OBJECT_IDS finds the instance's index and the object's id (null3d::mesh), and OBJECT_MATRICES
// passes the world matrix's rows to the fragment shader, at the locations that only the MAPS and
// ALPHA_HASH builds use otherwise, which custom materials never have. Their WGSL
// shares this file's names, so the template imports library items by name and keeps its own names
// few. It never imports a module whole, which would reserve the module's name
// in their WGSL too. Names that only the MAPS builds declare stay free for custom materials, which
// build without maps.
#import null3d::lighting::{PbrMaterial, dfg_lut, multiscatter_compensation, pbr_material}
#import null3d::lighting::{specular_aa_kernel, with_specular}
#ifdef HALF
#import null3d::half::{direct_light, indirect_diffuse}
#else
#import null3d::lighting::{direct_light, indirect_diffuse}
#endif
#import null3d::builtins::{camera, fill_builtins, frame, object}
#import null3d::globals::{Material}
#import null3d::gtao::{screen_occlusion, screen_values}
#import null3d::ibl::{environment_irradiance, environment_radiance, has_environment}
#ifdef PROBE_GRID
#import null3d::probe_grid::{has_probe_grid, probe_grid_irradiance}
#endif
#import null3d::lighting::{horizon_occlusion, indirect_specular, specular_occlusion}
#import null3d::lights::{clustered_light}
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_direction, skinned_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#endif
#import null3d::mesh::{InstanceIn, clip_of, find_instance, finish, finish_exposed, fogged, fragment_color}
#import null3d::mesh::{BLEND_FLAG, ambient_light, custom_value, frame as engine_frame, material_of}
#import null3d::mesh::{relative_position, world_normal}
#ifdef OBJECT_IDS
#import null3d::mesh::{object_ids}
#endif
#ifdef OBJECT_MATRICES
#import null3d::vertex::{affine_matrix, affine_normal_matrix}
#endif
#ifdef ROW_VALUES
#import null3d::mesh::{row_values_of}
#endif
#ifdef LOD_FADE
#import null3d::mesh::{instance_fade, lod_kept}
#endif
#ifdef CASTER
#import null3d::mesh::{caster_clip}
#endif
#import null3d::vertex::{mesh_position, mesh_second_uv, mesh_uv}
#ifdef MAPS
#import null3d::mesh::{map_layer, map_ready, map_unit, straight_texel, world_direction}
#else ifdef TRANSMISSION
#import null3d::mesh::{world_direction}
#else ifdef DECAL
#import null3d::mesh::{world_direction}
#endif
#ifdef DECAL
#import null3d::mesh::{decal_values}
#endif
#ifdef TRANSMISSION
#import null3d::globals::{MaterialTransmission}
#import null3d::mesh::{NO_FOG, material_transmission}
#import null3d::refraction::{transmitted_light}
#ifdef TONE_MAP
#import null3d::fog::{fog_factor}
#import null3d::tonemap::{encode, tone_map, vignette}
#endif
#endif
#ifdef RECEIVE_SHADOWS
#import null3d::shadows::{sun_shadow}
#endif
#ifdef COAT_SHEEN
#import null3d::globals::{MaterialCoatSheen}
#import null3d::coat_sheen::{Layers, begin_layers, coat_environment, coat_facing, coat_transmittance}
#import null3d::coat_sheen::{finish_layers, layered_ambient, layered_environment, layered_light}
#import null3d::mesh::{material_coat_sheen}
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
#ifdef WEIGHTED
#import null3d::weighted::{WeightedFragment, weighted_fragment}
#endif

/// The bit of a material's flags that lights each triangle with its face's normal.
const FLAT_SHADING: u32 = 1u;

#ifdef MAPS
/// The bit of a material's flags that says its normal map's slot holds a bump map.
const BUMP_MAP: u32 = 32u;
/// The bit of a material's flags that says its normal map's slot holds its displacement map, whose
/// slope bends the normal.
const HEIGHT_NORMALS: u32 = 64u;
#endif

/// The bit of a material's flags that draws only the shadows that fall on the surface, as three.js's
/// `ShadowMaterial` (`flag::SHADOW_CATCHER` in the core).
const SHADOW_CATCHER_FLAG: u32 = 128u;

/// The row of the material that the pixel shows, which the fragment shader reads once.
var<private> material_row: Material;

#ifdef ALPHA_HASH
/// The pixel's position in the mesh's own space, where the alpha hash finds its pattern.
var<private> hash_place: vec3f;
#endif

#ifdef LOD_FADE
/// The fade value of the instance's level of detail, which picks the pixels it draws.
var<private> lod_fade: f32;
#endif

#ifdef CUSTOM_UNIFORMS
/// The custom material's uniforms, which each stage reads once.
var<private> material: Uniforms;
#endif

#ifdef DISPLACEMENT
/// The pixel's displacement per unit of the displacement map, in world units.
var<private> height_scale: f32;
#endif

#ifdef PARALLAX
/// How far the displacement moved the surface at the pixel, past the bias, in world units.
var<private> surface_height: f32;
/// The material that the pixel shows, whose custom values hold the displacement map's.
var<private> pixel_material: u32;
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

#ifdef COAT_SHEEN
/// The values of the layered material's clear coat and sheen, which the fragment shader reads once.
var<private> coat_sheen_row: MaterialCoatSheen;
#endif

#ifdef DECAL
/// How much of the decal shows at the pixel, from its fades, which multiplies its alpha.
var<private> decal_fade: f32;

/// How the decal's texture coordinates change across a pixel and up a row, from the surface
/// under the neighboring pixels. Derivatives of the coordinates themselves would jump at the
/// edges of objects, where the surface under the box's face jumps.
var<private> decal_uv_dx: vec2f;
var<private> decal_uv_dy: vec2f;
#endif


#ifdef MAPS
/// The bit of a material's flags for the map of slot 0 on the second texture coordinates; the
/// next slots take the bits above it.
const SECOND_UV: u32 = 256u;

#ifdef COAT_SHEEN
/// The bits of a layered material's flags that say which channels of its coat and sheen maps
/// apply: the coat map's red and green, and the sheen map's color and alpha.
const COAT_MAP: u32 = 65536u;
const COAT_ROUGHNESS_MAP: u32 = 131072u;
const SHEEN_COLOR_MAP: u32 = 262144u;
const SHEEN_ROUGHNESS_MAP: u32 = 524288u;
#endif

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
#ifdef DISPLACEMENT
@group(3) @binding(16) var height_map: texture_2d_array<f32>;
@group(3) @binding(17) var height_sampler: sampler;
#endif
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
#ifdef DISPLACEMENT
@group(1) @binding(16) var height_map: texture_2d_array<f32>;
@group(1) @binding(17) var height_sampler: sampler;
#endif
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
#ifdef DECAL
    let dx = vec2f(dot(uv_u.xy, decal_uv_dx), dot(uv_v.xy, decal_uv_dx));
    let dy = vec2f(dot(uv_u.xy, decal_uv_dy), dot(uv_v.xy, decal_uv_dy));
    return MapUv(at, dx, dy);
#else
    return MapUv(at, dpdx(at), dpdy(at));
#endif
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

/// The size in texels of the top level of the normal map's slot, whose layer is `layer`.
fn normal_size(layer: f32) -> vec2f {
    switch map_unit(layer) {
        case 0u: { return vec2f(textureDimensions(unit_0_map)); }
        case 1u: { return vec2f(textureDimensions(unit_1_map)); }
        case 2u: { return vec2f(textureDimensions(unit_2_map)); }
        case 3u: { return vec2f(textureDimensions(unit_3_map)); }
        case 4u: { return vec2f(textureDimensions(unit_4_map)); }
        default: { return vec2f(textureDimensions(unit_5_map)); }
    }
}
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
fn normal_size(layer: f32) -> vec2f {
    return vec2f(textureDimensions(normal_map));
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

#ifdef MAPS
/// Where a height map in the normal map's slot reads. Rows count upward on both paths, so a bump
/// map compares the pixel with the one above it, as three.js's renderers both do.
fn height_uv(flags: u32, first: MapUv, second: MapUv) -> MapUv {
    let picked = map_uv(flags, 2u, first, second);
    return MapUv(picked.uv, picked.dx, picked.dy * ROWS_UP);
}

/// The change of a height map's red channel from the pixel to the next one across and to the next
/// one up the row, as three.js's `dHdxy_fwd` samples it, read through the normal map's slot.
fn height_change(layer: f32, at: MapUv) -> vec2f {
    let here = normal_texel(layer, at).r;
    let across = normal_texel(layer, MapUv(at.uv + at.dx, at.dx, at.dy)).r;
    let up = normal_texel(layer, MapUv(at.uv + at.dy, at.dx, at.dy)).r;
    return vec2f(across, up) - here;
}

#ifdef DISPLACEMENT
/// The change of a height map's red channel across the pixel and up the row, from the map's slope:
/// the difference between the heights one texel to either side, or a pixel's footprint to either
/// side where that is wider. Filtering blends that slope between texels, so the light changes
/// smoothly where one texel covers many pixels. The change from one pixel to the next, as bump
/// maps take it, stays the same across each texel there, and shades each texel as a flat facet.
fn height_slope_change(layer: f32, at: MapUv) -> vec2f {
    let reach = max(1.0 / normal_size(layer), abs(at.dx) + abs(at.dy));
    let du = vec2f(reach.x, 0.0);
    let dv = vec2f(0.0, reach.y);
    let east = normal_texel(layer, MapUv(at.uv + du, at.dx, at.dy)).r;
    let west = normal_texel(layer, MapUv(at.uv - du, at.dx, at.dy)).r;
    let north = normal_texel(layer, MapUv(at.uv + dv, at.dx, at.dy)).r;
    let south = normal_texel(layer, MapUv(at.uv - dv, at.dx, at.dy)).r;
    let slope = vec2f(east - west, north - south) / (2.0 * reach);
    return vec2f(dot(slope, at.dx), dot(slope, at.dy));
}
#endif

/// The normal bent by a height's change across the pixel, `change`, along the position's change
/// across it, `along_x`, and up the row, `along_y`: Mikkelsen's surface gradient, as three.js's
/// `perturbNormalArb` makes it. Normalized directions give three.js's bump mapping, whose bend
/// does not follow the surface's size on screen; the plain changes give the slope in world units.
fn bent_by_height(normal: vec3f, along_x: vec3f, along_y: vec3f, change: vec2f, facing: f32) -> vec3f {
    let r1 = cross(along_y, normal);
    let r2 = cross(normal, along_x);
    let det = dot(along_x, r1) * facing;
    let gradient = sign(det) * (change.x * r1 + change.y * r2);
    return normalize(abs(det) * normal - gradient);
}
#endif

#ifdef DISPLACEMENT
/// The displacement map's distance at texture coordinates `uv0` and `uv1` for material `id`, in
/// the mesh's units: its red channel times the scale, plus the bias, as three.js's
/// `displacementMap` reads it, at the map's top level. `values` are the map's layer, scale, bias
/// and coordinate set, from the material's custom values. A map whose image is not on the GPU yet
/// moves nothing.
fn displacement(id: u32, values: vec4f, uv0: vec2f, uv1: vec2f) -> f32 {
    if !map_ready(values.x) {
        return 0.0;
    }
    let uv = select(uv0, uv1, values.w != 0.0);
    let u = custom_value(id, 1u).xyz;
    let v = custom_value(id, 2u).xyz;
    let at = vec2f(dot(u, vec3f(uv, 1.0)), dot(v, vec3f(uv, 1.0)));
    let texel = textureSampleLevel(height_map, height_sampler, at, map_layer(values.x), 0.0);
    return texel.r * values.y + values.z;
}
#endif

#ifdef PARALLAX
/// The fewest and the most steps of parallax's march: few where the view meets the surface head
/// on, where the relief shifts little, and more toward grazing views.
const PARALLAX_STEPS: vec2f = vec2f(8.0, 32.0);

/// The displacement map's red channel at `at`, as the fragment stage reads it for parallax.
fn height_texel(layer: f32, at: MapUv) -> f32 {
#ifdef WEBGL2
    return map_texel(layer, at).r;
#else
    return textureSampleGrad(height_map, height_sampler, at.uv, map_layer(layer), at.dx, at.dy).r;
#endif
}

/// How far parallax occlusion mapping shifts the coordinates of the displacement map at `at`,
/// where the view ray first meets the map's relief. The relief stands along the surface's normal
/// `normal`, `scale` world units per unit of the map, and the pixel shows the surface at
/// `surface` world units up it, as the moved vertices put it. The ray starts where it enters the
/// relief and steps down through it, then finds the crossing between its last two steps.
/// `along_x` and `along_y` are the position's changes across the pixel, in the GPU's row order.
fn parallax_shift(
    layer: f32,
    at: MapUv,
    normal: vec3f,
    to_view: vec3f,
    along_x: vec3f,
    along_y: vec3f,
    scale: f32,
    surface: f32,
) -> vec2f {
    // The gradients of u and of v along the surface (the surface gradient of Mikkelsen's paper).
    let r1 = cross(along_y, normal);
    let r2 = cross(normal, along_x);
    let det = dot(along_x, r1);
    if abs(det) < 1e-20 || scale == 0.0 {
        return vec2f(0.0);
    }
    let grad_u = (r1 * at.dx.x + r2 * at.dy.x) / det;
    let grad_v = (r1 * at.dx.y + r2 * at.dy.y) / det;
    // Coordinates per world unit of height along the ray toward the camera.
    let facing = max(dot(to_view, normal), 0.1);
    let per_height = vec2f(dot(grad_u, to_view), dot(grad_v, to_view)) / facing;
    let top = max(scale, 0.0);
    let bottom = min(scale, 0.0);
    let steps = mix(PARALLAX_STEPS.y, PARALLAX_STEPS.x, facing);
    let stride = (top - bottom) / steps;
    var height = top;
    var above = top - height_texel(layer, MapUv(at.uv + per_height * (top - surface), at.dx, at.dy)) * scale;
    var below = above;
    for (var k = 0u; k < u32(steps); k += 1u) {
        if above <= 0.0 {
            break;
        }
        height -= stride;
        let relief = height_texel(layer, MapUv(at.uv + per_height * (height - surface), at.dx, at.dy)) * scale;
        below = height - relief;
        if below <= 0.0 {
            // Between the step above the relief and this one below it, the crossing.
            let share = above / max(above - below, 1e-6);
            height += stride * (1.0 - share);
            break;
        }
        above = below;
    }
    return per_height * (height - surface);
}
#endif

#ifdef DECAL
// The scene's depth, which the decal builds read: the group after the maps' on WebGPU, or after
// the frame's without maps, and the group after the maps' on WebGL2, which reads a copy of one
// sample of a multisampled depth.
#ifdef WEBGL2
@group(4) @binding(0) var decal_depth: texture_2d<f32>;
#else ifdef DEPTH_MULTISAMPLED
#ifdef MAPS
@group(2) @binding(0) var decal_depth: texture_multisampled_2d<f32>;
#else
@group(1) @binding(0) var decal_depth: texture_multisampled_2d<f32>;
#endif
#else ifdef MAPS
@group(2) @binding(0) var decal_depth: texture_2d<f32>;
#else
@group(1) @binding(0) var decal_depth: texture_2d<f32>;
#endif

/// The vertex attributes that the decal builds read: the position of a corner of the box.
struct VertexIn {
    @location(0) position: vec3f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    /// The point of the box's face, relative to the camera.
    @location(0) relative: vec3f,
    /// How far the point lies in front of the camera, along its view.
    @location(1) distance: f32,
    @location(2) @interpolate(flat, either) material: u32,
    /// The center of the box, relative to the camera.
    @location(3) @interpolate(flat, either) origin: vec3f,
    /// The rows of the inverse of the box's world matrix, which turn a point relative to its center
    /// into the box's own space. Each points along one of the box's axes.
    @location(4) @interpolate(flat, either) to_box_x: vec3f,
    @location(5) @interpolate(flat, either) to_box_y: vec3f,
    @location(6) @interpolate(flat, either) to_box_z: vec3f,
#ifdef ROW_VALUES
    /// The color of the instance's row.
    @location(10) @interpolate(flat, either) row_color: vec4f,
#endif
}
#else
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
#ifdef CUSTOM_UV1
    @location(3) uv1: vec2f,
#endif
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
#else ifdef CUSTOM_UV1
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
#ifdef DISPLACEMENT
    /// How far a unit of the displacement map's red channel moves the surface, in world units: the
    /// material's scale times the object's scale along the normal. Then how far the displacement
    /// moved the surface here, past the bias, in world units, as the vertices give it. Displaced
    /// levels of detail never fade, so it shares its slot with the fade value.
    @location(12) heights: vec2f,
#endif
#ifdef ROW_VALUES
    /// The color of the instance's row.
    @location(10) @interpolate(flat, either) row_color: vec4f,
#ifdef CUSTOM
    /// The values of the instance's row.
    @location(11) @interpolate(flat, either) row_values: vec4f,
#endif
#endif
#ifdef LOD_FADE
    /// The fade value of the instance's level of detail. It shares its slot with the object ids,
    /// as only custom materials read those, and they have no fading builds.
    @location(12) @interpolate(flat, either) lod_fade: f32,
#endif
#ifdef OBJECT_MATRICES
    /// The rows of the object's world matrix that give x, y and z, relative to the camera.
    @location(5) @interpolate(flat, either) world_x: vec4f,
    @location(6) @interpolate(flat, either) world_y: vec4f,
    @location(7) @interpolate(flat, either) world_z: vec4f,
#endif
#ifdef OBJECT_IDS
    /// The instance's index in its batch, then the object's id.
    @location(12) @interpolate(flat, either) ids: vec2u,
#endif
}
#endif

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
#ifdef CUSTOM_UV1
    /// The vertex's second texture coordinates, or the first on a mesh without a second set.
    uv1: vec2f,
#endif
#ifdef OBJECT_IDS
    /// The instance's index in its batch: 0 for an object of the scene.
    instance: u32,
#endif
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
    /// white, times the row's color for a row of an instance batch with row values.
    vertexColor: vec4f,
#ifdef MAPS
    /// The mesh's first texture coordinates.
    uv: vec2f,
    /// The mesh's second texture coordinates, or the first on a mesh without a second set.
    uv1: vec2f,
#else ifdef UV0
    /// The mesh's first texture coordinates.
    uv: vec2f,
#ifdef CUSTOM_UV1
    /// The mesh's second texture coordinates, or the first on a mesh without a second set.
    uv1: vec2f,
#endif
#endif
#ifdef VERTEX_TANGENT
    /// The mesh's tangent and bitangent in world space, as the vertices give them.
    tangent: vec3f,
    bitangent: vec3f,
#endif
    /// True on the front face of a triangle.
    frontFacing: bool,
#ifdef CUSTOM
    /// The pixel's position: x and y in pixels from the target's top left corner, at the pixel's
    /// center, and z the depth, 1 at the near plane and 0 at the far plane.
    fragCoord: vec3f,
#endif
#ifdef OBJECT_IDS
    /// The instance's index in its batch: 0 for an object of the scene.
    instance: u32,
#endif
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
#ifdef CUSTOM
    /// How much of a clear coat covers the surface, from 0 (none) to 1, where the material has
    /// layers.
    clearcoat: f32,
    /// The clear coat's perceptual roughness, from 0 to 1.
    clearcoatRoughness: f32,
    /// The clear coat's unit normal in world space: the mesh's normal, before the normal map
    /// bends it, unless a coat normal map or the surface function bends it.
    clearcoatNormal: vec3f,
    /// The sheen's linear color, where the material has layers: black for none.
    sheenColor: vec3f,
    /// The sheen's perceptual roughness, from 0 to 1.
    sheenRoughness: f32,
#else ifdef COAT_SHEEN
    clearcoat: f32,
    clearcoatRoughness: f32,
    clearcoatNormal: vec3f,
    sheenColor: vec3f,
    sheenRoughness: f32,
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
    var first = transformed_uv(input.uv, m.uv_u, m.uv_v);
    var second = transformed_uv(input.uv1, m.uv_u, m.uv_v);
    let position_dy = dpdy(input.relativePosition) * ROWS_UP;
    let position_dx = dpdx(input.relativePosition);
#ifdef PARALLAX
    // Parallax shifts every map's coordinates of the set that the displacement map reads, where
    // the view ray meets its relief.
    let values = custom_value(pixel_material, 0u);
    let pixel_layer = custom_value(pixel_material, 2u).w;
    if map_ready(pixel_layer) {
        let on_second = values.w != 0.0;
        var at = first;
        if on_second {
            at = second;
        }
        let along_y = position_dy * ROWS_UP;
        let shift = parallax_shift(
            pixel_layer, at, input.normal, input.viewDirection, position_dx, along_y,
            height_scale, surface_height,
        );
        if on_second {
            second.uv += shift;
        } else {
            first.uv += shift;
        }
    }
#endif
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
    specular_texel = vec4f(1.0);
#ifdef COAT_SHEEN
    // A layered material's slots 5 to 7 hold its coat, coat normal and sheen maps.
    if map_ready(m.more_maps.y) {
        let texel = light_texel(m.more_maps.y, map_uv(flags, 5u, first, second));
        s.clearcoat *= select(1.0, texel.r, (flags & COAT_MAP) != 0u);
        s.clearcoatRoughness *= select(1.0, texel.g, (flags & COAT_ROUGHNESS_MAP) != 0u);
    }
    if map_ready(m.more_maps.z) {
        let at = map_uv(flags, 6u, first, second);
        let texel = specular_intensity_texel(m.more_maps.z, at);
        let scale = coat_sheen_row.coat.zw;
        s.clearcoatNormal = bent_normal(texel, scale, at, input, position_dx, position_dy);
    }
    if map_ready(m.more_maps.w) {
        let texel = specular_color_texel(m.more_maps.w, map_uv(flags, 7u, first, second));
        s.sheenColor *= select(vec3f(1.0), texel.rgb, (flags & SHEEN_COLOR_MAP) != 0u);
        s.sheenRoughness *= select(1.0, texel.a, (flags & SHEEN_ROUGHNESS_MAP) != 0u);
    }
#else
    if map_ready(m.more_maps.y) {
        let texel = light_texel(m.more_maps.y, map_uv(flags, 5u, first, second));
        s.irradiance = texel.rgb * m.strengths.y;
    }
    if map_ready(m.more_maps.z) {
        specular_texel.a = specular_intensity_texel(m.more_maps.z, map_uv(flags, 6u, first, second)).a;
    }
    if map_ready(m.more_maps.w) {
        let texel = specular_color_texel(m.more_maps.w, map_uv(flags, 7u, first, second));
        specular_texel = vec4f(texel.rgb, specular_texel.a);
    }
#endif
    // A height map in the normal map's slot bends the normal only in the builds that read it, so
    // the others draw such a material's normals unbent.
    let heights = flags & (BUMP_MAP | HEIGHT_NORMALS);
#ifdef BUMP
    if heights == BUMP_MAP && map_ready(m.maps.z) {
        let change = height_change(m.maps.z, height_uv(flags, first, second)) * m.surface.z;
        let facing = select(-1.0, 1.0, input.frontFacing);
        s.normal = bent_by_height(input.normal, normalize(position_dx), normalize(position_dy), change, facing);
    }
#endif
#ifdef DISPLACEMENT
    if heights == HEIGHT_NORMALS && map_ready(m.maps.z) {
        let change = height_slope_change(m.maps.z, height_uv(flags, first, second)) * height_scale;
        let facing = select(-1.0, 1.0, input.frontFacing);
        s.normal = bent_by_height(input.normal, position_dx, position_dy, change, facing);
    }
#endif
    if heights == 0u && map_ready(m.maps.z) {
        let at = map_uv(flags, 2u, first, second);
        let texel = normal_texel(m.maps.z, at);
        s.normal = bent_normal(texel, m.surface.zw, at, input, position_dx, position_dy);
    }
    return s;
}

/// The input's normal bent by a normal map's `texel`, read at `at`, whose bends along u and v
/// take `scale`. The frame comes from the mesh's tangents with VERTEX_TANGENT, and otherwise from
/// how the position, whose changes across a pixel and up a row are `position_dx` and
/// `position_dy`, and the map's coordinates change between pixels.
fn bent_normal(
    texel: vec4f,
    scale: vec2f,
    at: MapUv,
    input: SurfaceInput,
    position_dx: vec3f,
    position_dy: vec3f,
) -> vec3f {
    let bent = vec3f((texel.xy * 2.0 - 1.0) * scale, texel.z * 2.0 - 1.0);
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
    let size = select(inverseSqrt(det), 0.0, det == 0.0);
    tangent *= size * facing;
    bitangent *= size * facing;
#endif
    return normalize(tangent * bent.x + bitangent * bent.y + normal * bent.z);
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
#ifdef COAT_SHEEN
    s.clearcoat = coat_sheen_row.coat.x;
    s.clearcoatRoughness = coat_sheen_row.coat.y;
    s.clearcoatNormal = input.normal;
    s.sheenColor = coat_sheen_row.sheen.rgb;
    s.sheenRoughness = coat_sheen_row.sheen.w;
#else ifdef CUSTOM
    s.clearcoat = 0.0;
    s.clearcoatRoughness = 0.0;
    s.clearcoatNormal = input.normal;
    s.sheenColor = vec3f(0.0);
    s.sheenRoughness = 1.0;
#endif
#ifdef MAPS
    s = with_maps(s, input);
#endif
    return s;
}

#ifndef DECAL
@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
#ifdef ROW_VALUES
    let row = row_values_of(found);
#endif
#ifdef CUSTOM
    let origin = relative_position(found, vec3f(0.0));
    fill_builtins(origin);
#ifdef ROW_VALUES
    object.values = row.values;
#endif
#ifdef OBJECT_IDS
    let ids = object_ids(found);
    object.id = ids.y;
#endif
#ifdef OBJECT_MATRICES
    object.worldMatrix = affine_matrix(found.row_x, found.row_y, found.row_z);
    object.normalMatrix = affine_normal_matrix(found.row_x, found.row_y, found.row_z);
#endif
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
    var offset_input: VertexInput;
    offset_input.position = position;
    offset_input.normal = normal;
    offset_input.uv = mesh_uv(v.uv0);
#ifdef CUSTOM_UV1
    offset_input.uv1 = mesh_second_uv(v.uv1);
#endif
#ifdef OBJECT_IDS
    offset_input.instance = ids.x;
#endif
    let offset = vertexOffset(offset_input);
    out.relative = relative_position(found, position + offset);
#else ifdef DISPLACEMENT
    let unit_normal = normalize(normal);
    let values = custom_value(found.material, 0u);
    let moved = displacement(found.material, values, mesh_uv(v.uv0), mesh_second_uv(v.uv1));
    out.relative = relative_position(found, position + unit_normal * moved);
    let stretch = length(world_direction(found, unit_normal));
    out.heights = vec2f(values.y, moved - values.z) * stretch;
#else
    out.relative = relative_position(found, position);
#endif
#ifdef CASTER
    var clip = caster_clip(found, out.relative, normal);
    clip.z = min(clip.z, clip.w);
    out.clip = clip;
#else
    out.clip = clip_of(found, out.relative);
#endif
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
#else ifdef CUSTOM_UV1
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
#ifdef ROW_VALUES
    out.row_color = row.color;
#ifdef CUSTOM
    out.row_values = row.values;
#endif
#endif
#ifdef LOD_FADE
    out.lod_fade = instance_fade(i);
#endif
#ifdef OBJECT_MATRICES
    out.world_x = found.row_x;
    out.world_y = found.row_y;
    out.world_z = found.row_z;
#endif
#ifdef OBJECT_IDS
    out.ids = ids;
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
#endif

/// The light that a surface reflects toward the camera from the scene's lights: the sun, less
/// where its shadows fall, the point and spot lights of the surface's cluster, the ambient and
/// hemisphere lights, `extra` irradiance such as a light map's, and the environment's light times
/// the material's factor of it. The environment's light adds to the ambient and hemisphere lights,
/// as three.js adds it, and neither its intensity nor the material's factor scales them.
/// `occlusion` darkens the ambient and hemisphere lights and the environment's diffuse light, and
/// its specular light as three.js's `computeSpecularOcclusion` does. The environment's specular
/// light also fades where the shading `normal` reflects the view below the mesh's own
/// `vertex_normal`. `contact` is the share of the sun's light that the sun's contact shadows let
/// through. `relative` is the surface's position relative to the camera, `to_view` points from the
/// surface toward the camera, and `dfg` holds the split-sum terms at the surface's roughness and
/// view angle. In custom materials, `reflection` holds light from the mirror direction and its
/// share, which takes the place of that share of the environment's reflection, with or without an
/// environment.
fn light_surface(
    m: PbrMaterial,
    relative: vec3f,
    normal: vec3f,
    vertex_normal: vec3f,
    to_view: vec3f,
    dfg: vec2f,
    extra: vec3f,
    occlusion: f32,
    contact: f32,
#ifdef CUSTOM
    reflection: vec4f,
#endif
) -> vec3f {
    let compensation = multiscatter_compensation(m.specular_blended, dfg);
    let to_sun = -engine_frame.sun_direction.xyz;
    var sun_color = engine_frame.sun_color.rgb;
#ifdef RECEIVE_SHADOWS
    // A surface that faces away from the sun gets none of its light whatever the shadow map
    // holds, so it skips the lookup and the filter's reads. A coat that faces the sun still
    // takes its shadow. Contact shadows add the short shadows that the map's texels are too
    // coarse to hold.
#ifdef COAT_SHEEN
    let facing = max(dot(normal, to_sun), coat_facing(to_sun));
#else
    let facing = dot(normal, to_sun);
#endif
    if facing > 0.0 {
        sun_color *= sun_shadow(relative + engine_frame.shadow_origin.xyz, normal, to_sun) * contact;
    }
#endif
#ifdef COAT_SHEEN
    // The layers gather their light first, and the sheen keeps part of it from the base.
    sun_color *= layered_light(normal, to_view, to_sun, sun_color);
#endif
    let sun = direct_light(m, normal, to_view, to_sun, sun_color, compensation);
    let clustered = clustered_light(m, relative, normal, to_view, compensation);
    let n_dot_v = saturate(dot(normal, to_view));
    let surrounding_light = ambient_light(normal) + extra;
#ifdef COAT_SHEEN
    let ambient = indirect_diffuse(m, surrounding_light, dfg)
        * layered_ambient(surrounding_light, n_dot_v, occlusion);
#else
    let ambient = indirect_diffuse(m, surrounding_light, dfg);
#endif
    let direct = sun.diffuse + sun.specular + clustered.diffuse + clustered.specular;
    var indirect = ambient * occlusion;
#ifdef TRANSMISSION
    diffuse_light = sun.diffuse + clustered.diffuse + indirect;
#endif
    let env = engine_frame.environment;
#ifdef CUSTOM
    let mirrored = saturate(reflection.a);
#ifdef PROBE_GRID
    if has_environment(env) || mirrored > 0.0 || has_probe_grid(engine_frame.probe_grid) {
#else
    if has_environment(env) || mirrored > 0.0 {
#endif
        let strength = select(0.0, material_row.uv_u.w, has_environment(env));
        var irradiance = environment_irradiance(env, normal) * strength;
        let surrounding = environment_radiance(env, to_view, normal, m.roughness) * strength;
        let radiance = mix(surrounding, reflection.rgb, mirrored);
#else
#ifdef PROBE_GRID
    if has_environment(env) || has_probe_grid(engine_frame.probe_grid) {
#else
    if has_environment(env) {
#endif
        let strength = material_row.uv_u.w;
        var irradiance = environment_irradiance(env, normal) * strength;
        let radiance = environment_radiance(env, to_view, normal, m.roughness) * strength;
#endif
        // The probe grid takes the environment's diffuse light over where the sketch sets one.
#ifdef PROBE_GRID
        if has_probe_grid(engine_frame.probe_grid) {
            let world = engine_frame.camera_world.xyz + relative + engine_frame.shadow_origin.xyz;
            irradiance = mix(irradiance, probe_grid_irradiance(engine_frame.probe_grid, world, normal), engine_frame.probe_grid.params.y);
        }
#endif
        var image = indirect_specular(m, radiance, irradiance, dfg);
#ifdef COAT_SHEEN
        // The sheen takes its share of the environment's light, and the coat reflects it at its
        // own normal and roughness.
        let share = layered_ambient(irradiance, n_dot_v, occlusion);
        image.diffuse *= share;
        image.specular *= share;
#ifdef CUSTOM
        let coat_radiance = mix(coat_environment(env, to_view, strength), reflection.rgb, mirrored);
#else
        let coat_radiance = coat_environment(env, to_view, strength);
#endif
        layered_environment(coat_radiance, to_view, occlusion);
#endif
        let fading = horizon_occlusion(to_view, normal, vertex_normal);
        let specular = image.specular * (specular_occlusion(n_dot_v, occlusion, m.roughness) * fading);
        indirect += image.diffuse * occlusion + specular;
#ifdef TRANSMISSION
        diffuse_light += image.diffuse * occlusion;
#endif
    }
    return direct + indirect;
}

/// The color a shadow-catcher surface writes: its own color where the main directional light's
/// shadows fall, and nothing where the light reaches it, as three.js's `ShadowMaterial`. The alpha
/// is the material's opacity times the shadow. A lit part of the surface then draws nothing, and the
/// camera sees what lies behind it. The exposure and the tone mapping apply, and the scene's fog does
/// not, as three.js applies them to that material. Only the main directional light's shadows fall on
/// it. The mesh must receive shadows, so a build without `RECEIVE_SHADOWS` draws nothing.
fn shadow_catcher(s: Surface, input: SurfaceInput, pixel: vec4f) -> vec4f {
    var shadow = 0.0;
#ifdef RECEIVE_SHADOWS
    shadow = 1.0 - sun_shadow(
        input.relativePosition + engine_frame.shadow_origin.xyz,
        s.normal,
        -engine_frame.sun_direction.xyz,
    );
#endif
    return fragment_color(material_row, finish(s.baseColor, pixel.xy).rgb, s.alpha * shadow);
}

/// The color of a pixel that shows the surface: the light it reflects and the light it gives off,
/// in the scene's fog, finished for the screen at the pixel's position, and premultiplied by its
/// alpha when the material blends. `pixel` is the fragment's position, whose depth places it in
/// the frame's screen texture. Its ambient occlusion darkens the indirect light, with the surface's
/// own occlusion, and its contact shadows darken the sun's light where the surface receives
/// shadows. A shadow-catcher material draws only the sun's shadows instead (`shadow_catcher`).
fn shade(s: Surface, input: SurfaceInput, pixel: vec4f) -> vec4f {
    let normal = normalize(s.normal);
    // Where the mesh's normal changes fast between pixels, highlights widen, so they flicker less
    // as the surface moves. As in Filament, the normal is the mesh's own, before a map or a surface
    // function bends it.
#ifdef DECAL
    // A decal's normal comes from the depths around the pixel, whose changes say nothing of how
    // the mesh curves, so its highlights keep their own sharpness.
    let kernel = 0.0;
#else
    let kernel = specular_aa_kernel(dpdx(input.normal), dpdy(input.normal));
#endif
    // The alpha tests' derivatives come here too, before the shadow-catcher branch: a derivative
    // must run in uniform control flow, and everything after the branch depends on it.
#ifdef ALPHA_HASH
    let hash_threshold = alpha_hash_threshold(hash_place);
#endif
#ifdef ALPHA_COVERAGE
    let alpha_width = fwidth(s.alpha);
#endif
    if (u32(material_row.strengths.z) & SHADOW_CATCHER_FLAG) != 0u {
        return shadow_catcher(s, input, pixel);
    }
    // The material's dielectric specular values, times its specular maps in the MAPS builds.
    var specular = material_row.specular;
#ifdef MAPS
    specular *= specular_texel;
#endif
    let plain = pbr_material(s.baseColor, s.metalness, s.roughness, kernel);
    let pbr = with_specular(plain, material_row.uv_v.w, specular.rgb, specular.a);
    let n_dot_v = saturate(dot(normal, input.viewDirection));
    let dfg = dfg_lut(n_dot_v, pbr.roughness);
#ifdef COAT_SHEEN
    // The coat's roughness takes the clearcoat floor and the geometry's roughness, as three.js's
    // physical material does.
    var coat_sheen: Layers;
    coat_sheen.coat = saturate(s.clearcoat);
    coat_sheen.coat_roughness = max(
        pbr_material(vec3f(0.0), 0.0, s.clearcoatRoughness, kernel).roughness,
        0.0525,
    );
    coat_sheen.coat_normal = normalize(s.clearcoatNormal);
    coat_sheen.sheen_color = max(s.sheenColor, vec3f(0.0));
    coat_sheen.sheen_roughness = clamp(s.sheenRoughness, 0.0001, 1.0);
    begin_layers(coat_sheen);
#endif
    // The frame's lights are exposed already. The surface's own light and its baked light take the
    // exposure here.
#ifdef TRANSMISSION
    // The surface draws over the surfaces that ambient occlusion saw, as a blended one does.
    let blended = true;
#else
    let blended = (u32(material_row.strengths.z) & BLEND_FLAG) != 0u;
#endif
    let screen = screen_values(pixel.xyz, blended);
    let reflected = light_surface(
        pbr,
        input.relativePosition,
        normal,
        input.normal,
        input.viewDirection,
        dfg,
        s.irradiance * engine_frame.output.exposure,
        s.occlusion * screen_occlusion(screen),
        screen.w,
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
#ifdef COAT_SHEEN
    // The sheen's light joins the base's, and the coat covers both.
    let layered = finish_layers(outgoing, input.viewDirection);
#else
    let layered = outgoing;
#endif
    // The test comes last, after every derivative, which a discarded fragment still helps compute.
#ifdef ALPHA_HASH
    if s.alpha < hash_threshold {
        discard;
    }
#else ifdef ALPHA_COVERAGE
    let coverage = alpha_coverage(s.alpha, alpha_width, material_row.emissive.w);
    if coverage <= 0.0 {
        discard;
    }
#else ifdef ALPHA_MASK
    if s.alpha < material_row.emissive.w {
        discard;
    }
#endif
#ifdef LOD_FADE
    if !lod_kept(lod_fade, pixel.xy) {
        discard;
    }
#endif
#ifdef TRANSMISSION
#ifdef TONE_MAP
    // The copy holds display color, darkened by the vignette already, so the light from behind
    // joins after the tone mapping, as far as the fog lets it.
    let unfogged = (u32(material_row.strengths.z) & NO_FOG) != 0u;
    let fog = select(fog_factor(engine_frame.fog, input.relativePosition), 0.0, unfogged);
    let shade = vignette(pixel.xy, engine_frame.target_size.xy, engine_frame.vignette);
    let shaded = fogged(layered, input.relativePosition, material_row) * shade;
    let toned = tone_map(shaded, engine_frame.output);
#ifdef COAT_SHEEN
    let display = toned + through * share * (1.0 - fog) * coat_transmittance(input.viewDirection);
#else
    let display = toned + through * share * (1.0 - fog);
#endif
    let finished = vec4f(encode(saturate(display), pixel.xy), 1.0);
#else
    let finished = finish_exposed(fogged(layered, input.relativePosition, material_row), pixel.xy);
#endif
#else
    let finished = finish_exposed(fogged(layered, input.relativePosition, material_row), pixel.xy);
#endif
#ifdef DECAL
    let shown = saturate(s.alpha) * decal_fade;
    return vec4f(finished.rgb * shown, shown);
#else ifdef ALPHA_COVERAGE
    return vec4f(finished.rgb, coverage);
#else
    return fragment_color(material_row, finished.rgb, s.alpha);
#endif
}

#ifndef DECAL
@fragment
#ifdef SAMPLE_MASK
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> MaskedFragment {
#else ifdef WEIGHTED
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> WeightedFragment {
#else
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
#endif
#ifdef CASTER
    return vec4f(0.0);
#else
    material_row = material_of(in.material);
#ifdef TRANSMISSION
    transmission_row = material_transmission(in.material);
    object_scale = in.scale;
#endif
#ifdef COAT_SHEEN
    coat_sheen_row = material_coat_sheen(in.material);
#endif
#ifdef ALPHA_HASH
    hash_place = in.mesh_place;
#endif
#ifdef DISPLACEMENT
    height_scale = in.heights.x;
#endif
#ifdef PARALLAX
    surface_height = in.heights.y;
    pixel_material = in.material;
#endif
#ifdef LOD_FADE
    lod_fade = in.lod_fade;
#endif
#ifdef CUSTOM
    fill_builtins(in.origin);
#ifdef ROW_VALUES
    object.values = in.row_values;
#endif
#ifdef OBJECT_IDS
    object.id = in.ids.y;
#endif
#ifdef OBJECT_MATRICES
    object.worldMatrix = affine_matrix(in.world_x, in.world_y, in.world_z);
    object.normalMatrix = affine_normal_matrix(in.world_x, in.world_y, in.world_z);
#endif
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
#ifdef ROW_VALUES
    input.vertexColor *= in.row_color;
#endif
#ifdef CUSTOM
    input.worldPosition = in.relative + engine_frame.camera_world.xyz;
#endif
#ifdef MAPS
    input.uv = in.uv.xy;
    input.uv1 = in.uv.zw;
#else ifdef CUSTOM_UV1
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
#ifdef CUSTOM
    // Pixel rows count upward on WebGL2, so its rows turn to count from the top, as on WebGPU.
    var coord = in.clip.xyz;
#ifdef WEBGL2
    coord.y = engine_frame.target_size.y - coord.y;
#endif
    input.fragCoord = coord;
#endif
#ifdef OBJECT_IDS
    input.instance = in.ids.x;
#endif
#ifdef CUSTOM_SURFACE
    let s = surface(input);
#else
    let s = defaultSurface(input);
#endif
#ifdef SAMPLE_MASK
    return masked_fragment(shade(s, input, in.clip));
#else ifdef WEIGHTED
    return weighted_fragment(shade(s, input, in.clip), in.relative);
#else
    return shade(s, input, in.clip);
#endif
#endif
}
#else
@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.relative = relative_position(found, mesh_position(v.position));
    out.clip = clip_of(found, out.relative);
    // A perspective camera's clip w is the distance along its view. An orthographic camera's view
    // runs away from the direction toward it.
    let eye = engine_frame.camera_position;
    out.distance = select(dot(out.relative, -eye.xyz), out.clip.w, eye.w > 0.5);
    out.material = found.material;
    out.origin = relative_position(found, vec3f(0.0));
    let x = world_direction(found, vec3f(1.0, 0.0, 0.0));
    let y = world_direction(found, vec3f(0.0, 1.0, 0.0));
    let z = world_direction(found, vec3f(0.0, 0.0, 1.0));
    // The inverse of the matrix whose columns are the box's axes, by its cofactors. A flat box has
    // none, and marks nothing.
    let det = dot(x, cross(y, z));
    let scale = select(0.0, 1.0 / det, abs(det) > 1e-20);
    out.to_box_x = cross(y, z) * scale;
    out.to_box_y = cross(z, x) * scale;
    out.to_box_z = cross(x, y) * scale;
#ifdef ROW_VALUES
    out.row_color = row_values_of(found).color;
#endif
    return out;
}

/// The scene's depth value at a texel of its depth target, from 1 at the near plane to 0 at the far
/// plane, with the texel kept inside the target.
fn decal_depth_at(texel: vec2i) -> f32 {
    let last = vec2i(textureDimensions(decal_depth)) - 1;
    return textureLoad(decal_depth, clamp(texel, vec2i(0), last), 0).x;
}

/// How far in front of the camera, along its view, a surface with depth value `depth` lies.
fn decal_distance(depth: f32) -> f32 {
    let near = engine_frame.camera_range.x;
    let far = engine_frame.camera_range.y;
    if engine_frame.camera_position.w > 0.5 {
        let ratio = near / far;
        return near / max(ratio + depth * (1.0 - ratio), 1e-7);
    }
    return far - depth * (far - near);
}

/// The surface under a point of the box's face that lies `along` in front of the camera, where
/// the scene's depth is `depth`, relative to the camera: along the view ray through the point, at
/// the surface's distance.
fn decal_surface(relative: vec3f, along: f32, depth: f32) -> vec3f {
    let eye = engine_frame.camera_position;
    let to = decal_distance(depth);
    if eye.w > 0.5 {
        return relative * (to / max(along, 1e-7));
    }
    return relative - eye.xyz * (to - along);
}

/// A share that rises smoothly from 0 at `low` to 1 at `high`.
fn decal_ramp(low: f32, high: f32, x: f32) -> f32 {
    let t = saturate((x - low) / max(high - low, 1e-4));
    return t * t * (3.0 - 2.0 * t);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    material_row = material_of(in.material);
    // The derivatives come first, while every pixel of the quad runs.
    let step_x = dpdx(in.relative);
    let step_y = dpdy(in.relative);
    let distance_x = dpdx(in.distance);
    let distance_y = dpdy(in.distance);
    let texel = vec2i(floor(in.clip.xy));
    let depth = decal_depth_at(texel);
    let right_depth = decal_depth_at(texel + vec2i(1, 0));
    let left_depth = decal_depth_at(texel - vec2i(1, 0));
    let next_depth = decal_depth_at(texel + vec2i(0, 1));
    let last_depth = decal_depth_at(texel - vec2i(0, 1));
    let center = decal_surface(in.relative, in.distance, depth);
    let right = decal_surface(in.relative + step_x, in.distance + distance_x, right_depth);
    let left = decal_surface(in.relative - step_x, in.distance - distance_x, left_depth);
    let next = decal_surface(in.relative + step_y, in.distance + distance_y, next_depth);
    let last = decal_surface(in.relative - step_y, in.distance - distance_y, last_depth);
    // On each axis, the neighbor whose depth lies closer belongs to the same surface, so the
    // normal holds at the edges of objects.
    let across = select(center - left, right - center, abs(right_depth - depth) < abs(depth - left_depth));
    let down = select(center - last, next - center, abs(next_depth - depth) < abs(depth - last_depth));
    let eye = engine_frame.camera_position;
    let to_view = normalize(eye.xyz - center * eye.w);
    let face = normalize(cross(across, down));
    let normal = select(-face, face, dot(face, to_view) >= 0.0);

    // The surface in the box's own space, from -0.5 to 0.5 on each axis inside it.
    let from_origin = center - in.origin;
    let local = vec3f(
        dot(in.to_box_x, from_origin),
        dot(in.to_box_y, from_origin),
        dot(in.to_box_z, from_origin),
    );
    let values = decal_values(in.material);
    let facing = dot(normal, normalize(in.to_box_z));
    let angle_fade = decal_ramp(values.y, values.x, facing);
    let edge_fade = saturate((1.0 - abs(local.z) * 2.0) / max(values.z, 1e-4));
    let inside = all(abs(local) <= vec3f(0.5)) && depth > 0.0;
    decal_fade = select(0.0, angle_fade * edge_fade, inside);
    if decal_fade <= 0.0 {
        discard;
    }
    decal_uv_dx = vec2f(dot(in.to_box_x, across), dot(in.to_box_y, across));
    decal_uv_dy = vec2f(dot(in.to_box_x, down), dot(in.to_box_y, down));

    var input: SurfaceInput;
    input.relativePosition = center;
    input.viewDirection = to_view;
    input.normal = normal;
    input.vertexColor = vec4f(1.0);
#ifdef ROW_VALUES
    input.vertexColor = in.row_color;
#endif
#ifdef MAPS
    input.uv = local.xy + 0.5;
    input.uv1 = input.uv;
#endif
    // The normal map's frame: the box's x and y axes, laid onto the surface.
    input.tangent = in.to_box_x - normal * dot(in.to_box_x, normal);
    input.bitangent = in.to_box_y - normal * dot(in.to_box_y, normal);
    input.frontFacing = true;
    let s = defaultSurface(input);
    return shade(s, input, vec4f(in.clip.xy, depth, 1.0));
}
#endif

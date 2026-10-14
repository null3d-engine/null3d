#define_import_path null3d::lights
#ifdef AREA_LIGHTS
#import null3d::area_lights::{range_window, rectangle_light, tube_light}
#import null3d::tables::{AreaTerms, area_terms}
#endif
#import null3d::lighting::{PbrMaterial, Reflected, distance_attenuation, spot_attenuation}
#ifdef HALF
#import null3d::half::{direct_light}
#else
#import null3d::lighting::{direct_light}
#endif
#import null3d::mesh::{frame}
#ifdef RECEIVE_SHADOWS
#import null3d::shadows::{light_shadow}
#endif
#ifdef COAT_SHEEN
#import null3d::coat_sheen::{layered_light}
#endif

// The point and spot lights of clustered forward shading. Each frame the engine cuts the camera's
// view into clusters: tiles across the view, in slices along it that grow with distance. For each
// cluster it lists the point and spot lights whose ranges reach it. A surface finds its cluster
// from its position and lights itself with that cluster's lights alone, so its loop stays short
// with hundreds of lights in view.
//
// Two bindings of the frame's group hold the lists. The light grid at binding 7 holds one 32-bit
// word per cluster, then the light index list. A cluster's word holds where its lights start in
// the grid in its low START_BITS bits, and how many there are in the bits above. The light list at
// binding 8 holds the lights, four vectors each. On WebGPU both are storage buffers that fragment
// shaders read. On WebGL2 (the WEBGL2 builds) both share one data texture of 32-bit integers at
// binding 7, read with `textureLoad`, so they take one texture unit: the lights in the columns of
// its first half, four texels each, and the grid in the columns of its second half, four words per
// texel. The frame's `cluster_depth` and `cluster_grid` find a position's cluster.

/// Bits of a cluster's word that hold where its lights start in the light grid.
const START_BITS: u32 = 23u;

#ifdef AREA_LIGHTS
/// The kind of a rectangle light's record: the core's `RECT`. Kinds from it on are area lights.
const KIND_RECT: u32 = 6u;
/// The kind of a tube light's record: the core's `TUBE`.
const KIND_TUBE: u32 = 7u;
#endif

/// A point or spot light, as the light list holds it. Colors are linear and include the
/// intensity. A point light shines in every direction: its cone cosines let every direction
/// through. An area light's record keeps its shape where a point or spot light keeps its decay
/// and cone (see `area_across`).
struct PointLight {
    /// The position relative to the camera, and the range in meters where the light ends.
    position_range: vec4f,
    /// The color, and how fast the light fades with distance.
    color_decay: vec4f,
    /// The direction a spot light's light travels, and the cosine of the angle of its cone's
    /// edge.
    direction_cone: vec4f,
    /// The cosine of the angle where a spot light's penumbra starts, then the light's kind and row,
    /// which are for the engine, then its first tile in the shadow atlas plus one, or 0 when it
    /// has none.
    penumbra: vec4f,
}

#ifdef WEBGL2
/// Lights per row of the light data texture are 1 << LIGHT_ROW_SHIFT, four texels each, from its
/// first column.
const LIGHT_ROW_SHIFT: u32 = 8u;
/// Words of the light grid per row of the light data texture are 1 << WORD_ROW_SHIFT, four per
/// texel, from column GRID_COLUMN.
const WORD_ROW_SHIFT: u32 = 12u;
const GRID_COLUMN: u32 = 1024u;

@group(0) @binding(7) var light_data: texture_2d<u32>;
#else
@group(0) @binding(7) var<storage, read> light_grid: array<u32>;
@group(0) @binding(8) var<storage, read> light_list: array<PointLight>;
#endif

/// Word `i` of the light grid.
fn grid_word(i: u32) -> u32 {
#ifdef WEBGL2
    let within = i & ((1u << WORD_ROW_SHIFT) - 1u);
    let at = vec2u(GRID_COLUMN + (within >> 2u), i >> WORD_ROW_SHIFT);
    return textureLoad(light_data, at, 0)[within & 3u];
#else
    return light_grid[i];
#endif
}

/// Light `i` of the light list.
fn light_of(i: u32) -> PointLight {
#ifdef WEBGL2
    let row = (1u << LIGHT_ROW_SHIFT) - 1u;
    let at = vec2u((i & row) * 4u, i >> LIGHT_ROW_SHIFT);
    return PointLight(
        bitcast<vec4f>(textureLoad(light_data, at, 0)),
        bitcast<vec4f>(textureLoad(light_data, at + vec2u(1u, 0u), 0)),
        bitcast<vec4f>(textureLoad(light_data, at + vec2u(2u, 0u), 0)),
        bitcast<vec4f>(textureLoad(light_data, at + vec2u(3u, 0u), 0)),
    );
#else
    return light_list[i];
#endif
}

#ifdef AREA_LIGHTS
/// An area light's second vector: a rectangle's half side along its Y axis, or a tube's radius
/// and two zeros. Its record keeps it in the places of a spot light's decay and cone cosines,
/// and its first vector, half the rectangle's X side or half the tube's axis, in `direction_cone`.
fn area_across(light: PointLight) -> vec3f {
    return vec3f(light.color_decay.w, light.direction_cone.w, light.penumbra.x);
}

/// The light that a PBR surface reflects from one area light, with `terms` from the tables for the
/// surface's view and roughness.
fn area_light(
    m: PbrMaterial,
    terms: AreaTerms,
    light: PointLight,
    kind: u32,
    relative: vec3f,
    normal: vec3f,
    to_view: vec3f,
) -> Reflected {
    let toward = light.position_range.xyz - relative;
    let color = light.color_decay.rgb * range_window(length(toward), light.position_range.w);
    let along = light.direction_cone.xyz;
    let across = area_across(light);
    if kind == KIND_TUBE {
        return tube_light(m, terms, normal, to_view, toward, along, across.x, color);
    }
    // A rectangle light keeps its image's layer plus one where a spot light keeps its tile.
    let image = i32(light.penumbra.w) - 1;
    return rectangle_light(m, terms, normal, to_view, toward, along, across, color, image);
}
#endif

/// The lights of the cluster that holds a position relative to the camera: where they start in
/// the light grid, and how many there are. A position past the last slice, or in a view whose
/// grid lists no light, has none.
fn cluster_lights(relative: vec3f) -> vec2u {
    let grid = frame.cluster_grid;
    if grid.z == 0.0 {
        return vec2u(0u);
    }
    let clip = frame.view_proj * vec4f(relative, 1.0);
    let tile = clamp(floor((clip.xy / clip.w * 0.5 + 0.5) * grid.xy), vec2f(0.0), grid.xy - 1.0);
    let slice_depth = max(dot(frame.cluster_depth, vec4f(relative, 1.0)), 1.0);
    let slice = floor(log2(slice_depth) * grid.w);
    if slice >= grid.z {
        return vec2u(0u);
    }
    let tiles = vec2u(grid.xy);
    let cluster = (u32(slice) * tiles.y + u32(tile.y)) * tiles.x + u32(tile.x);
    let word = grid_word(cluster);
    return vec2u(word & ((1u << START_BITS) - 1u), word >> START_BITS);
}

/// The light that a PBR surface reflects toward the camera from the point, spot and area lights of
/// its cluster, as three.js's `RE_Direct_Physical` gives it for each point and spot light, and its
/// `RE_Direct_RectArea_Physical` for each area light. `relative` is the
/// surface's position relative to the camera, `normal` its unit normal, and `to_view` the unit
/// direction toward the camera. `compensation` comes from `multiscatter_compensation`. In the
/// COAT_SHEEN builds each light lights the surface's clear coat and sheen too (null3d::coat_sheen).
fn clustered_light(
    m: PbrMaterial,
    relative: vec3f,
    normal: vec3f,
    to_view: vec3f,
    compensation: vec3f,
) -> Reflected {
    var sum = Reflected(vec3f(0.0), vec3f(0.0));
    let found = cluster_lights(relative);
#ifdef AREA_LIGHTS
    // The area lights' tables for the surface, read with the cluster's first area light. The
    // builds without AREA_LIGHTS meet no area light: the light grid lists them only while the lit
    // pipelines draw with these builds.
    var terms = AreaTerms(vec4f(0.0), vec2f(0.0));
    var have_terms = false;
#endif
    for (var k = 0u; k < found.y; k++) {
        let light = light_of(grid_word(found.x + k));
#ifdef AREA_LIGHTS
        let kind = bitcast<u32>(light.penumbra.y);
        if kind >= KIND_RECT {
            if !have_terms {
                terms = area_terms(dot(normal, to_view), m.roughness);
                have_terms = true;
            }
            let reflected = area_light(m, terms, light, kind, relative, normal, to_view);
            sum.diffuse += reflected.diffuse;
            sum.specular += reflected.specular;
            continue;
        }
#endif
        let offset = light.position_range.xyz - relative;
        let gap = length(offset);
        let to_light = offset / max(gap, 1e-6);
        let fade = distance_attenuation(gap, light.position_range.w, light.color_decay.w);
        let cone = spot_attenuation(
            light.direction_cone.w,
            light.penumbra.x,
            dot(-to_light, light.direction_cone.xyz),
        );
        var strength = fade * cone;
#ifdef RECEIVE_SHADOWS
        let tile = light.penumbra.w;
        if tile > 0.5 && strength > 0.0 {
            let seen = relative + frame.shadow_origin.xyz;
            strength *= light_shadow(u32(tile) - 1u, seen, normal, to_light, gap);
        }
#endif
        var incoming = light.color_decay.rgb * strength;
#ifdef COAT_SHEEN
        // The layers gather their light first, and the sheen keeps part of it from the base.
        incoming *= layered_light(normal, to_view, to_light, incoming);
#endif
        let reflected = direct_light(m, normal, to_view, to_light, incoming, compensation);
        sum.diffuse += reflected.diffuse;
        sum.specular += reflected.specular;
    }
    return sum;
}

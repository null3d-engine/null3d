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
#import null3d::tables::{IMAGE_LEVELS, IMAGE_SIZE, light_image}
#ifdef RECEIVE_SHADOWS
#import null3d::shadows::{light_shadow}
#endif
#ifdef TRANSLUCENCY
#import null3d::translucency::{gather_back_light, lit_side}
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
// binding 8 holds the lights, five vectors each. On WebGPU both are storage buffers that fragment
// shaders read. On WebGL2 (the WEBGL2 builds) both share one data texture of 32-bit integers at
// binding 7, read with `textureLoad`, so they take one texture unit: the lights in the columns
// from its first, five texels each, and the grid in the columns after them, four words per texel.
// The frame's `cluster_depth` and `cluster_grid` find a position's cluster.

/// Bits of a cluster's word that hold where its lights start in the light grid.
const START_BITS: u32 = 23u;

/// The kind of a rectangle light's record: the core's `RECT`. Kinds from it on are area lights.
const KIND_RECT: u32 = 6u;
/// The kind of a tube light's record: the core's `TUBE`.
const KIND_TUBE: u32 = 7u;

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
    /// The up axis that a spot light's image reads with, or zero for a light without one, then the
    /// layer of the light's image in the light tables plus one, or 0 when it shows none.
    up_image: vec4f,
}

#ifdef WEBGL2
/// Lights per row of the light data texture are 1 << LIGHT_ROW_SHIFT, five texels each, from its
/// first column.
const LIGHT_ROW_SHIFT: u32 = 8u;
/// Texels of one light record: one per vector of four values.
const LIGHT_TEXELS: u32 = 5u;
/// Words of the light grid per row of the light data texture are 1 << WORD_ROW_SHIFT, four per
/// texel, from column GRID_COLUMN.
const WORD_ROW_SHIFT: u32 = 11u;
const GRID_COLUMN: u32 = 1280u;

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
    let at = vec2u((i & row) * LIGHT_TEXELS, i >> LIGHT_ROW_SHIFT);
    return PointLight(
        bitcast<vec4f>(textureLoad(light_data, at, 0)),
        bitcast<vec4f>(textureLoad(light_data, at + vec2u(1u, 0u), 0)),
        bitcast<vec4f>(textureLoad(light_data, at + vec2u(2u, 0u), 0)),
        bitcast<vec4f>(textureLoad(light_data, at + vec2u(3u, 0u), 0)),
        bitcast<vec4f>(textureLoad(light_data, at + vec2u(4u, 0u), 0)),
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
    // A rectangle light keeps its image's layer plus one in the place of a spot light's up axis
    // and image.
    let image = i32(light.up_image.w) - 1;
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

/// The map that a spot light projects over its cone at a surface, as three.js's spot light map
/// reads it: the map's color where the cone's square covers the surface, and white outside the
/// square, where the light shows one color. `relative` is the surface's position relative to the
/// camera, `normal` its unit normal, `to_view` the unit direction toward the camera, and
/// `to_light` the unit direction from the surface toward the light. The light's record holds the
/// map's layer in the light tables plus one and the up axis that it reads with.
fn spot_map(
    light: PointLight,
    relative: vec3f,
    normal: vec3f,
    to_view: vec3f,
    to_light: vec3f,
) -> vec3f {
    let forward = light.direction_cone.xyz;
    let up = light.up_image.xyz;
    let right = cross(forward, up);
    let ray = -to_light;
    let depth = dot(ray, forward);
    let cone_cos = light.direction_cone.w;
    // The half extent of the cone's square, where the map's edge lies, over the depth along the
    // light: the tangent of the cone's half angle.
    let stretch = sqrt(max(1.0 - cone_cos * cone_cos, 0.0)) / max(cone_cos, 1e-4);
    let uv = 0.5 + 0.5 * vec2f(dot(ray, right), dot(ray, up)) / (max(depth, 1e-4) * stretch);
    if (any(abs(uv * 2.0 - 1.0) >= vec2f(1.0))) {
        return vec3f(1.0);
    }
    // The map's texel at the surface covers a share of the cone's square. The level follows the
    // fragment's footprint on the surface against it: farther from the camera, and at a slant,
    // the footprint covers more texels, and the map blurs.
    let texel = 2.0 * depth * stretch / f32(IMAGE_SIZE);
    let camera_distance = mix(1.0, length(relative), frame.camera_position.w);
    let pixel = 2.0 * camera_distance / (frame.projection[0][0] * frame.target_size.x);
    let footprint = pixel / max(abs(dot(normal, to_view)), 0.1);
    let level = clamp(log2(max(footprint / texel, 1e-6)), 0.0, IMAGE_LEVELS - 1.0);
    return light_image(i32(light.up_image.w) - 1, uv, level);
}

/// The light that one direct light gives a PBR surface, as three.js's `RE_Direct_Physical` computes
/// it. `color` is the light's color after its fall-off and its shadows. In the COAT_SHEEN builds
/// the light enters the surface's clear coat and sheen first (null3d::coat_sheen), and in the
/// TRANSLUCENCY builds it also adds the share that reaches the surface's back
/// (null3d::translucency).
fn direct_surface_light(
    m: PbrMaterial,
    normal: vec3f,
    to_view: vec3f,
    to_light: vec3f,
    color: vec3f,
    compensation: vec3f,
) -> Reflected {
    var incoming = color;
#ifdef COAT_SHEEN
    // The layers gather their light first, and the sheen keeps part of it from the base.
    incoming *= layered_light(normal, to_view, to_light, incoming);
#endif
#ifdef TRANSLUCENCY
    gather_back_light(normal, to_light, incoming);
#endif
    return direct_light(m, normal, to_view, to_light, incoming, compensation);
}

/// The light that a PBR surface reflects toward the camera from the point, spot and area lights of
/// its cluster, as three.js's `RE_Direct_Physical` gives it for each point and spot light, and its
/// `RE_Direct_RectArea_Physical` for each area light. `relative` is the
/// surface's position relative to the camera, `normal` its unit normal, and `to_view` the unit
/// direction toward the camera. `compensation` comes from `multiscatter_compensation`. In the
/// TRANSLUCENCY builds each light also adds the light that reaches the surface's back, shadowed
/// from the side that it falls on (null3d::translucency). COAT_SHEEN builds each light lights the
/// surface's clear coat and sheen too (null3d::coat_sheen).
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
    // The area lights' tables for the surface, read with the cluster's first area light.
    var terms = AreaTerms(vec4f(0.0), vec2f(0.0));
    var have_terms = false;
#endif
    for (var k = 0u; k < found.y; k++) {
        let light = light_of(grid_word(found.x + k));
        let kind = bitcast<u32>(light.penumbra.y);
#ifdef AREA_LIGHTS
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
#else
        // The light grid lists area lights while any pipeline that shades them draws, which the
        // lit templates do once the scene holds one. This build has no tables to shade them with,
        // and its record's fields hold a rectangle's shape and image layer where a point or spot
        // light keeps its decay, cone and shadow tile, so it leaves those lights out.
        if kind >= KIND_RECT {
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
#ifdef TRANSLUCENCY
            let side = lit_side(normal, to_light);
            strength *= light_shadow(u32(tile) - 1u, seen, side, to_light, gap);
#else
            strength *= light_shadow(u32(tile) - 1u, seen, normal, to_light, gap);
#endif
        }
#endif
        var incoming = light.color_decay.rgb * strength;
        if (light.up_image.w > 0.5) {
            incoming *= spot_map(light, relative, normal, to_view, to_light);
        }
        let reflected = direct_surface_light(
            m,
            normal,
            to_view,
            to_light,
            incoming,
            compensation,
        );
        sum.diffuse += reflected.diffuse;
        sum.specular += reflected.specular;
    }
    return sum;
}

/// The directional lights after the main one that one frame can light a surface with. The frame
/// keeps their directions and colors in this many slots, and the sun color's w says how many are
/// set.
const FILL_LIGHT_SLOTS: u32 = 3u;

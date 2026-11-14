// The physical sky's tables (see null3d::sky_scattering), and the panorama of the sky that the sky's
// environment reads. Each draw is one triangle over its whole target, and the draw's first vertex
// names its step: the vertex index divided by three.
//
// - 0, transmittance: the share of light that passes from each height to the top of the air along
//   each angle, marched in 40 steps.
// - 1, multiple scattering: Hillaire's sum over 64 directions of 20 steps each, of the light that
//   scatters once more toward a point, and the share that scatters again, for each height and sun
//   angle.
// - 2, sky view: the sky's light seen from the camera's height in every direction, single
//   scattering of the sun and the moon plus the multiple scattering table.
// - 3, panorama: the sky view with the clouds, mapped as the environment generator reads a
//   panorama.
//
// A texel's place is its fragment position over the target's size. Rows count from the target's
// first row on every GPU path, as textures sample them, so the tables need no flip.
#import null3d::fullscreen::{triangle}
#import null3d::sky_scattering::{SkyValues, medium_at, ray_sphere, ground_hit, transmittance_uv, transmittance_point, multiscatter_uv, sky_view_uv, sky_view_direction, panorama_direction, rayleigh_phase, mie_phase, from_texels, TRANSMITTANCE_SIZE, MULTISCATTER_SIZE, SKY_VIEW_SIZE, PI}
#import null3d::sky_clouds::{clouds}

@group(0) @binding(0) var<uniform> values: SkyValues;
@group(0) @binding(1) var transmittance_table: texture_2d<f32>;
@group(0) @binding(2) var multiscatter_table: texture_2d<f32>;
@group(0) @binding(3) var sky_view_table: texture_2d<f32>;
/// Linear and clamped at every edge.
@group(0) @binding(4) var clamped: sampler;
/// Linear, repeating across the width and clamped at the top and bottom rows.
@group(0) @binding(5) var wrapped: sampler;

struct TableOut {
    @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) step: u32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> TableOut {
    var out: TableOut;
    out.clip = triangle(vertex % 3u);
    out.step = vertex / 3u;
    return out;
}

/// The transmittance from `r` from the center toward `mu` to the top of the air.
fn transmittance(r: f32, mu: f32) -> vec3f {
    let uv = transmittance_uv(values.air.ground.w, values.view.y, r, mu);
    return textureSampleLevel(transmittance_table, clamped, uv, 0.0).rgb;
}

/// The sun's light that reaches the point `p`, from a light toward `toward` of `light` above the
/// air: none in the planet's shadow.
fn light_at(p: vec3f, toward: vec3f, light: f32) -> vec3f {
    let r = length(p);
    let up = p / r;
    let mu = dot(up, toward);
    // The planet's shadow, softened over about the sun's width at the horizon.
    let bottom = values.air.ground.w;
    let horizon = -sqrt(max(1.0 - (bottom / r) * (bottom / r), 0.0));
    let lit = smoothstep(horizon - 0.004, horizon + 0.004, mu);
    return transmittance(r, mu) * (light * lit);
}

/// The light that scatters more than once toward the point `p`, per unit of scattering, from a
/// light toward `toward` of `light` above the air.
fn multiscatter(p: vec3f, toward: vec3f, light: f32) -> vec3f {
    let r = length(p);
    let mu = dot(p / r, toward);
    let uv = multiscatter_uv(values.air.ground.w, values.view.y, r, mu);
    return textureSampleLevel(multiscatter_table, clamped, uv, 0.0).rgb * light;
}

/// Step 0: the transmittance along the texel's ray to the top of the air. The table's angles stop
/// at the horizon, and the light's planet shadow is apart, so the ray never meets the ground.
fn transmittance_step(uv: vec2f) -> vec3f {
    let bottom = values.air.ground.w;
    let top = values.view.y;
    let point = transmittance_point(bottom, top, uv);
    let origin = vec3f(0.0, point.x, 0.0);
    let direction = vec3f(sqrt(max(1.0 - point.y * point.y, 0.0)), point.y, 0.0);
    let span = max(ray_sphere(origin, direction, top), 0.0);
    const STEPS = 40u;
    let dt = span / f32(STEPS);
    var depth = vec3f(0.0);
    for (var i = 0u; i < STEPS; i++) {
        let p = origin + direction * ((f32(i) + 0.5) * dt);
        depth += medium_at(values.air, length(p) - bottom).extinction * dt;
    }
    return exp(-depth);
}

/// What a march along one ray finds: the light scattered toward its start, and the share of
/// light that scatters at all, as one sum.
/// Step 1: the light that reaches a point of the texel's height after scattering more than once,
/// with the sun at the texel's angle, after Hillaire's isotropic sum (his equations 5 to 10).
fn multiscatter_step(uv: vec2f) -> vec3f {
    let bottom = values.air.ground.w;
    let top = values.view.y;
    let mu = from_texels(uv.x, MULTISCATTER_SIZE.x) * 2.0 - 1.0;
    let r = bottom + from_texels(uv.y, MULTISCATTER_SIZE.y) * (top - bottom);
    let origin = vec3f(0.0, max(r, bottom + 0.01), 0.0);
    let sun = vec3f(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
    const SIDE = 8u;
    const STEPS = 20u;
    let isotropic = 1.0 / (4.0 * PI);
    var light = vec3f(0.0);
    var scattered = vec3f(0.0);
    for (var j = 0u; j < SIDE; j++) {
        for (var k = 0u; k < SIDE; k++) {
            // Directions spread evenly over the sphere.
            let a = (f32(j) + 0.5) / f32(SIDE);
            let b = (f32(k) + 0.5) / f32(SIDE);
            let theta = 2.0 * PI * a;
            let cos_phi = 1.0 - 2.0 * b;
            let sin_phi = sqrt(max(1.0 - cos_phi * cos_phi, 0.0));
            let direction = vec3f(cos(theta) * sin_phi, cos_phi, sin(theta) * sin_phi);
            let to_ground = ground_hit(origin, direction, bottom);
            let to_top = max(ray_sphere(origin, direction, top), 0.0);
            let span = select(to_top, to_ground, to_ground >= 0.0);
            let dt = span / f32(STEPS);
            var through = vec3f(1.0);
            for (var i = 0u; i < STEPS; i++) {
                let p = origin + direction * ((f32(i) + 0.3) * dt);
                let m = medium_at(values.air, length(p) - bottom);
                let scattering = m.rayleigh + m.mie;
                let step_through = exp(-m.extinction * dt);
                let share = (1.0 - step_through) / max(m.extinction, vec3f(1e-9));
                let source = light_at(p, sun, 1.0) * scattering * isotropic;
                light += through * source * share;
                scattered += through * scattering * share;
                through *= step_through;
            }
            if to_ground >= 0.0 {
                let p = origin + direction * to_ground;
                let n_dot_l = max(dot(normalize(p), sun), 0.0);
                light += through * light_at(p, sun, 1.0) * n_dot_l * values.air.ground.xyz / PI;
            }
        }
    }
    // Each direction stands for an equal share of the sphere, and scatters isotropically.
    let weight = 4.0 * PI / f32(SIDE * SIDE) * isotropic;
    let second = light * weight;
    let again = scattered * weight;
    return second / max(vec3f(1.0) - again, vec3f(1e-3));
}

/// The light that the air scatters toward the camera along the unit ray `direction`, from the
/// sun and the moon, with the ground's light where the ray meets it.
fn sky_light(direction: vec3f) -> vec3f {
    let bottom = values.air.ground.w;
    let top = values.view.y;
    let origin = vec3f(0.0, values.view.x, 0.0);
    let to_ground = ground_hit(origin, direction, bottom);
    let to_top = ray_sphere(origin, direction, top);
    if to_top < 0.0 && to_ground < 0.0 {
        return vec3f(0.0);
    }
    let span = select(max(to_top, 0.0), to_ground, to_ground >= 0.0);
    // Fewer steps along short rays, as Hillaire's sky view takes.
    let steps = u32(mix(12.0, 30.0, clamp(span / 150.0, 0.0, 1.0)));
    let dt = span / f32(steps);
    let sun = values.sun.xyz;
    let moon = values.moon.xyz;
    let has_moon = values.moon.w > 0.0;
    let g = values.air.mie.w;
    let cos_sun = dot(direction, sun);
    let cos_moon = dot(direction, moon);
    let sun_phase_r = rayleigh_phase(cos_sun);
    let sun_phase_m = mie_phase(cos_sun, g);
    let moon_phase_r = rayleigh_phase(cos_moon);
    let moon_phase_m = mie_phase(cos_moon, g);
    var light = vec3f(0.0);
    var through = vec3f(1.0);
    for (var i = 0u; i < steps; i++) {
        let p = origin + direction * ((f32(i) + 0.3) * dt);
        let m = medium_at(values.air, length(p) - bottom);
        let scattering = m.rayleigh + m.mie;
        var source = light_at(p, sun, values.sun.w) * (m.rayleigh * sun_phase_r + m.mie * sun_phase_m);
        source += multiscatter(p, sun, values.sun.w) * scattering;
        if has_moon {
            source += light_at(p, moon, values.moon.w) * (m.rayleigh * moon_phase_r + m.mie * moon_phase_m);
            source += multiscatter(p, moon, values.moon.w) * scattering;
        }
        let step_through = exp(-m.extinction * dt);
        light += through * source * (1.0 - step_through) / max(m.extinction, vec3f(1e-9));
        through *= step_through;
    }
    if to_ground >= 0.0 {
        let p = origin + direction * to_ground;
        let n = normalize(p);
        var ground = light_at(p, sun, values.sun.w) * max(dot(n, sun), 0.0);
        if has_moon {
            ground += light_at(p, moon, values.moon.w) * max(dot(n, moon), 0.0);
        }
        light += through * ground * values.air.ground.xyz / PI;
    }
    return light;
}

/// Step 3: the sky view in the panorama's direction, with the clouds over it.
fn panorama_step(uv: vec2f) -> vec3f {
    let d = panorama_direction(uv);
    let r = values.view.x;
    let bottom = values.air.ground.w;
    let sky = textureSampleLevel(sky_view_table, wrapped, sky_view_uv(bottom, r, d), 0.0).rgb;
    // The volumetric tier's sky map adds the clouds in its own step, so the panorama carries none.
    if d.y <= 0.0 || values.clouds.z <= 0.0 || values.view.w > 0.0 {
        return sky;
    }
    let zenith = textureSampleLevel(sky_view_table, wrapped, sky_view_uv(bottom, r, vec3f(0.0, 1.0, 0.0)), 0.0).rgb;
    let origin = vec3f(0.0, r, 0.0);
    let sun_light = light_at(origin, values.sun.xyz, values.sun.w);
    let moon_light = light_at(origin, values.moon.xyz, values.moon.w);
    let through = transmittance(r, d.y);
    return clouds(d, sky, zenith, sun_light, moon_light, through, values);
}

@fragment
fn fs(in: TableOut) -> @location(0) vec4f {
    switch in.step {
        case 0u: {
            return vec4f(transmittance_step(in.clip.xy / TRANSMITTANCE_SIZE), 1.0);
        }
        case 1u: {
            return vec4f(multiscatter_step(in.clip.xy / MULTISCATTER_SIZE), 1.0);
        }
        case 2u: {
            let uv = in.clip.xy / SKY_VIEW_SIZE;
            return vec4f(sky_light(sky_view_direction(values.air.ground.w, values.view.x, uv)), 1.0);
        }
        default: {
            return vec4f(panorama_step(in.clip.xy / PANORAMA_SIZE), 1.0);
        }
    }
}

/// The sky's panorama's size.
const PANORAMA_SIZE: vec2f = vec2f(512.0, 256.0);

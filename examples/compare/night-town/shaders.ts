// Night town's custom materials in null3D: WGSL surface functions and a vertex offset that the
// null3D Vite plugin compiles. The three.js half draws the same looks with its own shaders
// (three-shaders.ts). Numbers that the scene description also holds are written out here, since a
// tagged literal holds no substitutions: the block pitch (42 m), the flicker's rate (15 steps a
// second), share (0.035) and low (0.12), and the street's layout.

/**
 * The facades: walls with a window in each bay of each floor, and shop windows on the ground floor.
 * Each window's light comes from a hash of its bay, its floor and its building's lot, so the town
 * shows a different pattern on every wall: warm and cool rooms, half-drawn curtains, a few blue TV
 * screens that flicker, and a few rooms whose lights go on and off every so often. The roof draws
 * as dark wet tar.
 */
export const FACADE_WGSL = /* wgsl */ `
struct Uniforms { time: f32, litShare: f32, windowLight: f32, shopLight: f32 }

var colorMap: texture_2d<f32>;
var ormMap: texture_2d<f32>;
var normalMap: texture_2d<f32>;

fn town_hash(a: i32, b: i32, c: i32) -> f32 {
    var h = (bitcast<u32>(a) * 0x27d4eb2du) ^ (bitcast<u32>(b) * 0x165667b1u) ^ (bitcast<u32>(c) * 0x9e3779b9u);
    h = h ^ (h >> 15u);
    h = h * 0x2c1b3c6du;
    h = h ^ (h >> 12u);
    h = h * 0x297a2d39u;
    h = h ^ (h >> 15u);
    return f32(h >> 8u) / 16777216.0;
}

fn lot_of(p: vec2f) -> vec2i {
    let b = floor(p / 42.0 + 0.5);
    return vec2i(b * 2.0 + step(b * 42.0, p));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let coord = input.uv;
    let ground = coord.y < 1.0;
    let tile = vec2f(fract(coord.x), select(0.5 + 0.5 * fract(coord.y), 0.5 * coord.y, ground));
    let gx = dpdx(coord) * vec2f(1.0, 0.5);
    let gy = dpdy(coord) * vec2f(1.0, 0.5);
    let texel = textureSampleGrad(colorMap, colorMapSampler, tile, gx, gy);
    let orm = textureSampleGrad(ormMap, ormMapSampler, tile, gx, gy);
    let bump = textureSampleGrad(normalMap, normalMapSampler, tile, gx, gy).xyz * 2.0 - 1.0;

    let n = input.normal;
    let along = normalize(vec3f(n.z, 0.0, -n.x) + vec3f(0.0001, 0.0, 0.0));
    let wall_normal = normalize(along * bump.x + vec3f(0.0, 1.0, 0.0) * bump.y + n * bump.z);

    // Each window's numbers: its bay and floor, and its building's lot.
    let bay = vec2i(floor(coord));
    let lot = lot_of(input.worldPosition.xz);
    let pick = town_hash(bay.x + lot.x * 4096, bay.y, lot.y);
    let kind = town_hash(bay.x, bay.y + 977, lot.x * 131 + lot.y);
    let period = i32(floor(material.time / 23.0 + kind * 7.0));
    let toggles = kind > 0.9 && town_hash(bay.x, bay.y, period + lot.x * 7 + lot.y * 13) < 0.5;
    let share = select(material.litShare, 0.85, ground);
    let lit = select(0.0, 1.0, (pick < share) != toggles);
    // The room's light: warm, soft white or cool, and a TV's flickering blue in a few.
    let warm = vec3f(1.0, 0.55, 0.24);
    let soft = vec3f(1.0, 0.8, 0.55);
    let cool = vec3f(0.55, 0.72, 1.0);
    var room = select(select(warm, soft, kind > 0.45), cool, kind > 0.78);
    let tv = kind > 0.84 && kind <= 0.9;
    let flicker = 0.55 + 0.45 * sin(material.time * 9.0 + pick * 60.0) * sin(material.time * 3.7 + kind * 20.0);
    room = select(room, vec3f(0.25, 0.45, 1.0) * flicker, tv);
    // A curtain half drawn in some windows, and a soft fall of the light toward the sill.
    let fy = fract(coord.y);
    let curtain = select(1.0, select(0.35, 1.0, tile.x > 0.5), pick * 7.0 % 1.0 < 0.35);
    let depth = 0.55 + 0.45 * smoothstep(0.1, 0.8, fy);
    let strength = select(material.windowLight * (0.5 + pick), material.shopLight, ground);
    let glow = room * strength * lit * curtain * depth * (0.7 + 0.6 * kind);

    let roof = n.y > 0.5;
    let tar = vec3f(0.035, 0.036, 0.04) * (0.8 + 0.4 * fract(sin(dot(floor(input.worldPosition.xz * 2.0), vec2f(12.9898, 78.233))) * 43758.5453));
    s.baseColor = select(s.baseColor * texel.rgb, tar, roof);
    s.roughness = select(orm.g, 0.45, roof);
    s.metalness = select(orm.b, 0.0, roof);
    s.normal = select(wall_normal, n, roof);
    s.emissive = select(glow * texel.a, vec3f(0.0), roof);
    return s;
}
`;

/**
 * The wet street: asphalt that rain has darkened, puddles that mirror the town through the
 * reflection pass and ripple where drops land, water along the curbs, and paint: a double line
 * down each street and a crossing at each corner.
 */
export const STREET_WGSL = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

struct Uniforms { time: f32, puddleShare: f32, wetDarken: f32, mirrorShare: f32 }

var colorMap: texture_2d<f32>;
var ormMap: texture_2d<f32>;
var normalMap: texture_2d<f32>;
var puddleMap: texture_2d<f32>;
var mirror: texture_2d<f32>;

fn ripple_hash(c: vec2f) -> f32 {
    return fract(sin(dot(c, vec2f(127.1, 311.7))) * 43758.5453);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    let asphalt_uv = p / 4.0;
    let puddle_uv = p / 36.0;
    let texel = textureSample(colorMap, colorMapSampler, asphalt_uv);
    let orm = textureSample(ormMap, ormMapSampler, asphalt_uv);
    let bump = textureSample(normalMap, normalMapSampler, asphalt_uv).xyz * 2.0 - 1.0;
    let water = textureSample(puddleMap, puddleMapSampler, puddle_uv);

    // Where the point lies in its block's cell: the slab covers |local| < 15, and each street's
    // middle line lies at 21.
    let local = p - 42.0 * round(p / 42.0);
    let a = abs(local);
    let on_x_street = a.y > 15.0;
    let on_z_street = a.x > 15.0;
    let line_z = on_z_street && !on_x_street && abs(a.x - 21.0) > 0.07 && abs(a.x - 21.0) < 0.19;
    let line_x = on_x_street && !on_z_street && abs(a.y - 21.0) > 0.07 && abs(a.y - 21.0) < 0.19;
    let cross_z = on_z_street && a.y > 11.8 && a.y < 14.6 && a.x > 15.6 && a.x < 26.4 && fract(local.x / 0.9) < 0.5;
    let cross_x = on_x_street && a.x > 11.8 && a.x < 14.6 && a.y > 15.6 && a.y < 26.4 && fract(local.y / 0.9) < 0.5;
    let yellow = select(0.0, 1.0, line_z || line_x);
    let white = select(0.0, 1.0, cross_z || cross_x);
    let worn = 0.55 + 0.45 * water.g;
    var color = texel.rgb;
    color = mix(color, vec3f(0.62, 0.42, 0.05) * worn, yellow);
    color = mix(color, vec3f(0.7, 0.7, 0.68) * worn, white);

    // Water: puddles from the puddle map, the cracks, and a band along each curb.
    let curb = max(smoothstep(16.4, 15.0, a.x) * select(0.0, 1.0, on_z_street), smoothstep(16.4, 15.0, a.y) * select(0.0, 1.0, on_x_street));
    let depth = water.r + 0.25 * curb + 0.15 * texel.a;
    let edge = 1.0 - material.puddleShare;
    let puddle = smoothstep(edge, edge + 0.035, depth);

    // Rain rings in the water: one drop at a time in each cell of 0.6 m.
    let cell = floor(p / 0.6);
    let offset = (vec2f(ripple_hash(cell), ripple_hash(cell + 17.0)) - 0.5) * 0.25;
    let to = fract(p / 0.6) - 0.5 - offset;
    let phase = fract(material.time * 0.85 + ripple_hash(cell + 3.0));
    let radius = phase * 0.28;
    let d = length(to) * 0.6;
    let ring = exp(-pow((d - radius) / 0.012, 2.0)) * (1.0 - phase);
    let tilt = normalize(to + vec2f(0.0001)) * ring * 0.35 * puddle;

    let up = vec3f(0.0, 1.0, 0.0);
    let rough_normal = normalize(vec3f(bump.x, 0.0, -bump.y) * 0.6 + up * bump.z);
    let water_normal = normalize(vec3f(tilt.x, 1.0, tilt.y));
    s.normal = normalize(mix(rough_normal, water_normal, puddle));
    s.baseColor = s.baseColor * color * mix(material.wetDarken, 0.35, puddle);
    s.roughness = mix(orm.g * 0.62, 0.03, puddle);
    s.metalness = 0.0;

    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, tilt * 0.08);
    let mirrored = textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb;
    s.reflection = vec4f(mirrored, puddle * material.mirrorShare);
    return s;
}
`;

/**
 * Neon tubes: a glowing color that stutters now and then. The stutter comes from the sign's lot
 * and the time in steps of a fifteenth of a second, as the sign's light does on the CPU.
 */
export const NEON_WGSL = /* wgsl */ `
struct Uniforms { glow: vec3f, time: f32, strength: f32 }

fn town_hash(a: i32, b: i32, c: i32) -> f32 {
    var h = (bitcast<u32>(a) * 0x27d4eb2du) ^ (bitcast<u32>(b) * 0x165667b1u) ^ (bitcast<u32>(c) * 0x9e3779b9u);
    h = h ^ (h >> 15u);
    h = h * 0x2c1b3c6du;
    h = h ^ (h >> 12u);
    h = h * 0x297a2d39u;
    h = h ^ (h >> 15u);
    return f32(h >> 8u) / 16777216.0;
}

fn lot_of(p: vec2f) -> vec2i {
    let b = floor(p / 42.0 + 0.5);
    return vec2i(b * 2.0 + step(b * 42.0, p));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let lot = lot_of(object.position.xz);
    let steps = i32(floor(material.time * 15.0));
    let on = select(1.0, 0.12, town_hash(steps, lot.x, lot.y) < 0.035);
    s.baseColor = vec3f(0.02);
    s.roughness = 0.3;
    s.metalness = 0.0;
    s.emissive = material.glow * material.strength * on;
    return s;
}
`;

/**
 * The awnings: striped cloth whose outer edge ripples in the wind, more the further it hangs from
 * the wall. Each awning ripples in its own phase from its position.
 */
export const AWNING_WGSL = /* wgsl */ `
struct Uniforms { stripeA: vec3f, time: f32, stripeB: vec3f }

fn vertexOffset(input: VertexInput) -> vec3f {
    let phase = object.position.x * 0.37 + object.position.z * 0.61;
    let reach = input.uv.y * input.uv.y;
    let wave = sin(material.time * 2.3 + input.uv.x * 2.1 + phase) * 0.05 + sin(material.time * 5.3 + input.uv.x * 4.7 + phase * 1.7) * 0.02;
    return vec3f(0.0, wave * reach, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let stripe = step(0.5, fract(input.uv.x / 0.5));
    let hem = smoothstep(0.9, 0.97, input.uv.y);
    s.baseColor = mix(mix(material.stripeA, material.stripeB, stripe), material.stripeA * 0.6, hem);
    s.roughness = 0.6;
    s.metalness = 0.0;
    return s;
}
`;

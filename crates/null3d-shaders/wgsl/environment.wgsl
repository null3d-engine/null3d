// Environment maps made on the GPU (D-19): the built-in room, traced, blurred and filtered for each
// roughness, as the asset tool makes it on the CPU (crates/null3d-assets-wasm/src/environment).
// Every constant and formula here follows the tool's, so the two maps match.
//
// Each draw fills one level of one face with one triangle, from the fragment's place on the face:
//
// - `trace` traces three.js's RoomEnvironment scene from the room's center, 4 x 4 directions per
//   texel.
// - `blur` blurs the traced room by a Gaussian over the sphere, as three.js's examples blur it.
// - `half` makes a level of the blurred room's chain from the level before it.
// - `prefilter` filters the chain for one roughness, with the GGX distribution.
//
// No GPU path draws into shared-exponent floats, so each draw packs its texel as `rgb9e5ufloat`
// into the four bytes of an `rgba8unorm` target. The generator then copies the bytes into the
// face's level of a shared-exponent cube texture, which the next draws sample with a linear
// filter.

struct Step {
    /// The face that the draw fills: 0 to 5 for +X, -X, +Y, -Y, +Z and -Z.
    face: u32,
    /// The texels across a side of the face at the level that the draw fills.
    size: u32,
    /// The directions of the prefilter.
    samples: u32,
    /// The texels across a side of the source's largest level.
    source_size: u32,
    /// The blur's sigma in radians, the source level that `half` reads, or the prefilter's
    /// perceptual roughness.
    value: f32,
    spare_a: f32,
    spare_b: f32,
    spare_c: f32,
}

@group(0) @binding(0) var<uniform> params: Step;
@group(0) @binding(1) var source: texture_cube<f32>;
@group(0) @binding(2) var source_sampler: sampler;

const PI: f32 = 3.14159265358979;

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space, at a depth that every WebGL2 depth
    // mapping keeps inside the clip volume.
    let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}

/// The direction through a face at the face coordinates `sc` and `tc`, each from -1 to 1, in the
/// cube map table that every GPU path shares. The direction is not unit length.
fn face_direction(face: u32, sc: f32, tc: f32) -> vec3f {
    switch face {
        case 0u: {
            return vec3f(1.0, -tc, -sc);
        }
        case 1u: {
            return vec3f(-1.0, -tc, sc);
        }
        case 2u: {
            return vec3f(sc, 1.0, tc);
        }
        case 3u: {
            return vec3f(sc, -1.0, -tc);
        }
        case 4u: {
            return vec3f(sc, -tc, 1.0);
        }
        default: {
            return vec3f(-sc, -tc, -1.0);
        }
    }
}

/// The unit direction through the center of the texel under the fragment. Rows count from the
/// first row of the target on both paths, as the copy into the face stores them.
fn texel_direction(position: vec2f) -> vec3f {
    let center = (2.0 * floor(position) + 1.0) / f32(params.size) - 1.0;
    return normalize(face_direction(params.face, center.x, center.y));
}

/// Two unit vectors that make a right-handed frame with the unit vector `n` (Duff et al., 2017).
fn frame_tangent(n: vec3f) -> vec3f {
    let sign = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (sign + n.z);
    return vec3f(1.0 + sign * n.x * n.x * a, sign * n.x * n.y * a, -sign * n.x);
}

fn frame_bitangent(n: vec3f) -> vec3f {
    let sign = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (sign + n.z);
    return vec3f(n.x * n.y * a, sign + n.y * n.y * a, -n.y);
}

/// 2 to the power `e`, exact for the exponents of normal floats.
fn power_of_two(e: i32) -> f32 {
    return bitcast<f32>(u32(e + 127) << 23u);
}

/// The texel's light as `rgb9e5ufloat`, rounded to nearest as `EXT_texture_shared_exponent`
/// packs it, in the four bytes of an `rgba8unorm` texel, lowest byte first. A quarter step above
/// each byte keeps the byte whether the GPU rounds or truncates its conversion to 8 bits.
fn pack(light: vec3f) -> vec4f {
    let c = select(vec3f(0.0), min(light, vec3f(65408.0)), light > vec3f(0.0));
    let largest = max(c.r, max(c.g, c.b));
    if largest < power_of_two(-24) {
        return vec4f(0.25 / 255.0);
    }
    let floor_log = i32((bitcast<u32>(largest) >> 23u) & 255u) - 127;
    var exponent = max(floor_log, -16) + 16;
    if floor(largest * power_of_two(24 - exponent) + 0.5) >= 512.0 {
        exponent += 1;
    }
    let m = min(vec3u(floor(c * power_of_two(24 - exponent) + 0.5)), vec3u(511u));
    let word = m.r | (m.g << 9u) | (m.b << 18u) | (u32(exponent) << 27u);
    let bytes = vec4u(word & 255u, (word >> 8u) & 255u, (word >> 16u) & 255u, word >> 24u);
    return (vec4f(bytes) + 0.25) / 255.0;
}

// The room of three.js's RoomEnvironment: a large white room with six white boxes and six glowing
// panels, lit by one point light. three.js moves the scene down by 3.5, so its center sits near
// the floor. Each box has its center, its half sizes along its own axes, and its turn about Y in
// radians. The tables are functions, not constant arrays: Arm's Mali GPUs reject a GLSL array type
// with its size, which an array constant becomes.

struct Box {
    center: vec3f,
    half_size: vec3f,
    turn: f32,
}

const LIFT: f32 = -3.5;

const ROOM: Box = Box(vec3f(-0.757, 13.219 + LIFT, 0.717), vec3f(15.8565, 14.1525, 14.2955), 0.0);

/// The white box `k`, from 0 to 5.
fn white_box(k: i32) -> Box {
    switch k {
        case 0: {
            return Box(vec3f(-10.906, 2.009 + LIFT, 1.846), vec3f(1.164, 3.9525, 2.3255), -0.195);
        }
        case 1: {
            return Box(vec3f(-5.607, -0.754 + LIFT, -0.758), vec3f(0.985, 0.767, 1.9775), 0.994);
        }
        case 2: {
            return Box(vec3f(6.167, 0.857 + LIFT, 7.803), vec3f(1.9635, 3.1425, 1.8435), 0.561);
        }
        case 3: {
            return Box(vec3f(-2.017, 0.018 + LIFT, 6.124), vec3f(1.001, 2.283, 1.032), 0.333);
        }
        case 4: {
            return Box(vec3f(2.291, -0.756 + LIFT, -2.621), vec3f(0.773, 0.776, 0.748), -0.286);
        }
        default: {
            return Box(vec3f(-2.193, -0.369 + LIFT, -5.547), vec3f(1.9375, 1.7435, 1.493), 0.516);
        }
    }
}

/// The glowing panel `k`, from 0 to 5, with its emissive strength in place of a turn: no panel
/// turns.
fn panel(k: i32) -> Box {
    switch k {
        case 0: {
            return Box(vec3f(-16.116, 14.37 + LIFT, 8.208), vec3f(0.05, 1.214, 1.3695), 50.0);
        }
        case 1: {
            return Box(vec3f(-16.109, 18.021 + LIFT, -8.207), vec3f(0.05, 1.2125, 1.3755), 50.0);
        }
        case 2: {
            return Box(vec3f(14.904, 12.198 + LIFT, -1.832), vec3f(0.075, 2.1325, 3.1655), 17.0);
        }
        case 3: {
            return Box(vec3f(-0.462, 8.89 + LIFT, 14.520), vec3f(2.19, 2.7205, 0.044), 43.0);
        }
        case 4: {
            return Box(vec3f(3.235, 11.486 + LIFT, -12.541), vec3f(1.25, 1.0, 0.05), 20.0);
        }
        default: {
            return Box(vec3f(0.0, 20.0 + LIFT, 0.0), vec3f(0.5, 0.05, 0.5), 100.0);
        }
    }
}

/// The point light: position, intensity in candela and range.
const LIGHT: vec3f = vec3f(0.418, 16.199 + LIFT, 0.300);
const LIGHT_INTENSITY: f32 = 900.0;
const LIGHT_RANGE: f32 = 28.0;

/// The specular reflectance of a dielectric at normal incidence.
const F0: f32 = 0.04;

/// The sum of the split-sum terms of three.js's table at roughness 1, at each cosine of the view
/// angle from 0 to 1 at the table's texel centers, four at a time. three.js's compensation for
/// multiple scattering takes its energy from it.
const DFG_ROUGH_A: vec4f = vec4f(0.8989, 0.78186, 0.70303, 0.64262);
const DFG_ROUGH_B: vec4f = vec4f(0.5944, 0.55402, 0.51973, 0.4901);
const DFG_ROUGH_C: vec4f = vec4f(0.46429, 0.44146, 0.42104, 0.403);
const DFG_ROUGH_D: vec4f = vec4f(0.38655, 0.37142, 0.35784, 0.34529);

/// Entry `k` of the table, from 0 to 15.
fn dfg_entry(k: u32) -> f32 {
    var four = DFG_ROUGH_D;
    if k < 4u {
        four = DFG_ROUGH_A;
    } else if k < 8u {
        four = DFG_ROUGH_B;
    } else if k < 12u {
        four = DFG_ROUGH_C;
    }
    return four[k % 4u];
}

/// The sum of the split-sum terms at roughness 1, between the table's entries, as three.js's
/// table lookup filters it.
fn dfg_sum(n_dot_v: f32) -> f32 {
    let place = clamp(n_dot_v * 16.0 - 0.5, 0.0, 15.0);
    let low = u32(place);
    let t = place - f32(low);
    return dfg_entry(low) * (1.0 - t) + dfg_entry(min(low + 1u, 15u)) * t;
}

/// Turns a vector about Y by `angle`.
fn turn(v: vec3f, angle: f32) -> vec3f {
    let s = sin(angle);
    let c = cos(angle);
    return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

/// Where a ray from the room's center along `d` crosses a box: the distances in and out, and the
/// box's outward normals there, in world space. A ray that misses has `far` below 0.
struct Crossing {
    near: f32,
    near_normal: vec3f,
    far: f32,
    far_normal: vec3f,
}

fn axis_normal(axis: i32, sign: f32, angle: f32) -> vec3f {
    var n = vec3f(0.0);
    n[axis] = sign;
    return turn(n, angle);
}

fn cross_box(b: Box, d: vec3f) -> Crossing {
    let miss = Crossing(0.0, vec3f(0.0), -1.0, vec3f(0.0));
    let origin = turn(-b.center, -b.turn);
    let dir = turn(d, -b.turn);
    var near = -3.0e38;
    var far = 3.0e38;
    var near_axis = 0;
    var far_axis = 0;
    for (var axis = 0; axis < 3; axis++) {
        if dir[axis] == 0.0 {
            if abs(origin[axis]) > b.half_size[axis] {
                return miss;
            }
            continue;
        }
        let a = (-b.half_size[axis] - origin[axis]) / dir[axis];
        let c = (b.half_size[axis] - origin[axis]) / dir[axis];
        let enter = min(a, c);
        let leave = max(a, c);
        if enter > near {
            near = enter;
            near_axis = axis;
        }
        if leave < far {
            far = leave;
            far_axis = axis;
        }
    }
    if near > far || far <= 0.0 {
        return miss;
    }
    let near_sign = select(1.0, -1.0, dir[near_axis] > 0.0);
    let far_sign = select(-1.0, 1.0, dir[far_axis] > 0.0);
    return Crossing(
        near,
        axis_normal(near_axis, near_sign, b.turn),
        far,
        axis_normal(far_axis, far_sign, b.turn),
    );
}

/// The light that a white standard material reflects toward the room's center from a point with
/// the normal `n`, lit by the point light, as three.js's `RE_Direct_Physical` gives it with the
/// material's defaults: the diffuse part loses the light that the specular layer reflects, and the
/// specular part gains three.js's compensation for multiple scattering.
fn shade(p: vec3f, n: vec3f) -> f32 {
    let to_light = LIGHT - p;
    let distance = sqrt(dot(to_light, to_light));
    let l = to_light * (1.0 / distance);
    let n_dot_l = dot(n, l);
    if n_dot_l <= 0.0 {
        return 0.0;
    }
    // three.js's distance falloff with a range.
    let ratio = distance / LIGHT_RANGE;
    let cutoff = clamp(1.0 - ratio * ratio * ratio * ratio, 0.0, 1.0);
    let falloff = cutoff * cutoff / max(distance * distance, 0.01);
    let irradiance = LIGHT_INTENSITY * falloff * n_dot_l;
    // The view points from the surface back to the center.
    let v = normalize(-p);
    let n_dot_v = max(dot(n, v), 1.0e-4);
    let h = normalize(l + v);
    let v_dot_h = clamp(dot(v, h), 0.0, 1.0);
    // three.js's `F_Schlick`, with its exponential fit of the fifth power.
    let weight = exp2((-5.55473 * v_dot_h - 6.98316) * v_dot_h);
    let fresnel = F0 * (1.0 - weight) + weight;
    // Roughness 1 makes the distribution 1 / pi and the correlated Smith term 0.5 / (n.l + n.v).
    let specular = fresnel * 0.5 / (n_dot_l + n_dot_v) / PI;
    let compensation = 1.0 + F0 * (1.0 / dfg_sum(min(n_dot_v, 1.0)) - 1.0);
    return irradiance * ((1.0 - fresnel) / PI + specular * compensation);
}

/// The light that reaches the room's center from a unit direction. Nothing casts shadows, as in
/// three.js's scene.
fn room_light(d: vec3f) -> f32 {
    var nearest = 3.0e38;
    var light = 0.0;
    let room = cross_box(ROOM, d);
    if room.far > 0.0 {
        nearest = room.far;
        light = shade(d * room.far, -room.far_normal);
    }
    for (var k = 0; k < 6; k++) {
        let hit = cross_box(white_box(k), d);
        if hit.far > 0.0 && hit.near > 0.0 && hit.near < nearest {
            nearest = hit.near;
            light = shade(d * hit.near, hit.near_normal);
        }
    }
    for (var k = 0; k < 6; k++) {
        let glowing = panel(k);
        let hit = cross_box(Box(glowing.center, glowing.half_size, 0.0), d);
        if hit.far > 0.0 && hit.near > 0.0 && hit.near < nearest {
            nearest = hit.near;
            light = glowing.turn;
        }
    }
    return light;
}

/// The room's light averaged over 4 x 4 directions spread evenly over the texel.
@fragment
fn fs_trace(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = floor(position.xy);
    let spacing = 2.0 / (f32(params.size) * 4.0);
    var sum = 0.0;
    for (var j = 0; j < 4; j++) {
        let tc = (texel.y * 4.0 + f32(j) + 0.5) * spacing - 1.0;
        for (var i = 0; i < 4; i++) {
            let sc = (texel.x * 4.0 + f32(i) + 0.5) * spacing - 1.0;
            sum += room_light(normalize(face_direction(params.face, sc, tc)));
        }
    }
    return pack(vec3f(sum * (1.0 / 16.0)));
}

/// The source blurred by a Gaussian of `value` radians over the sphere, as three.js's
/// `PMREMGenerator.fromScene` blurs a scene with its sigma. The texel weighs the directions
/// around its own on a grid of half a sigma, out to three sigmas, by the Gaussian of their angle.
@fragment
fn fs_blur(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let n = texel_direction(position.xy);
    let t = frame_tangent(n);
    let b = frame_bitangent(n);
    let sigma = params.value;
    let spacing = sigma / 2.0;
    var sum = vec3f(0.0);
    var total = 0.0;
    for (var j = -6; j <= 6; j++) {
        let v = f32(j) * spacing;
        for (var i = -6; i <= 6; i++) {
            let u = f32(i) * spacing;
            let weight = exp(-(u * u + v * v) / (2.0 * sigma * sigma));
            let d = n + t * tan(u) + b * tan(v);
            sum += textureSampleLevel(source, source_sampler, d, 0.0).rgb * weight;
            total += weight;
        }
    }
    return pack(sum * (1.0 / total));
}

/// The average of the four texels of the level before that this texel covers: a linear filter
/// reads them at their shared corner, where the texel's center lies.
@fragment
fn fs_half(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let d = texel_direction(position.xy);
    return pack(textureSampleLevel(source, source_sampler, d, params.value).rgb);
}

/// Van der Corput's radical inverse in base 2.
fn radical_inverse(i: u32) -> f32 {
    var bits = (i << 16u) | (i >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xaaaaaaaau) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xccccccccu) >> 2u);
    bits = ((bits & 0x0f0f0f0fu) << 4u) | ((bits & 0xf0f0f0f0u) >> 4u);
    bits = ((bits & 0x00ff00ffu) << 8u) | ((bits & 0xff00ff00u) >> 8u);
    return f32(bits) * (1.0 / 4294967296.0);
}

/// The source's light filtered by the GGX distribution of a perceptual roughness, with the view
/// along the texel's direction (the split-sum view of Karis, 2013). The directions come from GGX
/// importance sampling of half vectors in a Hammersley set, the same for every texel. Each reads
/// a smaller level of the source as its sample covers more of the sphere (Křivánek and Colbert,
/// 2008), and weighs by the cosine of the light's angle.
@fragment
fn fs_prefilter(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let n = texel_direction(position.xy);
    let t = frame_tangent(n);
    let b = frame_bitangent(n);
    let alpha = params.value * params.value;
    let alpha2 = alpha * alpha;
    let source_size = f32(params.source_size);
    let texel_solid_angle = 4.0 * PI / (6.0 * source_size * source_size);
    let count = params.samples;
    var sum = vec3f(0.0);
    var total = 0.0;
    for (var i = 0u; i < count; i++) {
        let u = f32(i) / f32(count);
        let phi = 2.0 * PI * radical_inverse(i);
        let cos2 = (1.0 - u) / (1.0 + (alpha2 - 1.0) * u);
        let cos_theta = sqrt(cos2);
        let sin_theta = sqrt(max(1.0 - cos2, 0.0));
        let light = vec3f(
            2.0 * cos_theta * sin_theta * cos(phi),
            2.0 * cos_theta * sin_theta * sin(phi),
            2.0 * cos2 - 1.0,
        );
        if light.z <= 0.0 {
            continue;
        }
        // With the view along the normal, the light's density is D / 4.
        let density = alpha2 / (PI * (cos2 * (alpha2 - 1.0) + 1.0) * (cos2 * (alpha2 - 1.0) + 1.0));
        let solid_angle = 4.0 / (f32(count) * density);
        let lod = max(0.5 * log2(solid_angle / texel_solid_angle) + 1.0, 0.0);
        let d = t * light.x + b * light.y + n * light.z;
        sum += textureSampleLevel(source, source_sampler, d, lod).rgb * light.z;
        total += light.z;
    }
    return pack(sum * (1.0 / total));
}

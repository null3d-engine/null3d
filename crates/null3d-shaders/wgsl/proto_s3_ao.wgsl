// Prototype S3 (not for merging): the ambient occlusion variants of the AO prototype page. Each
// pass is one triangle over a target of the AO size. Every pass but `copy` reads the distance to
// the camera at the AO size from `input`: the copy of the prepass's depth, or the structure pass.
//
// - `copy` is M2-F2's depth step: one texel of the prepass's depth per AO texel, turned into the
//   distance to the camera. The MULTISAMPLED build reads sample 0 of a multisampled depth.
// - `sao` is Filament's scalable ambient obscurance with 7 reads on a spiral.
// - `gtao` is Filament's and XeGTAO's horizon search with 2 slices of 3 steps each way (12 reads),
//   `gtao_wide` with Filament's 4 slices of 3 steps (24 reads).
// - `bitmask` is the same search as `gtao`, scored with a visibility bitmask of 32 sectors and a
//   thickness behind each depth (Therrien et al. 2023), which removes dark halos behind thin
//   objects.
// - `three_horizon` and `three_denoise` are M2-F2's steps as merged: three.js's GTAO with 3 slices
//   of 6 steps each way, then its Poisson denoise of 16 taps.
// - `blur_x` and `blur_y` are Filament's separable bilateral blur, 11 taps each way.
//
// Each of the Filament-style passes writes the occlusion with the distance beside it (rg16float),
// which the blur and the depth-aware upsample read. Every variant rebuilds normals from 4
// neighbors, picking on each axis the side whose distance lies closer.

struct Settings {
    /// x: near plane, y: far plane, z: the row sign, 1 where rows count from the top and -1 from
    /// the bottom, w: the prepass's MSAA samples.
    camera: vec4f,
    /// xy: the AO targets' size in texels, zw: the render size in pixels.
    sizes: vec4f,
    /// xy: tan of half the field of view across and down, z: AO texels per meter at 1 m from the
    /// camera, w: the search radius in meters.
    rays: vec4f,
    /// x: intensity, y: power, z: bias, w: the bitmask's thickness in meters.
    shape: vec4f,
    /// three.js's GTAO: radius, thickness, distance exponent, distance falloff.
    three_horizon: vec4f,
    /// three.js's GTAO: scale, slices, steps, unused.
    three_shape: vec4f,
    /// three.js's denoise: luma, depth and normal phi, radius.
    three_denoise: vec4f,
}

@group(0) @binding(0) var<uniform> settings: Settings;
#ifdef MULTISAMPLED
@group(0) @binding(1) var source: texture_multisampled_2d<f32>;
#else
@group(0) @binding(1) var source: texture_2d<f32>;
#endif
@group(0) @binding(2) var input: texture_2d<f32>;
@group(0) @binding(3) var found: texture_2d<f32>;

const PI: f32 = 3.141592653589793;
const HALF_PI: f32 = 1.5707963267948966;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

@fragment
fn copy(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = vec2i(position.xy);
    let at = floor((vec2f(texel) + 0.5) * settings.sizes.zw / settings.sizes.xy);
    let pixel = min(vec2i(at), vec2i(settings.sizes.zw) - 1);
    let depth = textureLoad(source, pixel, 0).x;
    if depth <= 0.0 {
        return vec4f(0.0);
    }
    // Reversed depth: 1 at the near plane, 0 at the far plane.
    let near = settings.camera.x;
    let far = settings.camera.y;
    return vec4f(near * far / (near + depth * (far - near)), 0.0, 0.0, 1.0);
}

/// The distance at a texel, clamped inside the target. 0 where no surface lies.
fn distance_at(texel: vec2i) -> f32 {
    let inside = clamp(texel, vec2i(0), vec2i(settings.sizes.xy) - 1);
    return textureLoad(input, inside, 0).x;
}

/// The view-space position at a texel center with a distance.
fn position_from(texel: vec2f, distance: f32) -> vec3f {
    let uv = (texel + 0.5) / settings.sizes.xy;
    let ndc = vec2f(uv.x * 2.0 - 1.0, (1.0 - uv.y * 2.0) * settings.camera.z);
    return vec3f(ndc * settings.rays.xy * distance, -distance);
}

fn position_at(texel: vec2i) -> vec3f {
    return position_from(vec2f(texel), distance_at(texel));
}

/// The surface normal at a texel from its four neighbors, with each axis taken from the side
/// whose distance lies closer, so edges keep their own side. It faces the camera.
fn rebuilt_normal(texel: vec2i, center: vec3f) -> vec3f {
    let left = position_at(texel - vec2i(1, 0));
    let right = position_at(texel + vec2i(1, 0));
    let above = position_at(texel - vec2i(0, 1));
    let below = position_at(texel + vec2i(0, 1));
    var across = right - center;
    if abs(left.z - center.z) < abs(right.z - center.z) {
        across = center - left;
    }
    var down = below - center;
    if abs(above.z - center.z) < abs(below.z - center.z) {
        down = center - above;
    }
    let normal = normalize(cross(across, down));
    return select(normal, -normal, dot(normal, center) > 0.0);
}

/// Interleaved gradient noise, fixed per texel.
fn ign(texel: vec2i) -> f32 {
    return fract(52.9829189 * fract(dot(vec2f(texel), vec2f(0.06711056, 0.00583715))));
}

/// Filament's 4 x 4 spatial offsets, from 0 to 0.75.
fn spatial_offset(texel: vec2i) -> f32 {
    return 0.25 * f32((texel.y - texel.x) & 3);
}

fn result(occlusion: f32, distance: f32) -> vec4f {
    return vec4f(occlusion, distance, 0.0, 1.0);
}

@fragment
fn sao(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = vec2i(position.xy);
    let distance = distance_at(texel);
    if distance <= 0.0 {
        return result(1.0, 0.0);
    }
    let origin = position_from(vec2f(texel), distance);
    let normal = rebuilt_normal(texel, origin);
    let samples = 7;
    let turns = 2.0;
    let radius = settings.rays.w;
    let inverse_radius_squared = 1.0 / (radius * radius);
    let peak = 0.1 * radius;
    let disk = settings.rays.z * radius / distance;
    let noise = ign(texel);
    var occlusion = 0.0;
    for (var i = 0; i < samples; i++) {
        let alpha = (f32(i) + noise + 0.5) / (f32(samples) - 0.5);
        let angle = alpha * turns * 2.0 * PI + noise * 2.0 * PI;
        let reach = max(1.0, alpha * alpha * disk);
        let tap = vec2i(floor(vec2f(texel) + 0.5 + vec2f(cos(angle), sin(angle)) * reach));
        let v = position_at(tap) - origin;
        let vv = dot(v, v);
        let vn = dot(v, normal);
        let w = pow(max(0.0, 1.0 - vv * inverse_radius_squared), 2.0);
        occlusion += w * max(0.0, vn - distance * settings.shape.z) / (vv + peak * peak);
    }
    let intensity = 2.0 * PI * peak * settings.shape.x;
    let ao = max(0.0, 1.0 - occlusion * intensity * (2.0 / f32(samples)));
    return result(pow(ao, settings.shape.y), distance);
}

/// The frame of one slice of the horizon search: the slice's screen step and the angle of the
/// normal projected into the slice.
struct Slice {
    omega: vec2f,
    n: f32,
    cos_n: f32,
    projected_length: f32,
}

fn slice_frame(k: f32, normal: vec3f, view_dir: vec3f) -> Slice {
    let phi = k * PI;
    let c = cos(phi);
    let s = sin(phi);
    // A step down the screen is a step down in view space where rows count from the top.
    let direction = vec3f(c, s, 0.0);
    let ortho = direction - dot(direction, view_dir) * view_dir;
    let axis = normalize(cross(ortho, view_dir));
    let projected = normal - axis * dot(normal, axis);
    let projected_length = length(projected);
    let sign_n = sign(dot(ortho, projected));
    let cos_n = clamp(dot(projected, view_dir) / projected_length, 0.0, 1.0);
    var out: Slice;
    out.omega = vec2f(c, -s * settings.camera.z);
    out.n = sign_n * acos(cos_n);
    out.cos_n = cos_n;
    out.projected_length = projected_length;
    return out;
}

/// The texel of one step of the search: quadratic spacing from the texel, at least one texel away.
fn step_texel(texel: vec2i, omega: vec2f, j: i32, steps: i32, offset: f32, radius: f32) -> vec2i {
    var s = (f32(j) + offset) / f32(steps);
    s = s * s;
    let reach = max(1.0 + f32(j), s * radius);
    return vec2i(floor(vec2f(texel) + 0.5 + omega * reach));
}

/// XeGTAO's falloff: full weight up to 38.5% of the radius, none at the radius.
fn falloff(distance_squared: f32) -> f32 {
    let radius = settings.rays.w;
    let range = 0.615 * radius;
    let start = radius - range;
    return clamp((start - sqrt(distance_squared)) / range + 1.0, 0.0, 1.0);
}

fn horizon_ao(position: vec4f, slices: i32, steps: i32) -> vec4f {
    let texel = vec2i(position.xy);
    let distance = distance_at(texel);
    if distance <= 0.0 {
        return result(1.0, 0.0);
    }
    let origin = position_from(vec2f(texel), distance);
    let normal = rebuilt_normal(texel, origin);
    let view_dir = normalize(-origin);
    let radius = settings.rays.z * settings.rays.w / distance;
    let noise = ign(texel);
    let offset = spatial_offset(texel);
    var visibility = 0.0;
    for (var slice = 0; slice < slices; slice++) {
        let frame = slice_frame((f32(slice) + noise) / f32(slices), normal, view_dir);
        let low0 = cos(frame.n + HALF_PI);
        let low1 = cos(frame.n - HALF_PI);
        var horizon0 = low0;
        var horizon1 = low1;
        for (var j = 0; j < steps; j++) {
            let d0 = position_at(step_texel(texel, frame.omega, j, steps, offset, radius)) - origin;
            let d1 = position_at(step_texel(texel, -frame.omega, j, steps, offset, radius)) - origin;
            let l0 = dot(d0, d0);
            let l1 = dot(d1, d1);
            let c0 = mix(low0, dot(d0, view_dir) * inverseSqrt(l0), falloff(l0));
            let c1 = mix(low1, dot(d1, view_dir) * inverseSqrt(l1), falloff(l1));
            horizon0 = max(horizon0, c0);
            horizon1 = max(horizon1, c1);
        }
        let n = frame.n;
        let h0 = n + clamp(-acos(clamp(horizon1, -1.0, 1.0)) - n, -HALF_PI, HALF_PI);
        let h1 = n + clamp(acos(clamp(horizon0, -1.0, 1.0)) - n, -HALF_PI, HALF_PI);
        let arc0 = (frame.cos_n + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) / 4.0;
        let arc1 = (frame.cos_n + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) / 4.0;
        visibility += frame.projected_length * (arc0 + arc1);
    }
    visibility = max(0.03, visibility / f32(slices));
    return result(pow(visibility, settings.shape.y), distance);
}

@fragment
fn gtao(@builtin(position) position: vec4f) -> @location(0) vec4f {
    return horizon_ao(position, 2, 3);
}

@fragment
fn gtao_wide(@builtin(position) position: vec4f) -> @location(0) vec4f {
    return horizon_ao(position, 4, 3);
}

/// The set bits of a word. GLSL ES 3.00 has no bitCount.
fn bits_set(word: u32) -> u32 {
    var x = word - ((word >> 1u) & 0x55555555u);
    x = (x & 0x33333333u) + ((x >> 2u) & 0x33333333u);
    x = (x + (x >> 4u)) & 0x0F0F0F0Fu;
    return (x * 0x01010101u) >> 24u;
}

/// The sectors between two angles, each from 0 to 1 across the half circle around the normal.
fn sectors(low: f32, high: f32) -> u32 {
    let start = u32(clamp(low * 32.0, 0.0, 32.0));
    let count = u32(clamp(ceil((high - low) * 32.0), 0.0, 32.0));
    if count == 0u || start >= 32u {
        return 0u;
    }
    return (0xFFFFFFFFu >> (32u - count)) << start;
}

/// One sample's occluded sectors: from its front face's angle to its back face's, a thickness
/// behind it. A sample that lies within a small angle of the surface's own plane occludes nothing,
/// so flat surfaces keep every sector open.
fn sample_sectors(delta: vec3f, view_dir: vec3f, normal: vec3f, side: f32, n: f32) -> u32 {
    if dot(delta, normal) <= 0.05 * length(delta) {
        return 0u;
    }
    let thickness = settings.shape.w;
    let front = acos(clamp(dot(normalize(delta), view_dir), -1.0, 1.0));
    let back = acos(clamp(dot(normalize(delta - view_dir * thickness), view_dir), -1.0, 1.0));
    let angles = clamp((side * vec2f(front, back) - n + HALF_PI) / PI, vec2f(0.0), vec2f(1.0));
    let falloff_weight = falloff(dot(delta, delta));
    if falloff_weight <= 0.0 {
        return 0u;
    }
    return sectors(min(angles.x, angles.y), max(angles.x, angles.y));
}

@fragment
fn bitmask(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = vec2i(position.xy);
    let distance = distance_at(texel);
    if distance <= 0.0 {
        return result(1.0, 0.0);
    }
    let origin = position_from(vec2f(texel), distance);
    let normal = rebuilt_normal(texel, origin);
    let view_dir = normalize(-origin);
    let radius = settings.rays.z * settings.rays.w / distance;
    let noise = ign(texel);
    let offset = spatial_offset(texel);
    let slices = 2;
    let steps = 3;
    var visibility = 0.0;
    for (var slice = 0; slice < slices; slice++) {
        let frame = slice_frame((f32(slice) + noise) / f32(slices), normal, view_dir);
        var occluded = 0u;
        for (var j = 0; j < steps; j++) {
            let d0 = position_at(step_texel(texel, frame.omega, j, steps, offset, radius)) - origin;
            let d1 = position_at(step_texel(texel, -frame.omega, j, steps, offset, radius)) - origin;
            occluded |= sample_sectors(d0, view_dir, normal, 1.0, frame.n);
            occluded |= sample_sectors(d1, view_dir, normal, -1.0, frame.n);
        }
        visibility += 1.0 - f32(bits_set(occluded)) / 32.0;
    }
    visibility = max(0.03, visibility / f32(slices));
    return result(pow(visibility, settings.shape.y), distance);
}

/// Gaussian weights of the blur's taps from the center out, sigma 2.5 texels.
fn gauss(i: i32) -> f32 {
    let x = f32(i);
    return exp(-x * x / 12.5);
}

fn bilateral(position: vec4f, axis: vec2i) -> vec4f {
    let texel = vec2i(position.xy);
    let center = textureLoad(found, texel, 0).xy;
    if center.y <= 0.0 {
        return vec4f(center, 0.0, 1.0);
    }
    let size = vec2i(settings.sizes.xy) - 1;
    let tolerance = 0.03 * center.y;
    var sum = center.x;
    var total = 1.0;
    for (var i = 1; i <= 5; i++) {
        let a = textureLoad(found, clamp(texel + axis * i, vec2i(0), size), 0).xy;
        let b = textureLoad(found, clamp(texel - axis * i, vec2i(0), size), 0).xy;
        let ga = (a.y - center.y) / tolerance;
        let gb = (b.y - center.y) / tolerance;
        let wa = gauss(i) * max(0.0, 1.0 - ga * ga);
        let wb = gauss(i) * max(0.0, 1.0 - gb * gb);
        sum += a.x * wa + b.x * wb;
        total += wa + wb;
    }
    return vec4f(sum / total, center.y, 0.0, 1.0);
}

@fragment
fn blur_x(@builtin(position) position: vec4f) -> @location(0) vec4f {
    return bilateral(position, vec2i(1, 0));
}

@fragment
fn blur_y(@builtin(position) position: vec4f) -> @location(0) vec4f {
    return bilateral(position, vec2i(0, 1));
}

// M2-F2's steps as merged (ao.wgsl), reading the distance in place of the depth value.

/// The 5 x 5 magic square of three.js's noise, from 1 to 25.
fn magic_square(cell: vec2i) -> i32 {
    let high = (4 * cell.y + 4 * cell.x + 1) % 5;
    let low = (3 * cell.y + 4 * cell.x + 3) % 5;
    return 5 * high + low + 1;
}

/// three.js's computeNormalFromDepth: 9 reads.
fn three_normal(texel: vec2i, center: vec3f) -> vec3f {
    let c = distance_at(texel);
    let left = distance_at(texel - vec2i(1, 0));
    let right = distance_at(texel + vec2i(1, 0));
    let above = distance_at(texel - vec2i(0, 1));
    let below = distance_at(texel + vec2i(0, 1));
    let left_error = abs(2.0 * left - distance_at(texel - vec2i(2, 0)) - c);
    let right_error = abs(2.0 * right - distance_at(texel + vec2i(2, 0)) - c);
    let above_error = abs(2.0 * above - distance_at(texel - vec2i(0, 2)) - c);
    let below_error = abs(2.0 * below - distance_at(texel + vec2i(0, 2)) - c);
    var across = position_at(texel + vec2i(1, 0)) - center;
    if left_error < right_error {
        across = center - position_at(texel - vec2i(1, 0));
    }
    var down = position_at(texel + vec2i(0, 1)) - center;
    if above_error < below_error {
        down = center - position_at(texel - vec2i(0, 1));
    }
    let normal = normalize(cross(across, down));
    return select(normal, -normal, dot(normal, center) > 0.0);
}

/// The view-space position of the surface under a view-space point: three.js's sample.
fn surface_under(view: vec3f) -> vec3f {
    let ndc = view.xy / (-view.z * settings.rays.xy);
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 * settings.camera.z);
    let texel = vec2i(floor(uv * settings.sizes.xy));
    return position_at(texel);
}

fn raise(horizon: f32, center: vec3f, to_view: vec3f, offset: vec3f, fall: f32) -> f32 {
    let delta = surface_under(center + offset) - center;
    if abs(delta.z) >= settings.three_horizon.y {
        return horizon;
    }
    let cosine = dot(to_view, normalize(delta));
    return horizon + max(0.0, (cosine - horizon) * fall);
}

@fragment
fn three_horizon(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = vec2i(position.xy);
    if distance_at(texel) <= 0.0 {
        return vec4f(1.0, 0.0, 0.0, 0.0);
    }
    let center = position_at(texel);
    let normal = three_normal(texel, center);
    let noise = (texel % 5 + 5) % 5;
    let turn = 2.0 * PI * f32(magic_square(noise)) / 25.0;
    let tangent = vec3f(cos(turn), sin(turn), 0.0);
    let bitangent = vec3f(-tangent.y, tangent.x, 0.0);
    let radius = settings.three_horizon.x;
    let exponent = settings.three_horizon.z;
    let fall_off = settings.three_horizon.w;
    let slices = i32(settings.three_shape.y);
    let steps = i32(settings.three_shape.z);
    let to_view = normalize(-center);
    var open = 0.0;
    for (var slice = 0; slice < slices; slice++) {
        let angle = f32(slice) / f32(slices) * PI;
        let direction = normalize(tangent * cos(angle) + bitangent * sin(angle));
        let slice_bitangent = normalize(cross(direction, to_view));
        let slice_tangent = cross(slice_bitangent, to_view);
        let normal_in_slice = normalize(normal - slice_bitangent * dot(normal, slice_bitangent));
        let toward_normal = cross(normal_in_slice, slice_bitangent);
        var horizons = vec2f(dot(to_view, toward_normal), dot(to_view, -toward_normal));
        for (var step = 0; step < steps; step++) {
            let reach = radius * pow(f32(step + 1) / f32(steps), exponent);
            let offset = direction * reach;
            let fall = mix(1.0, 2.0 / f32(step + 2), fall_off);
            horizons.x = raise(horizons.x, center, to_view, offset, fall);
            horizons.y = raise(horizons.y, center, to_view, -offset, fall);
        }
        let sines = sqrt(1.0 - horizons * horizons);
        let nx = dot(normal_in_slice, slice_tangent);
        let ny = dot(normal_in_slice, to_view);
        let nxb = 0.5 * (acos(horizons.y) - acos(horizons.x) + sines.x * horizons.x
            - sines.y * horizons.y);
        let nyb = 0.5 * (2.0 - horizons.x * horizons.x - horizons.y * horizons.y);
        open += nx * nxb + ny * nyb;
    }
    let occlusion = pow(clamp(open / f32(slices), 0.0, 1.0), settings.three_shape.x);
    return vec4f(occlusion, normal);
}

fn horizon_at(texel: vec2i) -> vec4f {
    let inside = clamp(texel, vec2i(0), vec2i(settings.sizes.xy) - 1);
    return textureLoad(found, inside, 0);
}

@fragment
fn three_denoise(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = vec2i(position.xy);
    let distance = distance_at(texel);
    let held_center = horizon_at(texel);
    if distance <= 0.0 || dot(held_center.yzw, held_center.yzw) == 0.0 {
        return vec4f(1.0, distance, 0.0, 1.0);
    }
    let center = position_at(texel);
    let normal = held_center.yzw;
    let noise = ign(texel);
    let swing = vec2f(sin(noise * 2.0 * PI), cos(noise * 2.0 * PI));
    let turn = mat2x2f(swing.x, -swing.y, swing.x, swing.y);
    let luma_phi = settings.three_denoise.x;
    let depth_phi = settings.three_denoise.y;
    let normal_phi = settings.three_denoise.z;
    let radius = settings.three_denoise.w;
    var sum = held_center.x;
    var total = 1.0;
    for (var tap = 0; tap < 16; tap++) {
        let angle = 2.0 * PI * 2.0 * f32(tap) / 16.0;
        let spread = f32(tap) / 15.0;
        let offset = turn * (vec2f(cos(angle), sin(angle)) * (1.0 + spread * (radius - 1.0)));
        let other = texel + vec2i(floor(offset + 0.5));
        let held = horizon_at(other);
        let normal_weight = pow(max(dot(normal, held.yzw), 0.0), normal_phi);
        let luma_weight = max(1.0 - abs(held.x - held_center.x) / luma_phi, 0.0);
        let plane = abs(dot(center - position_at(other), normal));
        let depth_weight = max(1.0 - plane / depth_phi, 0.0);
        let weight = luma_weight * depth_weight * normal_weight;
        sum += held.x * weight;
        total += weight;
    }
    return vec4f(sum / total, distance, 0.0, 1.0);
}

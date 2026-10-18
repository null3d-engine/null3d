#define_import_path null3d::subsurface

// The skin pass's texels, which the subsurface blur reads (subsurface.wgsl). A texel of the
// target's 32-bit floats holds the diffuse light that scatters in red, green and blue, and the
// surface's view distance in alpha: 0 where no skin drew. The low 8 bits of each color channel's
// float hold that channel's scatter distance, on a log scale, so the blur needs no material
// table. Those bits change the light by less than one part in 30,000. Light below the smallest
// normal float keeps a tiny floor, so a channel's bits never fall to a denormal, which a GPU may
// flush to zero.

/// The base-2 log of the shortest scatter distance that a texel holds, in world units: about
/// 0.06 mm.
const SHORTEST_LOG: f32 = -14.0;
/// The base-2 logs that the codes span above the shortest: up to 64 world units.
const SPAN_LOG: f32 = 20.0;
/// The bits of a channel's float that hold its code.
const CODE_BITS: u32 = 0xffu;

/// The code of scatter distance `d`: 0 for none, else 1 to 255 on the log scale.
fn distance_code(d: f32) -> u32 {
    if d <= 0.0 {
        return 0u;
    }
    let at = (log2(d) - SHORTEST_LOG) / SPAN_LOG;
    return u32(clamp(round(at * 254.0), 0.0, 254.0)) + 1u;
}

/// The scatter distance of `code`.
fn code_distance(code: u32) -> f32 {
    if code == 0u {
        return 0.0;
    }
    return exp2(f32(code - 1u) / 254.0 * SPAN_LOG + SHORTEST_LOG);
}

/// The skin pass's texel of scattered light `light`, with scatter distances `d` of red, green and
/// blue, at view distance `away`.
fn skin_texel(light: vec3f, d: vec3f, away: f32) -> vec4f {
    let kept = bitcast<vec3u>(clamp(light, vec3f(1e-30), vec3f(65504.0))) & vec3u(~CODE_BITS);
    let codes = vec3u(distance_code(d.x), distance_code(d.y), distance_code(d.z));
    return vec4f(bitcast<vec3f>(kept | codes), away);
}

/// The scattered light of a skin texel.
fn scattered_light(texel: vec4f) -> vec3f {
    return bitcast<vec3f>(bitcast<vec3u>(texel.rgb) & vec3u(~CODE_BITS));
}

/// The scatter distances of red, green and blue of a skin texel.
fn scatter_distances(texel: vec4f) -> vec3f {
    let codes = bitcast<vec3u>(texel.rgb) & vec3u(CODE_BITS);
    return vec3f(code_distance(codes.x), code_distance(codes.y), code_distance(codes.z));
}

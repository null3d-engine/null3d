#define_import_path null3d::cubemap

// Directions on the sphere as the engine's maps of light store them: the faces of a cube map, in
// the table that every GPU path shares, and octahedral maps, which fold the whole sphere into one
// square. The filters that make environment maps and reflection probes read and write them, and
// the lit shaders read reflection probes' octahedral maps.

/// The direction through a face at the face coordinates `sc` and `tc`, each from -1 to 1, in the
/// cube map table that every GPU path shares: faces +X, -X, +Y, -Y, +Z, -Z from 0. The direction
/// is not unit length.
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

/// Where direction `d` meets the cube: its face in `z`, from 0, and its face coordinates `sc` and
/// `tc` in `xy`, each from -1 to 1, as [`face_direction`] takes them.
fn face_point(d: vec3f) -> vec3f {
    let a = abs(d);
    if a.x >= a.y && a.x >= a.z {
        let face = select(1.0, 0.0, d.x > 0.0);
        return vec3f(select(d.z, -d.z, d.x > 0.0) / a.x, -d.y / a.x, face);
    }
    if a.y >= a.z {
        let face = select(3.0, 2.0, d.y > 0.0);
        return vec3f(d.x / a.y, select(-d.z, d.z, d.y > 0.0) / a.y, face);
    }
    let face = select(5.0, 4.0, d.z > 0.0);
    return vec3f(select(-d.x, d.x, d.z > 0.0) / a.z, -d.y / a.z, face);
}

/// The octahedral map's point of unit direction `d`, from -1 to 1 each way. The map's center holds
/// straight up, +Y, its edges the horizon's folds below, and its corners straight down.
fn octahedral_point(d: vec3f) -> vec2f {
    let p = d / (abs(d.x) + abs(d.y) + abs(d.z));
    let flat = p.xz;
    if p.y >= 0.0 {
        return flat;
    }
    let s = select(vec2f(-1.0), vec2f(1.0), flat >= vec2f(0.0));
    return (1.0 - abs(flat.yx)) * s;
}

/// The unit direction at point `e` of the octahedral map, from -1 to 1 each way.
fn octahedral_direction(e: vec2f) -> vec3f {
    let y = 1.0 - abs(e.x) - abs(e.y);
    var flat = e;
    if y < 0.0 {
        let s = select(vec2f(-1.0), vec2f(1.0), e >= vec2f(0.0));
        flat = (1.0 - abs(e.yx)) * s;
    }
    return normalize(vec3f(flat.x, y, flat.y));
}

/// The texture coordinates of point `e` of an octahedral map in a level `size` texels wide. The
/// centers of the level's first and last texels lie on the map's edges, so a linear filter never
/// reads across a fold.
fn octahedral_uv(e: vec2f, size: f32) -> vec2f {
    return (e * 0.5 + 0.5) * ((size - 1.0) / size) + 0.5 / size;
}

/// The point of the octahedral map at the center of texel `texel` of a level `size` texels wide,
/// the inverse of [`octahedral_uv`].
fn octahedral_texel_point(texel: vec2f, size: f32) -> vec2f {
    return texel * (2.0 / (size - 1.0)) - 1.0;
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

/// Van der Corput's radical inverse in base 2.
fn radical_inverse(i: u32) -> f32 {
    var bits = (i << 16u) | (i >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xaaaaaaaau) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xccccccccu) >> 2u);
    bits = ((bits & 0x0f0f0f0fu) << 4u) | ((bits & 0xf0f0f0f0u) >> 4u);
    bits = ((bits & 0x00ff00ffu) << 8u) | ((bits & 0xff00ff00u) >> 8u);
    return f32(bits) * (1.0 / 4294967296.0);
}

/// 2 to the power `e`, exact for the exponents of normal floats.
fn power_of_two(e: i32) -> f32 {
    return bitcast<f32>(u32(e + 127) << 23u);
}

/// A texel's light as `rgb9e5ufloat`, rounded to nearest as `EXT_texture_shared_exponent` packs
/// it, in the four bytes of an `rgba8unorm` texel, lowest byte first. A quarter step above each
/// byte keeps the byte whether the GPU rounds or truncates its conversion to 8 bits.
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

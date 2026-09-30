#define_import_path null3d::noise

// Hashes, random numbers and noise. Each function hashes whole numbers with integer arithmetic,
// which gives the same bits on every GPU. A pattern made from them therefore looks the same on
// WebGPU and WebGL2, and on every device. The noise functions come in 2D and 3D forms, named with
// the number of dimensions at the end.

/// The PCG hash of a 32-bit value, from Jarzynski and Olano's "Hash Functions for GPU Rendering".
fn pcg(v: u32) -> u32 {
    let state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

/// Hashes three 32-bit values together into three, each of which depends on all of them. This is
/// the pcg3d hash from the same paper.
fn pcg3d(v: vec3u) -> vec3u {
    var p = v * 1664525u + 1013904223u;
    p.x += p.y * p.z;
    p.y += p.z * p.x;
    p.z += p.x * p.y;
    p ^= p >> vec3u(16u);
    p.x += p.y * p.z;
    p.y += p.z * p.x;
    p.z += p.x * p.y;
    return p;
}

/// A number from 0 up to 1 made from the top 24 bits of a hash. A 32-bit float holds each such
/// number exactly.
fn to_unit(h: u32) -> f32 {
    return f32(h >> 8u) / 16777216.0;
}

/// A random number from 0 up to 1 for a seed. The same seed gives the same number on every GPU.
fn random(seed: u32) -> f32 {
    return to_unit(pcg(seed));
}

/// A random number from 0 up to 1 for a 2D point, such as a pixel position. It hashes the bits of
/// the coordinates, so points that differ in any bit get unrelated numbers.
fn random2(p: vec2f) -> f32 {
    let bits = bitcast<vec2u>(p);
    return to_unit(pcg(bits.x ^ pcg(bits.y)));
}

/// A random number from 0 up to 1 for a 3D point. It hashes the bits of the coordinates.
fn random3(p: vec3f) -> f32 {
    return to_unit(pcg3d(bitcast<vec3u>(p)).x);
}

/// The hash of a point of the whole-number lattice.
fn lattice(c: vec3i) -> vec3u {
    return pcg3d(bitcast<vec3u>(c));
}

/// The fade curve of Perlin's improved noise: 0 at 0, 1 at 1, and flat at both ends up to the
/// second derivative.
fn fade(t: vec3f) -> vec3f {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/// Value noise in 3D, from 0 to 1: random values at the lattice points, blended with the fade
/// curve.
fn value3(p: vec3f) -> f32 {
    let i = vec3i(floor(p));
    let u = fade(fract(p));
    let x00 = mix(to_unit(lattice(i).x), to_unit(lattice(i + vec3i(1, 0, 0)).x), u.x);
    let x10 = mix(to_unit(lattice(i + vec3i(0, 1, 0)).x), to_unit(lattice(i + vec3i(1, 1, 0)).x), u.x);
    let x01 = mix(to_unit(lattice(i + vec3i(0, 0, 1)).x), to_unit(lattice(i + vec3i(1, 0, 1)).x), u.x);
    let x11 = mix(to_unit(lattice(i + vec3i(0, 1, 1)).x), to_unit(lattice(i + vec3i(1, 1, 1)).x), u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

/// Value noise in 2D, from 0 to 1.
fn value2(p: vec2f) -> f32 {
    let i = vec3i(vec2i(floor(p)), 0);
    let u = fade(vec3f(fract(p), 0.0));
    let x0 = mix(to_unit(lattice(i).x), to_unit(lattice(i + vec3i(1, 0, 0)).x), u.x);
    let x1 = mix(to_unit(lattice(i + vec3i(0, 1, 0)).x), to_unit(lattice(i + vec3i(1, 1, 0)).x), u.x);
    return mix(x0, x1, u.y);
}

/// The dot product of `f` with one of the twelve gradients of Perlin's improved noise, which the
/// hash `h` chooses. The gradients point to the midpoints of a cube's edges.
fn gradient(h: u32, f: vec3f) -> f32 {
    let k = h & 15u;
    let u = select(f.y, f.x, k < 8u);
    let v = select(select(f.z, f.x, k == 12u || k == 14u), f.y, k < 4u);
    return select(-u, u, (k & 1u) == 0u) + select(-v, v, (k & 2u) == 0u);
}

/// Perlin's improved gradient noise in 3D, from about -1 to 1. It is 0 at every lattice point.
fn perlin3(p: vec3f) -> f32 {
    let i = vec3i(floor(p));
    let f = fract(p);
    let u = fade(f);
    let x00 = mix(
        gradient(lattice(i).x, f),
        gradient(lattice(i + vec3i(1, 0, 0)).x, f - vec3f(1.0, 0.0, 0.0)),
        u.x,
    );
    let x10 = mix(
        gradient(lattice(i + vec3i(0, 1, 0)).x, f - vec3f(0.0, 1.0, 0.0)),
        gradient(lattice(i + vec3i(1, 1, 0)).x, f - vec3f(1.0, 1.0, 0.0)),
        u.x,
    );
    let x01 = mix(
        gradient(lattice(i + vec3i(0, 0, 1)).x, f - vec3f(0.0, 0.0, 1.0)),
        gradient(lattice(i + vec3i(1, 0, 1)).x, f - vec3f(1.0, 0.0, 1.0)),
        u.x,
    );
    let x11 = mix(
        gradient(lattice(i + vec3i(0, 1, 1)).x, f - vec3f(0.0, 1.0, 1.0)),
        gradient(lattice(i + vec3i(1, 1, 1)).x, f - vec3f(1.0, 1.0, 1.0)),
        u.x,
    );
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

/// Perlin's improved gradient noise in 2D, from about -1 to 1: the plane z = 0 of the 3D noise's
/// gradients.
fn perlin2(p: vec2f) -> f32 {
    let i = vec3i(vec2i(floor(p)), 0);
    let f = vec3f(fract(p), 0.0);
    let u = fade(f);
    let x0 = mix(
        gradient(lattice(i).x, f),
        gradient(lattice(i + vec3i(1, 0, 0)).x, f - vec3f(1.0, 0.0, 0.0)),
        u.x,
    );
    let x1 = mix(
        gradient(lattice(i + vec3i(0, 1, 0)).x, f - vec3f(0.0, 1.0, 0.0)),
        gradient(lattice(i + vec3i(1, 1, 0)).x, f - vec3f(1.0, 1.0, 0.0)),
        u.x,
    );
    return mix(x0, x1, u.y);
}

/// The part of simplex noise that one corner adds at offset `x` from it: a falloff that reaches 0
/// at squared distance `r2`, times the corner's gradient.
fn simplex_corner(c: vec3i, x: vec3f, r2: f32) -> f32 {
    let t = max(r2 - dot(x, x), 0.0);
    let t2 = t * t;
    return t2 * t2 * gradient(lattice(c).x, x);
}

/// Simplex noise in 3D, from about -1 to 1, after Gustavson's "Simplex noise demystified". It
/// costs less than Perlin noise and shows fewer lattice lines.
fn simplex3(p: vec3f) -> f32 {
    let skew = (p.x + p.y + p.z) / 3.0;
    let cell = floor(p + skew);
    let unskew = (cell.x + cell.y + cell.z) / 6.0;
    let x0 = p - (cell - unskew);
    let g = step(x0.yzx, x0.xyz);
    let l = 1.0 - g;
    let i1 = min(g, l.zxy);
    let i2 = max(g, l.zxy);
    let x1 = x0 - i1 + 1.0 / 6.0;
    let x2 = x0 - i2 + 1.0 / 3.0;
    let x3 = x0 - 0.5;
    let i = vec3i(cell);
    let n = simplex_corner(i, x0, 0.6) + simplex_corner(i + vec3i(i1), x1, 0.6)
        + simplex_corner(i + vec3i(i2), x2, 0.6) + simplex_corner(i + vec3i(1, 1, 1), x3, 0.6);
    return 32.0 * n;
}

/// Simplex noise in 2D, from about -1 to 1.
fn simplex2(p: vec2f) -> f32 {
    let skew = (p.x + p.y) * 0.36602540378443865;
    let cell = floor(p + skew);
    let unskew = (cell.x + cell.y) * 0.21132486540518713;
    let x0 = p - (cell - unskew);
    let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
    let x1 = x0 - i1 + 0.21132486540518713;
    let x2 = x0 - 1.0 + 0.42264973081037427;
    let i = vec3i(vec2i(cell), 0);
    let n = simplex_corner(i, vec3f(x0, 0.0), 0.5)
        + simplex_corner(i + vec3i(vec2i(i1), 0), vec3f(x1, 0.0), 0.5)
        + simplex_corner(i + vec3i(1, 1, 0), vec3f(x2, 0.0), 0.5);
    return 70.0 * n;
}

/// Cellular noise in 3D, after Worley: the distance from `p` to the nearest of the random points
/// that each lattice cell holds. It is 0 at those points and rarely above 1.
fn worley3(p: vec3f) -> f32 {
    let i = vec3i(floor(p));
    let f = fract(p);
    var nearest = 8.0;
    for (var z = -1; z <= 1; z++) {
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let o = vec3i(x, y, z);
                let h = lattice(i + o);
                let d = vec3f(o) + vec3f(h >> vec3u(8u)) / 16777216.0 - f;
                nearest = min(nearest, dot(d, d));
            }
        }
    }
    return sqrt(nearest);
}

/// Cellular noise in 2D: the distance from `p` to the nearest random point.
fn worley2(p: vec2f) -> f32 {
    let i = vec2i(floor(p));
    let f = fract(p);
    var nearest = 8.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let o = vec2i(x, y);
            let h = lattice(vec3i(i + o, 0));
            let d = vec2f(o) + vec2f(h.xy >> vec2u(8u)) / 16777216.0 - f;
            nearest = min(nearest, dot(d, d));
        }
    }
    return sqrt(nearest);
}

/// Fractal noise in 3D: `octaves` layers of simplex noise, each at twice the frequency and half
/// the amplitude of the one before. The sum is divided by the total amplitude, so it stays from
/// about -1 to 1. With no octaves it is 0.
fn fbm3(p: vec3f, octaves: u32) -> f32 {
    var sum = 0.0;
    var total = 0.0;
    var amplitude = 1.0;
    var q = p;
    for (var octave = 0u; octave < octaves; octave++) {
        sum += amplitude * simplex3(q);
        total += amplitude;
        amplitude *= 0.5;
        q *= 2.0;
    }
    return select(0.0, sum / total, total > 0.0);
}

/// Fractal noise in 2D from simplex noise, from about -1 to 1.
fn fbm2(p: vec2f, octaves: u32) -> f32 {
    var sum = 0.0;
    var total = 0.0;
    var amplitude = 1.0;
    var q = p;
    for (var octave = 0u; octave < octaves; octave++) {
        sum += amplitude * simplex2(q);
        total += amplitude;
        amplitude *= 0.5;
        q *= 2.0;
    }
    return select(0.0, sum / total, total > 0.0);
}

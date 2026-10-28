// One stage of an ocean band's inverse transform, as a compute pass. A band's spectrum holds the
// amplitude of each plane wave; the inverse transform adds them into the height of the sea at each
// point of the tile, as a chain of radix-2 butterfly stages: seven stages along one axis, then seven
// along the other. Each pass runs one stage for all three bands, a band to a layer, and reads the
// pass before it. The first horizontal pass adds the waves at the sketch time instead of reading a
// pass, so the whole chain costs one pass for each stage and nothing a frame.
//
// A stage turns one output texel into a mix of two texels of the pass before, so the chain works as
// the fragment form too, which writes one texel for each pixel.
//
// The block between the transform markers is byte for byte the same as the one in `fft.fallback.wgsl`,
// which draws the WebGL2 fragment form. A test compares them and fails when one is edited alone.
struct ComputeBlock {
    size: vec4f,
    clock: vec4f,
    inverseProjection: mat4x4f,
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
    drawn: vec4f,
    bloom: vec4f,
}

@group(0) @binding(0) var<uniform> block: ComputeBlock;
@group(0) @binding(1) var output: texture_storage_2d_array<rgba16float, write>;
@group(1) @binding(0) var source: texture_2d_array<f32>;

// <wave-transform>
/// The metres a second squared that gravity adds to a falling object.
const WAVE_GRAVITY: f32 = 9.81;
/// The radians of one whole turn.
const WAVE_TURN: f32 = 6.283185307179586;
/// The stages of one axis: the radix-2 steps that a 128-texel axis takes.
const WAVE_STAGES: i32 = 7;

/// The meters that a band's tile covers, from the first value's three numbers after the stage.
fn wave_tile(values: vec4f, band: u32) -> f32 {
    if (band == 0u) { return values.y; }
    if (band == 1u) { return values.z; }
    return values.w;
}

/// The texel that a frequency stands at, with the tile's other edge standing in for the one past it.
fn wave_wrap(value: i32, n: i32) -> i32 {
    return ((value % n) + n) % n;
}

/// The bits of an index, turned around: the order that the first butterfly stage reads.
fn wave_reversed(value: u32, bits: u32) -> u32 {
    var result = 0u;
    var left = value;
    for (var i = 0u; i < bits; i = i + 1u) {
        result = (result << 1u) | (left & 1u);
        left = left >> 1u;
    }
    return result;
}

/// The spectrum's wave at one frequency, as its real and imaginary parts.
fn wave_spectrum(i: i32, j: i32, n: i32, layer: i32) -> vec2f {
    return textureLoad(source, vec2i(wave_wrap(i, n), wave_wrap(j, n)), layer, 0).rg;
}

/// The wave number of a texel, in radians a metre: the texels above half the grid stand for the
/// negative frequencies, which run the other way.
fn wave_number(texel: i32, n: i32, tile: f32) -> f32 {
    let frequency = select(texel, texel - n, texel >= n / 2);
    return (WAVE_TURN * f32(frequency)) / tile;
}

/// The phase of the wave at one frequency at the sketch time, in radians.
fn wave_angle(i: i32, j: i32, n: i32, tile: f32, time: f32) -> f32 {
    let k = length(vec2f(wave_number(i, n, tile), wave_number(j, n, tile)));
    return sqrt(WAVE_GRAVITY * k) * time;
}

/// The waves' sum at one frequency and the sketch time: the wave that runs forward, and the mirrored
/// one that runs against it as its conjugate.
fn wave_height(i: i32, j: i32, n: i32, tile: f32, time: f32, layer: i32) -> vec2f {
    let forward = wave_spectrum(i, j, n, layer);
    let mirrored = wave_spectrum(-i, -j, n, layer);
    let angle = wave_angle(i, j, n, tile, time);
    let cosA = cos(angle);
    let sinA = sin(angle);
    return vec2f(
        forward.x * cosA - forward.y * sinA + mirrored.x * cosA - mirrored.y * sinA,
        forward.x * sinA + forward.y * cosA - mirrored.x * sinA - mirrored.y * cosA,
    );
}

/// The value of a texel of the pass before, which this pass's stage reads.
fn wave_state(i: i32, j: i32, layer: i32) -> vec2f {
    return textureLoad(source, vec2i(i, j), layer, 0).rg;
}

/// The butterfly of one pair: the sum and the difference of the two inputs, the difference turned by
/// the pair's own angle so that the waves of the two halves line up.
fn wave_butterfly(u: vec2f, v: vec2f, top: bool, j: u32, length: u32) -> vec2f {
    let angle = (WAVE_TURN * f32(j)) / f32(length);
    let cosA = cos(angle);
    let sinA = sin(angle);
    let turned = vec2f(v.x * cosA - v.y * sinA, v.x * sinA + v.y * cosA);
    return select(vec2f(u.x - turned.x, u.y - turned.y), vec2f(u.x + turned.x, u.y + turned.y), top);
}

/// One stage of the transform for the texel at `x, y`. `stage` falls from 0 to 13: the horizontal
/// stages first, then the vertical ones. The first stage of each axis reads the input in bit-reversed
/// order, which saves the whole input a turn of its own.
fn wave_stage(
    x: i32, y: i32, n: i32, tile: f32, time: f32, layer: i32, stage: i32,
) -> vec2f {
    let bits = u32(WAVE_STAGES);
    if (stage == 0) {
        let top = x & ~1;
        let bottom = top + 1;
        let u = wave_height(i32(wave_reversed(u32(top), bits)), y, n, tile, time, layer);
        let v = wave_height(i32(wave_reversed(u32(bottom), bits)), y, n, tile, time, layer);
        return wave_butterfly(u, v, (x & 1) == 0, 0u, 2u);
    }
    if (stage < WAVE_STAGES) {
        let half = 1u << u32(stage);
        let top = x & ~(i32(half));
        let bottom = top + i32(half);
        let u = wave_state(top, y, layer);
        let v = wave_state(bottom, y, layer);
        return wave_butterfly(u, v, (u32(x) & half) == 0u, u32(x) & (half - 1u), half * 2u);
    }
    let vertical = stage - WAVE_STAGES;
    if (vertical == 0) {
        let top = y & ~1;
        let bottom = top + 1;
        let u = wave_state(x, i32(wave_reversed(u32(top), bits)), layer);
        let v = wave_state(x, i32(wave_reversed(u32(bottom), bits)), layer);
        return wave_butterfly(u, v, (y & 1) == 0, 0u, 2u);
    }
    let half = 1u << u32(vertical);
    let top = y & ~(i32(half));
    let bottom = top + i32(half);
    let u = wave_state(x, top, layer);
    let v = wave_state(x, bottom, layer);
    return wave_butterfly(u, v, (u32(y) & half) == 0u, u32(y) & (half - 1u), half * 2u);
}
// </wave-transform>

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = u32(block.drawn.x);
    if (id.x >= size || id.y >= size) { return; }
    // The first value holds the stage and the three bands' tile widths. The layer of the source
    // texture comes from the engine, which names the first layer of the array that holds it.
    let value = wave_stage(
        i32(id.x),
        i32(id.y),
        i32(size),
        wave_tile(block.u0, id.z),
        block.clock.x,
        i32(id.z),
        i32(block.u0.x),
    );
    // The alpha holds the sketch time that the waves were added at, which the first stage writes and
    // every later stage passes on. A read of the last pass then knows the time of its heights.
    let stage = i32(block.u0.x);
    let layer = i32(id.z);
    let stamp = select(
        textureLoad(source, vec2i(id.xy), layer, 0).a,
        block.clock.x,
        stage == 0,
    );
    textureStore(output, vec2i(id.xy), id.z, vec4f(value, 0.0, stamp));
}

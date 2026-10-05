// The skinning pass: one thread per vertex of each part of each skinned or morphed mesh that some
// view draws in the frame. A thread reads its vertex from the mesh page that holds the part, adds
// its morph target deltas times their weights, blends the skinning matrices of the vertex's four
// joints by their weights, and writes the vertex into the skinned vertex buffer, where the shadow
// and main passes draw it as a plain mesh.
//
// A dispatch covers parts of one mesh page, whose vertices all have the page's vertex format, that
// skin into one skinned vertex buffer.
// The table names the format and each part, which the CPU lists each frame:
//
// - entry 0: the part count, then padding;
// - entries 1 to 3: the format: the strides of a source and a skinned vertex in 32-bit words, and
//   where each attribute sits, each a word offset in the low byte and the type code above it, or
//   every bit set for an attribute that the format lacks; the tangent's skinned offset in the
//   third byte; then the joints, the weights and the morph attribute; and two runs
//   of words that the pass copies unchanged (the texture coordinates, then the color), each its
//   source offset, its skinned offset and its length in words, a byte each;
// - two entries per part: its first workgroup, its vertex count, its first vertex in the page and
//   its first word in the skinned vertex buffer; then the first joint of its animated instance in
//   the joint texture, or every bit set for a mesh that no joint skins, the first texel of its
//   object's morph weights in the morph texture, and padding.
//
// The VERTEX_TANGENT build skins the formats that have a tangent, and the other build those that
// have none. The build without the bit holds no code that reads or writes a tangent, so no thread
// can write the tangent's words, which lie past the vertex's own words in a format without one.
// Adreno 830's driver runs the tangent's write behind a runtime check even where the check is false
// ("Browser faults" in .dev/implementation-notes.md), so the format picks the build instead.
//
// A skinned vertex has its position, then its normal, as 32-bit floats, then the source's other
// attributes in their order, with a tangent as 32-bit floats. Each attribute takes whole words, so
// the skinned vertex is the mesh's vertex format without joints and weights.
//
// Morphing and skinning follow three.js's: each morph target moves the position, the normal and
// the tangent by its deltas times its weight, before skinning. The joint weights are used as they
// are, and the normal and the tangent's direction turn by each joint's matrix without its
// translation.
//
// The morph attribute names the vertex's entries in the morph texture (see the renderer's morph
// module): its first entry's texel, then its entry count times four plus 1 when entries hold a
// normal's delta and 2 when they hold a tangent's. An entry is the position's delta with the
// target's number, then the normal's and the tangent's deltas, in half floats. The weights sit in
// a texture of their own, four to a texel.
//
// A dispatch whose workgroups pass one axis's limit spreads them over rows, and a workgroup's
// number is its place in its row plus the workgroups of the rows before it. Each workgroup finds
// its part with a binary search of the parts' first workgroups; those past the last part's
// vertices do nothing. The joint texture holds each joint's three matrix rows in three texels,
// JOINTS_PER_ROW joints per row.

/// Threads per workgroup.
const WORKGROUP_SIZE: u32 = 64u;
/// Joints per row of the joint texture.
const JOINTS_PER_ROW: u32 = 512u;
/// Texels per row of the morph texture.
const MORPH_TEXELS_PER_ROW: u32 = 2048u;
/// Table entries before the first part: the count, then the format.
const HEADER: u32 = 4u;
/// A field of the format that names no attribute.
const NONE: u32 = 0xffffffffu;

@group(0) @binding(0) var<storage, read> table: array<vec4u>;
@group(0) @binding(1) var<storage, read> source: array<u32>;
@group(0) @binding(2) var<storage, read_write> skinned: array<u32>;
@group(0) @binding(3) var joints: texture_2d<f32>;
@group(0) @binding(4) var morph_texels: texture_2d<f32>;
@group(0) @binding(5) var morph_weights: texture_2d<f32>;

/// Component `c` of the attribute that `field` places, in the source vertex at word `vertex`, as
/// a vertex shader reads it: a float, a normalized integer as a fraction, or a plain integer as
/// its whole value. The type codes are those of the engine's vertex types.
fn component(vertex: u32, field: u32, c: u32) -> f32 {
    let at = vertex + (field & 0xffu);
    let kind = (field >> 8u) & 0xffu;
    if kind == 0u {
        return bitcast<f32>(source[at + c]);
    }
    if kind == 1u || kind == 2u || kind == 5u || kind == 6u {
        let byte = (source[at + c / 4u] >> (8u * (c % 4u))) & 0xffu;
        if kind == 1u || kind == 5u {
            return select(f32(byte), f32(byte) / 255.0, kind == 1u);
        }
        let signed = f32(bitcast<i32>(byte << 24u) >> 24u);
        return select(signed, max(signed / 127.0, -1.0), kind == 2u);
    }
    let half = (source[at + c / 2u] >> (16u * (c % 2u))) & 0xffffu;
    if kind == 3u || kind == 7u {
        return select(f32(half), f32(half) / 65535.0, kind == 3u);
    }
    let signed = f32(bitcast<i32>(half << 16u) >> 16u);
    return select(signed, max(signed / 32767.0, -1.0), kind == 4u);
}

/// The three components of the attribute that `field` places.
fn vector(vertex: u32, field: u32) -> vec3f {
    return vec3f(component(vertex, field, 0u), component(vertex, field, 1u), component(vertex, field, 2u));
}

/// One row of a joint's skinning matrix, from the joint texture.
fn joint_row(joint: u32, row: u32) -> vec4f {
    let x = (joint % JOINTS_PER_ROW) * 3u + row;
    return textureLoad(joints, vec2u(x, joint / JOINTS_PER_ROW), 0);
}

/// Texel `k` of the texture of deltas.
fn morph_texel(k: u32) -> vec4f {
    return textureLoad(morph_texels, vec2u(k % MORPH_TEXELS_PER_ROW, k / MORPH_TEXELS_PER_ROW), 0);
}

/// Texel `k` of the texture of weights.
fn morph_weight_texel(k: u32) -> vec4f {
    return textureLoad(morph_weights, vec2u(k % MORPH_TEXELS_PER_ROW, k / MORPH_TEXELS_PER_ROW), 0);
}

/// A vertex's position, normal and tangent direction.
struct Morphed {
    position: vec3f,
    normal: vec3f,
    tangent: vec3f,
}

/// `rest` moved by the entries that `range` names, each by its target's weight among the texels
/// from `weights` on.
fn morphed(rest: Morphed, range: vec2f, weights: u32) -> Morphed {
    var out = rest;
    let first = u32(range.x);
    let word = u32(range.y);
    let stride = 1u + (word & 1u) + ((word >> 1u) & 1u);
    let count = word >> 2u;
    for (var k = 0u; k < count; k++) {
        let at = first + k * stride;
        let entry = morph_texel(at);
        let t = u32(entry.w);
        let w = morph_weight_texel(weights + t / 4u)[t % 4u];
        if w == 0.0 {
            continue;
        }
        out.position += w * entry.xyz;
        var next = at + 1u;
        if (word & 1u) != 0u {
            out.normal += w * morph_texel(next).xyz;
            next += 1u;
        }
        if (word & 2u) != 0u {
            out.tangent += w * morph_texel(next).xyz;
        }
    }
    return out;
}

/// Copies a run of words unchanged: `run` holds its source offset, its skinned offset and its
/// length, a byte each.
fn copy_run(vertex: u32, out: u32, run: u32) {
    let start = vertex + (run & 0xffu);
    let to = out + ((run >> 8u) & 0xffu);
    let words = (run >> 16u) & 0xffu;
    for (var k = 0u; k < words; k++) {
        skinned[to + k] = source[start + k];
    }
}

fn store(at: u32, value: vec3f) {
    skinned[at] = bitcast<u32>(value.x);
    skinned[at + 1u] = bitcast<u32>(value.y);
    skinned[at + 2u] = bitcast<u32>(value.z);
}

@compute @workgroup_size(64)
fn main(
    @builtin(workgroup_id) id: vec3u,
    @builtin(num_workgroups) count: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let group = id.x + id.y * count.x;
    let parts = table[0].x;
    // The last part whose first workgroup is at most this one.
    var low = 0u;
    var high = parts;
    while high - low > 1u {
        let middle = (low + high) / 2u;
        if table[HEADER + 2u * middle].x <= group {
            low = middle;
        } else {
            high = middle;
        }
    }
    let part = table[HEADER + 2u * low];
    let v = (group - part.x) * WORKGROUP_SIZE + lane;
    if parts == 0u || v >= part.y {
        return;
    }
    let object = table[HEADER + 2u * low + 1u];
    let strides = table[1];
    let more = table[2];
    let runs = table[3];
    let vertex = (part.z + v) * strides.x;
    let out = part.w + v * strides.y;

    var rest = Morphed(vector(vertex, strides.z), vector(vertex, strides.w), vec3f(0.0));
#ifdef VERTEX_TANGENT
    rest.tangent = vector(vertex, more.x);
#endif
    if more.w != NONE && object.y != NONE {
        let range = vec2f(component(vertex, more.w, 0u), component(vertex, more.w, 1u));
        rest = morphed(rest, range, object.y);
    }
    var row_x = vec4f(1.0, 0.0, 0.0, 0.0);
    var row_y = vec4f(0.0, 1.0, 0.0, 0.0);
    var row_z = vec4f(0.0, 0.0, 1.0, 0.0);
    if object.x != NONE && more.y != NONE {
        row_x = vec4f(0.0);
        row_y = vec4f(0.0);
        row_z = vec4f(0.0);
        for (var k = 0u; k < 4u; k++) {
            let weight = component(vertex, more.z, k);
            if weight == 0.0 {
                continue;
            }
            let joint = object.x + u32(component(vertex, more.y, k));
            row_x += weight * joint_row(joint, 0u);
            row_y += weight * joint_row(joint, 1u);
            row_z += weight * joint_row(joint, 2u);
        }
    }
    let p = vec4f(rest.position, 1.0);
    store(out, vec3f(dot(row_x, p), dot(row_y, p), dot(row_z, p)));
    let n = rest.normal;
    store(out + 3u, vec3f(dot(row_x.xyz, n), dot(row_y.xyz, n), dot(row_z.xyz, n)));
#ifdef VERTEX_TANGENT
    let t = rest.tangent;
    let at = out + ((more.x >> 16u) & 0xffu);
    store(at, vec3f(dot(row_x.xyz, t), dot(row_y.xyz, t), dot(row_z.xyz, t)));
    skinned[at + 3u] = bitcast<u32>(component(vertex, more.x, 3u));
#endif
    copy_run(vertex, out, runs.x);
    copy_run(vertex, out, runs.y);
}

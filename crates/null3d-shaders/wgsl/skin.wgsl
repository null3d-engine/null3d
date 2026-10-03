// The skinning pass: one thread per vertex of each part of each skinned mesh that some view draws
// in the frame. A thread reads its vertex from the mesh page that holds the part, blends the
// skinning matrices of the vertex's four joints by their weights, and writes the skinned vertex
// into the skinned vertex buffer, where the shadow and main passes draw it as a plain mesh.
//
// A dispatch covers the parts of one mesh page, whose vertices all have the page's vertex format.
// The table names the format and each part, which the CPU lists each frame:
//
// - entry 0: the part count, then padding;
// - entries 1 to 3: the format: the strides of a source and a skinned vertex in 32-bit words, and
//   where each attribute sits, each a word offset in the low byte and the type code above it;
//   the tangent's skinned offset in the third byte, or every bit set for no tangent; and two runs
//   of words that the pass copies unchanged (the texture coordinates, then the color), each its
//   source offset, its skinned offset and its length in words, a byte each;
// - two entries per part: its first workgroup, its vertex count, its first vertex in the page and
//   its first word in the skinned vertex buffer; then the first joint of its animated instance in
//   the joint texture, and padding.
//
// A skinned vertex has its position, then its normal, as 32-bit floats, then the source's other
// attributes in their order, with a tangent as 32-bit floats. Each attribute takes whole words, so
// the skinned vertex is the mesh's vertex format without joints and weights.
//
// Skinning follows three.js's: the weights are used as they are, and the normal and the tangent's
// direction turn by each joint's matrix without its translation.
//
// Each workgroup finds its part with a binary search of the parts' first workgroups. The joint
// texture holds each joint's three matrix rows in three texels, JOINTS_PER_ROW joints per row.

/// Threads per workgroup.
const WORKGROUP_SIZE: u32 = 64u;
/// Joints per row of the joint texture.
const JOINTS_PER_ROW: u32 = 1024u;
/// Table entries before the first part: the count, then the format.
const HEADER: u32 = 4u;
/// A field of the format that names no attribute.
const NONE: u32 = 0xffffffffu;

@group(0) @binding(0) var<storage, read> table: array<vec4u>;
@group(0) @binding(1) var<storage, read> source: array<u32>;
@group(0) @binding(2) var<storage, read_write> skinned: array<u32>;
@group(0) @binding(3) var joints: texture_2d<f32>;

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
    @builtin(workgroup_id) group: vec3u,
    @builtin(local_invocation_index) lane: u32,
) {
    let parts = table[0].x;
    // The last part whose first workgroup is at most this one.
    var low = 0u;
    var high = parts;
    while high - low > 1u {
        let middle = (low + high) / 2u;
        if table[HEADER + 2u * middle].x <= group.x {
            low = middle;
        } else {
            high = middle;
        }
    }
    let part = table[HEADER + 2u * low];
    let v = (group.x - part.x) * WORKGROUP_SIZE + lane;
    if parts == 0u || v >= part.y {
        return;
    }
    let first_joint = table[HEADER + 2u * low + 1u].x;
    let strides = table[1];
    let more = table[2];
    let runs = table[3];
    let vertex = (part.z + v) * strides.x;
    let out = part.w + v * strides.y;

    var row_x = vec4f(0.0);
    var row_y = vec4f(0.0);
    var row_z = vec4f(0.0);
    for (var k = 0u; k < 4u; k++) {
        let weight = component(vertex, more.z, k);
        if weight == 0.0 {
            continue;
        }
        let joint = first_joint + u32(component(vertex, more.y, k));
        row_x += weight * joint_row(joint, 0u);
        row_y += weight * joint_row(joint, 1u);
        row_z += weight * joint_row(joint, 2u);
    }
    let p = vec4f(vector(vertex, strides.z), 1.0);
    store(out, vec3f(dot(row_x, p), dot(row_y, p), dot(row_z, p)));
    let n = vector(vertex, strides.w);
    store(out + 3u, vec3f(dot(row_x.xyz, n), dot(row_y.xyz, n), dot(row_z.xyz, n)));
    if more.x != NONE {
        let t = vector(vertex, more.x);
        let at = out + ((more.x >> 16u) & 0xffu);
        store(at, vec3f(dot(row_x.xyz, t), dot(row_y.xyz, t), dot(row_z.xyz, t)));
        skinned[at + 3u] = bitcast<u32>(component(vertex, more.x, 3u));
    }
    copy_run(vertex, out, runs.x);
    copy_run(vertex, out, runs.y);
}

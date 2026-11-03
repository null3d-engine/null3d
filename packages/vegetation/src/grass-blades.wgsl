// The blade list that the grass draws and its near shadows read: one dispatch builds the rows of
// a preset's tufts into the draw's instance buffer and writes the count that the engine copies
// into the main view's indirect entry and every drawn shadow view's. The tuft data comes in a
// texture of its own, so the hill's placement stays the CPU's integer hash and both GPU paths
// place the same tufts.
//
// The pass culls by view and thins by distance. A tuft whose 4 meter tile lies outside the
// camera's frustum is not listed, and a far tuft takes a share of the draws from its root's hash,
// the same share that widens its blades in the draw shader. So the camera's view and the far
// ground cost less, and the drawn hill looks as it does on WebGL2, where the vertex shader
// collapses the tufts that the share leaves out.
//
// One workgroup builds the whole list, so it can zero the count and add to it without a race, and
// the loop covers a hill of any size.

#import null3d::noise::{pcg}

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
@group(0) @binding(1) var<storage, read_write> counts: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> instances: array<vec4f>;
@group(1) @binding(0) var tufts: texture_2d_array<f32>;

/// The invocations of the pass's one workgroup, which the loop strides by.
const WORKGROUP: u32 = 128u;
/// The vectors of one instance's row: its three matrix rows, then its ids.
const ROW_VECTORS: u32 = 4u;
/// The side of a square of ground that the view cull tests as one tile, in meters.
const TILE: f32 = 4.0;
/// The radius about a tile's middle that covers the tile's ground and every tuft on it, in meters.
const TILE_RADIUS: f32 = 4.0;

// <tuft-density>
/// The share of a tuft that the far ground draws, from all of it near the camera to this share far
/// from it, and the distances where the share falls. A tuft's place keeps one share, and its
/// blades widen by the inverse, so the hill's cover stays the same.
const DENSITY_FAR: f32 = 0.25;
const DENSITY_START: f32 = 10.0;
const DENSITY_END: f32 = 25.59;

/// A value from 0 up to 1 from a tuft's root place, the same on every device.
fn tuft_hash(place: vec3f) -> f32 {
    let x = bitcast<u32>(i32(round(place.x * 8.0)));
    let z = bitcast<u32>(i32(round(place.z * 8.0)));
    return f32(pcg(x ^ pcg(z ^ 0x9e3779b9u))) / 4294967295.0;
}

/// The share of the tufts that draw at a root's place: all of them near the camera, and the far
/// share at the fade's end.
fn tuft_density(place: vec3f, eye: vec3f) -> f32 {
    return mix(1.0, DENSITY_FAR, smoothstep(DENSITY_START, DENSITY_END, length(place - eye)));
}

/// True when a tuft at `place` draws, from its hash against the share at its distance.
fn tuft_kept(place: vec3f, eye: vec3f) -> bool {
    return tuft_hash(place) < tuft_density(place, eye);
}
// </tuft-density>

/// The texel of the tuft data's `index`-th texel, with `columns` texels across.
fn tuft_texel(index: u32, columns: u32) -> vec2i {
    return vec2i(i32(index % columns), i32(index / columns));
}

/// True when the tile about `place` is in the camera's frustum: its near and far planes, and its
/// four sides through the camera's basis and its lens. `lens` holds the half angle's tangent, the
/// view's aspect, the near distance and the far distance.
fn tile_in_view(
    place: vec3f,
    eye: vec3f,
    right: vec3f,
    up: vec3f,
    forward: vec3f,
    lens: vec4f,
) -> bool {
    let middle = vec3f(
        floor(place.x / TILE) * TILE + TILE * 0.5,
        place.y,
        floor(place.z / TILE) * TILE + TILE * 0.5,
    );
    let relative = middle - eye;
    let depth = dot(relative, forward);
    if (depth + TILE_RADIUS < lens.z || depth - TILE_RADIUS > lens.w) {
        return false;
    }
    let across = abs(dot(relative, right)) - depth * lens.x * lens.y;
    let above = abs(dot(relative, up)) - depth * lens.x;
    return across <= TILE_RADIUS && above <= TILE_RADIUS;
}

@compute @workgroup_size(128)
fn main(@builtin(local_invocation_index) lane: u32) {
    // The pass's values: the camera's place and the flag that turns the cull on, the camera's
    // right, up and forward with its lens, then the tufts that the preset draws, the draw
    // material's id and the data texture's width in texels.
    let eye = block.u0.xyz;
    let culling = block.u0.w > 0.5;
    let right = block.u1.xyz;
    let up = block.u2.xyz;
    let forward = block.u3.xyz;
    // The camera's half angle's tangent, the view's aspect, and its near and far distances.
    let lens = vec4f(block.u1.w, block.u2.w, block.u3.w, block.u4.w);
    let capacity = u32(block.u4.x);
    let material = u32(block.u4.y);
    let columns = u32(block.u4.z);
    if (lane == 0u) {
        atomicStore(&counts, 0u);
    }
    workgroupBarrier();
    for (var k = lane; k < capacity; k += WORKGROUP) {
        // The first texel holds the place rounded to whole meters and the turn; the second holds
        // the rest of the place, which keeps a half float under a millimetre, and the size.
        let coarse = textureLoad(tufts, tuft_texel(k * 2u, columns), 0, 0);
        let fine = textureLoad(tufts, tuft_texel(k * 2u + 1u, columns), 0, 0);
        let x = coarse.x + fine.x;
        let y = coarse.y + fine.y;
        let z = coarse.z + fine.z;
        let root = vec3f(x, y, z);
        if (culling) {
            // A far tuft draws only its share, and a tile outside the camera's view draws nothing.
            if (!tuft_kept(root, eye) || !tile_in_view(root, eye, right, up, forward, lens)) {
                continue;
            }
        }
        let turn = coarse.w;
        let size = fine.w;
        let c = cos(turn);
        let s = sin(turn);
        // A slot that only this lane can take, so the list is one row for each drawn tuft.
        let at = atomicAdd(&counts, 1u) * ROW_VECTORS;
        // The engine's instance row: the world matrix's three rows, with the tuft's turn and size,
        // then the ids. The first id is the material that the vertex shader reads.
        instances[at] = vec4f(c * size, 0.0, s * size, x);
        instances[at + 1u] = vec4f(0.0, size, 0.0, y);
        instances[at + 2u] = vec4f(-s * size, 0.0, c * size, z);
        instances[at + 3u] = vec4f(bitcast<f32>(material), 0.0, 0.0, 0.0);
    }
}

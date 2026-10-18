#define_import_path null3d::motion
#import null3d::mesh::{Instance}
#import null3d::vertex::{Transform}
#ifdef WEBGL2
#import null3d::mesh::{resident_rows, streamed_rows}
#ifdef MORPH
#import null3d::mesh::{morph_texel}
#endif
#endif

// What the motion pass's shaders share (decision record D-140): the motion block, the last frame's
// place of each instance, of each skinned vertex and of each morphed vertex, and the motion that a
// fragment writes.
//
// The motion target holds each surface's own motion beyond what the camera's move explains: where
// this frame's point would have shown in the last frame had it stayed still, less where the
// surface's point of the last frame did show. Both come from the last frame's view-projection
// matrix, so the camera's part cancels. A still surface writes 0, which the target clears to, so
// only moving objects draw. A reader adds the camera's part of any pixel from its depth.
//
// The motion counts in texture coordinates of the image, across the render size: x to the right
// and y down, as effects count them, on both GPU paths.
//
// On WebGPU the culling shader writes the last frame's matrix rows into each instance's copy after
// its ids, moved by the cell's offset as this frame's are: the vertex shader reads them at
// locations 13 to 15. On WebGL2 the motion view's frame group holds the last frame's data
// textures of matrix rows, laid out as this frame's, and the vertex shader reads the instance's
// row from the one that its draw names.

/// The motion pass's values of the frame: the last frame's view-projection matrix for positions
/// relative to this frame's camera, then the last frame's clock in the shape that the frame
/// block's clock has: its time, its step and its number's bits. On WebGL2 it ends with the texel
/// row of the last frame's morph weights in the texture of its joints.
struct MotionBlock {
    last_view_proj: mat4x4f,
    last_clock: vec4f,
    last_weights_row: u32,
}

@group(0) @binding(4) var<uniform> motion_block: MotionBlock;

#ifdef WEBGL2
/// The last frame's skinning matrices, laid out as the joint texture's, then from the block's row
/// on its morph weights, laid out as the weights texture's. One texture holds both, as the vertex
/// stage of a skinned and morphed draw has no texture unit to spare for a second.
@group(0) @binding(5) var last_joint_matrices: texture_2d<f32>;
#else ifdef SKIN
/// The last frame's skinning matrices, laid out as the joint texture's.
@group(0) @binding(5) var last_joint_matrices: texture_2d<f32>;
#endif

#ifdef WEBGL2
/// The last frame's matrix rows of the resident data texture and of the streamed one.
@group(0) @binding(7) var last_resident_rows: texture_2d<f32>;
@group(0) @binding(9) var last_streamed_rows: texture_2d<f32>;
#endif

/// The width of a grid cell in meters.
const CELL_SIZE: f32 = 1024.0;

#ifndef WEBGL2
/// The last frame's world matrix rows of an instance, moved by its cell's offset from the camera.
struct LastIn {
    @location(13) row_x: vec4f,
    @location(14) row_y: vec4f,
    @location(15) row_z: vec4f,
}

/// The last frame's world matrix of the instance `found`, relative to this frame's camera.
fn last_transform(found: Instance, last: LastIn) -> Transform {
    return Transform(last.row_x, last.row_y, last.row_z);
}
#else
/// The texel of row `k` of a matrix at source row `row`, in the data textures of matrix rows.
fn matrix_texel(row: u32, k: u32) -> vec2u {
    let matrix_row = (1u << 9u) - 1u;
    return vec2u((row & matrix_row) * 3u + k, row >> 9u);
}

/// Row `k` of the last frame's matrix of the instance `found`, moved as `now` was: by its cell's
/// offset, the difference between this frame's row as `found` holds it and as the data texture
/// does, and by the whole cells that bring it nearest to this frame's row, for an instance that
/// changed cells.
fn last_row(found: Instance, k: u32, now: vec4f) -> vec4f {
    let texel = matrix_texel(found.source, k);
    var stored: vec4f;
    var last: vec4f;
    if found.streamed {
        stored = textureLoad(streamed_rows, texel, 0);
        last = textureLoad(last_streamed_rows, texel, 0);
    } else {
        stored = textureLoad(resident_rows, texel, 0);
        last = textureLoad(last_resident_rows, texel, 0);
    }
    last.w += now.w - stored.w + CELL_SIZE * round((stored.w - last.w) / CELL_SIZE);
    return last;
}

/// The last frame's world matrix of the instance `found`, relative to this frame's camera.
fn last_transform(found: Instance) -> Transform {
    return Transform(
        last_row(found, 0u, found.row_x),
        last_row(found, 1u, found.row_y),
        last_row(found, 2u, found.row_z),
    );
}
#endif

#ifdef SKIN
/// Joints per row of the joint texture.
const JOINTS_PER_ROW: u32 = 512u;

/// A vertex's skinning matrix in the last frame, from the last frame's joint texture, as
/// `null3d::mesh::skin_of` gives this frame's: the rows that give x, y and z.
fn last_skin_point(found: Instance, joints: vec4u, weights: vec4f, p: vec3f) -> vec3f {
    var row_x = vec4f(0.0);
    var row_y = vec4f(0.0);
    var row_z = vec4f(0.0);
    for (var k = 0u; k < 4u; k++) {
        let w = weights[k];
        if w == 0.0 {
            continue;
        }
        let joint = found.first_joint + joints[k];
        let x = (joint % JOINTS_PER_ROW) * 3u;
        let y = joint / JOINTS_PER_ROW;
        row_x += w * textureLoad(last_joint_matrices, vec2u(x, y), 0);
        row_y += w * textureLoad(last_joint_matrices, vec2u(x + 1u, y), 0);
        row_z += w * textureLoad(last_joint_matrices, vec2u(x + 2u, y), 0);
    }
    let h = vec4f(p, 1.0);
    return vec3f(dot(row_x, h), dot(row_y, h), dot(row_z, h));
}
#endif

#ifdef WEBGL2
#ifdef MORPH
/// Texels per row of the morph textures.
const MORPH_TEXELS_PER_ROW: u32 = 2048u;

/// A vertex's position moved by its morph targets with the last frame's weights, as
/// `null3d::mesh::morph_vertex` moves it with this frame's: `range` is the vertex's morph
/// attribute, and `position` its place at rest.
fn last_morphed_position(found: Instance, range: vec2f, position: vec3f) -> vec3f {
    var out = position;
    let first = u32(range.x);
    let word = u32(range.y);
    let stride = 1u + (word & 1u) + ((word >> 1u) & 1u) + ((word >> 2u) & 1u);
    let count = word >> 3u;
    for (var k = 0u; k < count; k++) {
        let entry = morph_texel(first + k * stride);
        let t = u32(entry.w);
        let texel = found.morph_weights + t / 4u;
        let row = motion_block.last_weights_row + texel / MORPH_TEXELS_PER_ROW;
        let at = vec2u(texel % MORPH_TEXELS_PER_ROW, row);
        out += textureLoad(last_joint_matrices, at, 0)[t % 4u] * entry.xyz;
    }
    return out;
}
#endif
#endif

/// The place on the image of a clip-space position, in texture coordinates from the top left. The
/// position must lie in front of the camera's plane.
fn image_place(clip: vec4f) -> vec2f {
    let ndc = clip.xy / clip.w;
    return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

/// What a fragment writes: the motion from `last`, where the surface's point showed in the last
/// frame, to `still`, where this frame's point would have shown in it, both as the last frame's
/// clip-space positions. A point at or behind the last camera's plane gives no motion.
fn surface_motion(still: vec4f, last: vec4f) -> vec4f {
    if still.w <= 1e-6 || last.w <= 1e-6 {
        return vec4f(0.0);
    }
    return vec4f(image_place(still) - image_place(last), 0.0, 0.0);
}

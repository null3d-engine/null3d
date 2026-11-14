//! The terrain add-on's per-frame work: the height field's quadtree selection and the build of a
//! block's vertices, as a WebAssembly module that the add-on runs on the engine's job workers
//! ([D-279](../../.dev/decisions/D-279-terrain-rust-home.md)).
//!
//! The module imports nothing and keeps no state between calls. The caller hands in every array
//! and every buffer, so a call allocates nothing: the add-on's task copies its arrays into this
//! module's memory, calls an export, and copies the result out. Each value is read and written as
//! the add-on's TypeScript reference reads and writes it, in 64-bit floats throughout, so a call
//! gives the same bytes that the reference gives.
//!
//! The exports read a parameter block of 64-bit floats, so the caller writes it with one typed
//! view and passes its address:
//!
//! - `terrain_select(params)` walks the quadtree for a camera and writes the leaves it picks into
//!   one array of 32-bit integers, three for each leaf: level, column and row. Params: the ground's
//!   size, the screen error's scale, the eye's x, y and z, the finest level, the faces along a
//!   block's side, the deepest level whose height boxes the caller keeps, the capacity, and the
//!   address of the low boxes, the high boxes and the output array. It returns the leaves it wrote,
//!   or one more than the capacity when the capacity was too small.
//! - `terrain_build(params)` writes the vertices, the normals, the parent heights and the vertex
//!   records of `count` blocks. Params: the ground's size, the faces along a block's side, the
//!   vertices of a block, the samples along a side of the height field, the skirt's depth (-1 for
//!   four of a block's cells), the deepest level whose height boxes the caller keeps, the block
//!   count, the address of the height samples, the low boxes, the high boxes, the ring of vertices
//!   that a block's skirt copies, the blocks' leaves, and the four output arrays.
// The WebAssembly build keeps no standard library, so the module is small and has no allocator.
// A build for another machine links the standard library, as cargo check, clippy and the tests do.
#![cfg_attr(all(target_arch = "wasm32", not(test)), no_std)]

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // A call reaches this only by reading a parameter block that the caller wrote wrong. A trap
    // fails the task, which the add-on reports; the module keeps no state to repair.
    core::arch::wasm32::unreachable()
}

/// The most levels a terrain may take, which keeps every index inside a 32-bit integer.
const MAX_LEVELS: u32 = 15;

/// The deepest level whose height boxes a caller may keep, as the add-on keeps them.
const MAX_BOUND_LEVEL: u32 = 8;

/// The number of leaves a level holds along each side: `2 ** level`.
#[inline]
fn leaves_per_side(level: u32) -> u32 {
    1u32 << level
}

/// The place of a level's first height box in the packed arrays: every level above it holds
/// `(4 ** level - 1) / 3` boxes.
#[inline]
fn level_base(level: u32) -> usize {
    (((1u32 << (2 * level)) - 1) / 3) as usize
}

/// The array that holds a block's height box: its own level, or its ancestor's.
#[inline]
fn bounds_level(level: u32, bound_level: u32) -> u32 {
    if level < bound_level {
        level
    } else {
        bound_level
    }
}

/// The place of a block's height box in its level's array.
#[inline]
fn bounds_index(arrays: u32, level: u32, column: u32, row: u32) -> usize {
    let shift = level - arrays;
    ((column >> shift) * leaves_per_side(arrays) + (row >> shift)) as usize
}

/// The place of a block's height box in the packed arrays of every level.
#[inline]
fn bounds_at(level: u32, column: u32, row: u32, bound_level: u32) -> usize {
    let arrays = bounds_level(level, bound_level);
    level_base(arrays) + bounds_index(arrays, level, column, row)
}

/// Reads the parameter at `index` from the block that `params` points at.
///
/// # Safety
/// `params` points at a block that holds at least `index + 1` 64-bit floats.
#[inline]
unsafe fn param(params: *const f64, index: usize) -> f64 {
    unsafe { *params.add(index) }
}

/// Reads the parameter at `index` as an address or a whole number.
///
/// # Safety
/// `params` points at a block that holds at least `index + 1` 64-bit floats.
#[inline]
unsafe fn param_usize(params: *const f64, index: usize) -> usize {
    (unsafe { param(params, index) }) as usize
}

/// `value`, kept between `low` and `high`.
#[inline]
fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if value < low {
        low
    } else if value > high {
        high
    } else {
        value
    }
}

/// The height of the ground at a point, with bilinear interpolation between the samples: the same
/// read that the add-on's TypeScript reference makes.
///
/// # Safety
/// `heights` points at `resolution * resolution` 32-bit floats.
unsafe fn height_at(
    heights: *const f32,
    resolution: usize,
    step: f64,
    corner: f64,
    x: f64,
    z: f64,
) -> f64 {
    let fx = (x - corner) / step;
    let fz = (z - corner) / step;
    let last = (resolution - 2) as f64;
    let cx = clamp(libm::floor(fx), 0.0, last) as usize;
    let cz = clamp(libm::floor(fz), 0.0, last) as usize;
    let tx = clamp(fx - cx as f64, 0.0, 1.0);
    let tz = clamp(fz - cz as f64, 0.0, 1.0);
    let sample = |col: usize, row: usize| unsafe { *heights.add(row * resolution + col) as f64 };
    let a = sample(cx, cz);
    let b = sample(cx + 1, cz);
    let c = sample(cx, cz + 1);
    let d = sample(cx + 1, cz + 1);
    let top = a + (b - a) * tx;
    let bottom = c + (d - c) * tx;
    top + (bottom - top) * tz
}

/// The leaves that a selection writes, and whether they fitted. Each leaf is three whole numbers
/// in a row: its level, its column and its row.
struct Leaves {
    out: *mut i32,
    capacity: usize,
    written: usize,
    overflowed: bool,
}

impl Leaves {
    /// Writes one leaf, or notes that the capacity was too small.
    #[inline]
    fn push(&mut self, level: u32, column: u32, row: u32) {
        if self.written == self.capacity {
            self.overflowed = true;
            return;
        }
        let at = self.written * 3;
        unsafe {
            *self.out.add(at) = level as i32;
            *self.out.add(at + 1) = column as i32;
            *self.out.add(at + 2) = row as i32;
        }
        self.written += 1;
    }
}

/// The camera and the height boxes that one selection reads.
struct Selection {
    eye_x: f64,
    eye_y: f64,
    eye_z: f64,
    max_level: u32,
    quads: u32,
    bound_level: u32,
    lows: *const f32,
    highs: *const f32,
    scale: f64,
}

impl Selection {
    /// The lowest height of the block at `level`, `column` and `row`.
    #[inline]
    fn low(&self, level: u32, column: u32, row: u32) -> f64 {
        (unsafe {
            *self
                .lows
                .add(bounds_at(level, column, row, self.bound_level))
        }) as f64
    }

    /// The highest height of the block at `level`, `column` and `row`.
    #[inline]
    fn high(&self, level: u32, column: u32, row: u32) -> f64 {
        (unsafe {
            *self
                .highs
                .add(bounds_at(level, column, row, self.bound_level))
        }) as f64
    }

    /// Visits the block at `level`, `column` and `row`, and splits it into four while one of its
    /// cells would show more screen error than the caller allows and the ground is close enough.
    #[allow(clippy::too_many_arguments)]
    fn visit(
        &self,
        level: u32,
        column: u32,
        row: u32,
        block: f64,
        center_x: f64,
        center_z: f64,
        leaves: &mut Leaves,
    ) {
        if leaves.overflowed {
            return;
        }
        let half = block / 2.0;
        let low = self.low(level, column, row);
        let high = self.high(level, column, row);
        let dx = (self.eye_x - center_x).abs() - half;
        let dx = if dx > 0.0 { dx } else { 0.0 };
        let dz = (self.eye_z - center_z).abs() - half;
        let dz = if dz > 0.0 { dz } else { 0.0 };
        let dy = if self.eye_y < low {
            low - self.eye_y
        } else if self.eye_y > high {
            self.eye_y - high
        } else {
            0.0
        };
        let distance = libm::sqrt(dx * dx + dy * dy + dz * dz);
        // The block's own cell is the finest ground it can show, so its screen error falls with it.
        let limit = (block / self.quads as f64) * self.scale;
        if level < self.max_level && distance < limit {
            let next = level + 1;
            let child = block / 2.0;
            let quarter = block / 4.0;
            self.visit(
                next,
                column * 2,
                row * 2,
                child,
                center_x - quarter,
                center_z - quarter,
                leaves,
            );
            self.visit(
                next,
                column * 2 + 1,
                row * 2,
                child,
                center_x + quarter,
                center_z - quarter,
                leaves,
            );
            self.visit(
                next,
                column * 2,
                row * 2 + 1,
                child,
                center_x - quarter,
                center_z + quarter,
                leaves,
            );
            self.visit(
                next,
                column * 2 + 1,
                row * 2 + 1,
                child,
                center_x + quarter,
                center_z + quarter,
                leaves,
            );
        } else {
            leaves.push(level, column, row);
        }
    }
}

/// Picks the leaves to draw for a camera, and writes them into the caller's array.
///
/// # Safety
/// `params` points at the 12 64-bit floats that the module's documentation describes, and every
/// address in it points at a buffer long enough for what the call writes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn terrain_select(params: *const f64) -> u32 {
    let size = unsafe { param(params, 0) };
    let selection = Selection {
        scale: unsafe { param(params, 1) },
        eye_x: unsafe { param(params, 2) },
        eye_y: unsafe { param(params, 3) },
        eye_z: unsafe { param(params, 4) },
        max_level: (unsafe { param(params, 5) } as u32).min(MAX_LEVELS),
        quads: unsafe { param(params, 6) } as u32,
        bound_level: (unsafe { param(params, 7) } as u32).min(MAX_BOUND_LEVEL),
        lows: unsafe { param_usize(params, 9) } as *const f32,
        highs: unsafe { param_usize(params, 10) } as *const f32,
    };
    let capacity = unsafe { param_usize(params, 8) };
    let mut leaves = Leaves {
        out: unsafe { param_usize(params, 11) } as *mut i32,
        capacity,
        written: 0,
        overflowed: false,
    };
    selection.visit(0, 0, 0, size, 0.0, 0.0, &mut leaves);
    if leaves.overflowed {
        (capacity + 1) as u32
    } else {
        leaves.written as u32
    }
}

/// The height field, the block shape and the output arrays that one build reads and writes.
struct Build {
    size: f64,
    quads: u32,
    vertices: usize,
    resolution: usize,
    fixed_skirt: f64,
    bound_level: u32,
    heights: *const f32,
    lows: *const f32,
    highs: *const f32,
    ring: *const u32,
    positions: *mut f32,
    normals: *mut f32,
    parents: *mut f32,
    record: *mut f32,
}

impl Build {
    /// The grid's vertices of one block, before the skirt's ring.
    #[inline]
    fn grid(&self) -> usize {
        ((self.quads + 1) * (self.quads + 1)) as usize
    }

    /// The lowest height of the block at `level`, `column` and `row`, as the selection reads it.
    #[inline]
    fn low(&self, level: u32, column: u32, row: u32) -> f64 {
        (unsafe {
            *self
                .lows
                .add(bounds_at(level, column, row, self.bound_level))
        }) as f64
    }

    /// The highest height of the block at `level`, `column` and `row`.
    #[inline]
    fn high(&self, level: u32, column: u32, row: u32) -> f64 {
        (unsafe {
            *self
                .highs
                .add(bounds_at(level, column, row, self.bound_level))
        }) as f64
    }

    /// Writes one block: its positions and normals, its parent's surface at each vertex, and its
    /// four-number vertex record, at the place that `block` names in each output array.
    fn block(&self, block: usize, level: u32, column: u32, row: u32) {
        let block_size = self.size / leaves_per_side(level) as f64;
        let origin_x = -self.size / 2.0 + column as f64 * block_size;
        let origin_z = -self.size / 2.0 + row as f64 * block_size;
        let skirt = if self.fixed_skirt >= 0.0 {
            self.fixed_skirt
        } else {
            (block_size / self.quads as f64) * 4.0
        };
        let grid = self.grid();
        let vertices = self.vertices;
        let positions = unsafe { self.positions.add(block * vertices * 3) };
        let normals = unsafe { self.normals.add(block * vertices * 3) };
        let parents = unsafe { self.parents.add(block * vertices) };
        let record = unsafe { self.record.add(block * vertices * 4) };
        let step = self.size / (self.resolution - 1) as f64;
        let corner = -self.size / 2.0;
        // The parent is the quadrant of the level above that holds this block, or the block itself
        // at the coarsest level.
        let parent_level = if level > 0 { level - 1 } else { 0 };
        let parent_column = if level > 0 { column >> 1 } else { 0 };
        let parent_row = if level > 0 { row >> 1 } else { 0 };
        let parent_size = self.size / leaves_per_side(parent_level) as f64;
        let parent_x = -self.size / 2.0 + parent_column as f64 * parent_size;
        let parent_z = -self.size / 2.0 + parent_row as f64 * parent_size;
        let low = self.low(level, column, row);
        let high = self.high(level, column, row);
        let quads = self.quads as usize;
        let cell = block_size / self.quads as f64;
        let parent_cell = parent_size / self.quads as f64;
        let offset_x = origin_x - parent_x;
        let offset_z = origin_z - parent_z;
        // One sample each way across and along, around the vertex, as the reference reads them:
        // the vertex itself, then +x, -x, +z and -z.
        const OFFSETS: [[f64; 2]; 5] =
            [[0.0, 0.0], [1.0, 0.0], [-1.0, 0.0], [0.0, 1.0], [0.0, -1.0]];
        let last_sample = (self.resolution - 2) as f64;
        let mut at = 0usize;
        for row_i in 0..=quads {
            for col_i in 0..=quads {
                let x = col_i as f64 * cell;
                let z = row_i as f64 * cell;
                let fx = (origin_x + x - corner) / step;
                let fz = (origin_z + z - corner) / step;
                let mut around = [0.0f64; 5];
                for (k, offset) in OFFSETS.iter().enumerate() {
                    let gx = fx + offset[0];
                    let gz = fz + offset[1];
                    let cx = clamp(libm::floor(gx), 0.0, last_sample) as usize;
                    let cz = clamp(libm::floor(gz), 0.0, last_sample) as usize;
                    let tx = clamp(gx - cx as f64, 0.0, 1.0);
                    let tz = clamp(gz - cz as f64, 0.0, 1.0);
                    let a = unsafe { *self.heights.add(cz * self.resolution + cx) as f64 };
                    let b = unsafe { *self.heights.add(cz * self.resolution + cx + 1) as f64 };
                    let c = unsafe { *self.heights.add((cz + 1) * self.resolution + cx) as f64 };
                    let d =
                        unsafe { *self.heights.add((cz + 1) * self.resolution + cx + 1) as f64 };
                    let top = a + (b - a) * tx;
                    let bottom = c + (d - c) * tx;
                    around[k] = top + (bottom - top) * tz;
                }
                unsafe {
                    *positions.add(at) = x as f32;
                    *positions.add(at + 1) = around[0] as f32;
                    *positions.add(at + 2) = z as f32;
                }
                let dx = (around[1] - around[2]) / (2.0 * step);
                let dz = (around[3] - around[4]) / (2.0 * step);
                let length = libm::sqrt(dx * dx + 1.0 + dz * dz);
                unsafe {
                    *normals.add(at) = (-dx / length) as f32;
                    *normals.add(at + 1) = (1.0 / length) as f32;
                    *normals.add(at + 2) = (-dz / length) as f32;
                }
                at += 3;
            }
        }
        // The skirt: a copy of each ring vertex, dropped by the skirt's depth.
        let ring_len = quads * 4;
        for k in 0..ring_len {
            let source = unsafe { *self.ring.add(k) } as usize;
            let target = grid + k;
            unsafe {
                *positions.add(target * 3) = *positions.add(source * 3);
                *positions.add(target * 3 + 1) =
                    (*positions.add(source * 3 + 1) as f64 - skirt) as f32;
                *positions.add(target * 3 + 2) = *positions.add(source * 3 + 2);
                *normals.add(target * 3) = *normals.add(source * 3);
                *normals.add(target * 3 + 1) = *normals.add(source * 3 + 1);
                *normals.add(target * 3 + 2) = *normals.add(source * 3 + 2);
            }
        }
        // The parent's surface at each vertex, then the same for the skirt, below its ring vertex.
        let parent_last = (quads - 1) as f64;
        let mut p = 0usize;
        for row_i in 0..=quads {
            for col_i in 0..=quads {
                let px = col_i as f64 * cell + offset_x;
                let pz = row_i as f64 * cell + offset_z;
                let gx = px / parent_cell;
                let gz = pz / parent_cell;
                let cx = clamp(libm::floor(gx), 0.0, parent_last);
                let cz = clamp(libm::floor(gz), 0.0, parent_last);
                let tx = clamp(gx - cx, 0.0, 1.0);
                let tz = clamp(gz - cz, 0.0, 1.0);
                let x0 = parent_x + cx * parent_cell;
                let x1 = x0 + parent_cell;
                let z0 = parent_z + cz * parent_cell;
                let z1 = z0 + parent_cell;
                let h00 = unsafe { height_at(self.heights, self.resolution, step, corner, x0, z0) };
                let h10 = unsafe { height_at(self.heights, self.resolution, step, corner, x1, z0) };
                let h01 = unsafe { height_at(self.heights, self.resolution, step, corner, x0, z1) };
                let h11 = unsafe { height_at(self.heights, self.resolution, step, corner, x1, z1) };
                // The parent's faces split each cell from its low corner to its high one, as the
                // block's own grid does, so a point on either side of that diagonal takes that
                // triangle's plane.
                let value = if tx + tz <= 1.0 {
                    h00 + (h10 - h00) * tx + (h01 - h00) * tz
                } else {
                    h11 + (h01 - h11) * (1.0 - tx) + (h10 - h11) * (1.0 - tz)
                };
                unsafe {
                    *parents.add(p) = value as f32;
                }
                p += 1;
            }
        }
        for k in 0..ring_len {
            let source = unsafe { *self.ring.add(k) } as usize;
            unsafe {
                *parents.add(grid + k) = (*parents.add(source) as f64 - skirt) as f32;
            }
        }
        for v in 0..vertices {
            let parent_height = unsafe { *parents.add(v) };
            let at = v * 4;
            unsafe {
                *record.add(at) = parent_height;
                *record.add(at + 1) = block_size as f32;
                *record.add(at + 2) = low as f32;
                *record.add(at + 3) = high as f32;
            }
        }
    }
}

/// Writes the vertices, the normals, the parent heights and the vertex records of `count` blocks.
///
/// # Safety
/// `params` points at the 16 64-bit floats that the module's documentation describes, and every
/// address in it points at a buffer long enough for what the call writes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn terrain_build(params: *const f64) -> u32 {
    let build = Build {
        size: unsafe { param(params, 0) },
        quads: unsafe { param(params, 1) } as u32,
        vertices: unsafe { param_usize(params, 2) },
        resolution: unsafe { param_usize(params, 3) },
        fixed_skirt: unsafe { param(params, 4) },
        bound_level: (unsafe { param(params, 5) } as u32).min(MAX_BOUND_LEVEL),
        heights: unsafe { param_usize(params, 7) } as *const f32,
        lows: unsafe { param_usize(params, 8) } as *const f32,
        highs: unsafe { param_usize(params, 9) } as *const f32,
        ring: unsafe { param_usize(params, 10) } as *const u32,
        positions: unsafe { param_usize(params, 12) } as *mut f32,
        normals: unsafe { param_usize(params, 13) } as *mut f32,
        parents: unsafe { param_usize(params, 14) } as *mut f32,
        record: unsafe { param_usize(params, 15) } as *mut f32,
    };
    let count = unsafe { param_usize(params, 6) };
    let leaves = unsafe { param_usize(params, 11) } as *const i32;
    for block in 0..count {
        let level = unsafe { *leaves.add(block * 3) } as u32;
        let column = unsafe { *leaves.add(block * 3 + 1) } as u32;
        let row = unsafe { *leaves.add(block * 3 + 2) } as u32;
        build.block(block, level, column, row);
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A parameter block, which each test fills before a call.
    fn params() -> Vec<f64> {
        vec![0.0; 16]
    }

    /// A height field of `resolution` samples along each side, sampled from `height`.
    fn field(resolution: usize, size: f64, height: impl Fn(f64, f64) -> f64) -> Vec<f32> {
        let corner = -size / 2.0;
        let step = size / (resolution - 1) as f64;
        let mut heights = Vec::with_capacity(resolution * resolution);
        for row in 0..resolution {
            for col in 0..resolution {
                heights.push(height(corner + col as f64 * step, corner + row as f64 * step) as f32);
            }
        }
        heights
    }

    /// The packed low and high boxes of a height field, as the add-on builds them.
    fn bounds(
        heights: &[f32],
        resolution: usize,
        size: f64,
        bound_level: u32,
    ) -> (Vec<f32>, Vec<f32>) {
        let deepest_side = leaves_per_side(bound_level) as usize;
        let span = size / deepest_side as f64;
        let half = size / 2.0;
        let mut lows = vec![f32::INFINITY; deepest_side * deepest_side];
        let mut highs = vec![f32::NEG_INFINITY; deepest_side * deepest_side];
        for row in 0..resolution {
            let z = -half + (row as f64 / (resolution - 1) as f64) * size;
            let block_row = (((z + half) / span).floor() as usize).min(deepest_side - 1);
            for col in 0..resolution {
                let x = -half + (col as f64 / (resolution - 1) as f64) * size;
                let block_col = (((x + half) / span).floor() as usize).min(deepest_side - 1);
                let value = heights[row * resolution + col];
                let index = block_col * deepest_side + block_row;
                if value < lows[index] {
                    lows[index] = value;
                }
                if value > highs[index] {
                    highs[index] = value;
                }
            }
        }
        // Each coarser level takes the box of its four children, packed level by level.
        let mut packed_lows = vec![0.0f32; level_base(bound_level + 1)];
        let mut packed_highs = vec![0.0f32; level_base(bound_level + 1)];
        packed_lows[level_base(bound_level)..level_base(bound_level + 1)].copy_from_slice(&lows);
        packed_highs[level_base(bound_level)..level_base(bound_level + 1)].copy_from_slice(&highs);
        for level in (0..bound_level).rev() {
            let side = leaves_per_side(level) as usize;
            let child_side = side * 2;
            let base = level_base(level);
            let child_base = level_base(level + 1);
            for column in 0..side {
                for row in 0..side {
                    let index = column * side + row;
                    let mut lowest = f32::INFINITY;
                    let mut highest = f32::NEG_INFINITY;
                    for corner in 0..4 {
                        let child =
                            (column * 2 + (corner & 1)) * child_side + row * 2 + (corner >> 1);
                        if packed_lows[child_base + child] < lowest {
                            lowest = packed_lows[child_base + child];
                        }
                        if packed_highs[child_base + child] > highest {
                            highest = packed_highs[child_base + child];
                        }
                    }
                    packed_lows[base + index] = lowest;
                    packed_highs[base + index] = highest;
                }
            }
        }
        (packed_lows, packed_highs)
    }

    #[test]
    fn a_flat_field_builds_a_flat_block() {
        let resolution = 5;
        let size = 8.0;
        let heights = field(resolution, size, |_, _| 3.0);
        let (lows, highs) = bounds(&heights, resolution, size, 2);
        // A block of level 1 covers 4 meters, with two faces along each side and no skirt.
        let quads = 2u32;
        let vertices = ((quads + 1) * (quads + 1) + quads * 4) as usize;
        // The ring that the add-on's shape gives a block with two faces along each side.
        let ring: Vec<u32> = vec![0, 1, 2, 5, 8, 7, 6, 3];
        let leaves = [1i32, 1, 0];
        let mut positions = vec![0.0f32; vertices * 3];
        let mut normals = vec![0.0f32; vertices * 3];
        let mut parents = vec![0.0f32; vertices];
        let mut record = vec![0.0f32; vertices * 4];
        let mut p = params();
        p[0] = size;
        p[1] = quads as f64;
        p[2] = vertices as f64;
        p[3] = resolution as f64;
        p[4] = 0.0;
        p[5] = 2.0;
        p[6] = 1.0;
        p[7] = heights.as_ptr() as usize as f64;
        p[8] = lows.as_ptr() as usize as f64;
        p[9] = highs.as_ptr() as usize as f64;
        p[10] = ring.as_ptr() as usize as f64;
        p[11] = leaves.as_ptr() as usize as f64;
        p[12] = positions.as_mut_ptr() as usize as f64;
        p[13] = normals.as_mut_ptr() as usize as f64;
        p[14] = parents.as_mut_ptr() as usize as f64;
        p[15] = record.as_mut_ptr() as usize as f64;
        unsafe {
            assert_eq!(terrain_build(p.as_ptr()), 0);
        }
        // The grid's nine vertices lie in rows of three, two meters apart, on flat ground.
        for v in 0..9 {
            let column = v % 3;
            let row = v / 3;
            assert_eq!(positions[v * 3], column as f32 * 2.0);
            assert_eq!(positions[v * 3 + 1], 3.0);
            assert_eq!(positions[v * 3 + 2], row as f32 * 2.0);
            assert_eq!(normals[v * 3], 0.0);
            assert_eq!(normals[v * 3 + 1], 1.0);
            assert_eq!(normals[v * 3 + 2], 0.0);
        }
        for v in 0..vertices {
            assert_eq!(parents[v], 3.0);
            assert_eq!(record[v * 4], 3.0);
            assert_eq!(record[v * 4 + 1], 4.0);
            assert_eq!(record[v * 4 + 2], 3.0);
            assert_eq!(record[v * 4 + 3], 3.0);
        }
    }

    #[test]
    fn a_selection_tiles_the_ground_and_keeps_the_finest_level_under_a_zero_error() {
        let size = 64.0;
        let resolution = 17;
        let heights = field(resolution, size, |_, _| 0.0);
        let (lows, highs) = bounds(&heights, resolution, size, 4);
        let capacity = 4096usize;
        let mut leaves = vec![0i32; capacity * 3];
        let mut p = params();
        p[0] = size;
        p[1] = 1000.0;
        p[2] = 0.0;
        p[3] = 0.0;
        p[4] = 0.0;
        p[5] = 4.0;
        p[6] = 2.0;
        p[7] = 4.0;
        p[8] = capacity as f64;
        p[9] = lows.as_ptr() as usize as f64;
        p[10] = highs.as_ptr() as usize as f64;
        p[11] = leaves.as_mut_ptr() as usize as f64;
        let count = unsafe { terrain_select(p.as_ptr()) } as usize;
        assert_eq!(count, 4 * 4 * 4 * 4);
        let mut area = 0.0;
        for i in 0..count {
            let level = leaves[i * 3] as u32;
            area += (size / leaves_per_side(level) as f64).powi(2);
        }
        assert!((area - size * size).abs() < 1e-6);
    }

    #[test]
    fn each_leaf_key_is_unique() {
        let size = 64.0;
        let resolution = 33;
        let heights = field(resolution, size, |x, z| (x * 0.1).sin() + (z * 0.07).cos());
        let (lows, highs) = bounds(&heights, resolution, size, 5);
        let capacity = 8192usize;
        let mut leaves = vec![0i32; capacity * 3];
        let mut p = params();
        p[0] = size;
        p[1] = 400.0;
        p[2] = 10.0;
        p[3] = 20.0;
        p[4] = 5.0;
        p[5] = 5.0;
        p[6] = 2.0;
        p[7] = 5.0;
        p[8] = capacity as f64;
        p[9] = lows.as_ptr() as usize as f64;
        p[10] = highs.as_ptr() as usize as f64;
        p[11] = leaves.as_mut_ptr() as usize as f64;
        let count = unsafe { terrain_select(p.as_ptr()) } as usize;
        assert!(count > 1);
        let mut keys = std::collections::HashSet::new();
        for i in 0..count {
            let level = leaves[i * 3] as u32;
            let column = leaves[i * 3 + 1] as usize;
            let row = leaves[i * 3 + 2] as usize;
            keys.insert(level_base(level) + column * leaves_per_side(level) as usize + row);
        }
        assert_eq!(keys.len(), count);
    }

    #[test]
    fn a_high_camera_picks_coarser_blocks_under_it() {
        let size = 64.0;
        let resolution = 33;
        let heights = field(resolution, size, |x, z| {
            20.0 * (-(x * x + z * z) / (2.0 * 20.0 * 20.0)).exp()
        });
        let (lows, highs) = bounds(&heights, resolution, size, 5);
        let capacity = 8192usize;
        let mut leaves = vec![0i32; capacity * 3];
        let mut p = params();
        p[0] = size;
        // The scale that the add-on works out for this view: its buffer's height over the tangent of
        // half the field of view, over the error it allows.
        p[1] = 1080.0 / (2.0 * (52.0f64 * core::f64::consts::PI / 360.0).tan() * 32.0);
        p[2] = 0.0;
        p[5] = 5.0;
        p[6] = 16.0;
        p[7] = 5.0;
        p[8] = capacity as f64;
        p[9] = lows.as_ptr() as usize as f64;
        p[10] = highs.as_ptr() as usize as f64;
        p[11] = leaves.as_mut_ptr() as usize as f64;
        // The lowest level of the leaf over the ground's middle, for a camera at a height.
        let mut level_over_middle = |y: f64| {
            p[3] = y;
            let count = unsafe { terrain_select(p.as_ptr()) } as usize;
            let mut found = MAX_LEVELS;
            for i in 0..count {
                let level = leaves[i * 3] as u32;
                let column = leaves[i * 3 + 1] as f64;
                let row = leaves[i * 3 + 2] as f64;
                let block = size / leaves_per_side(level) as f64;
                let low_x = -size / 2.0 + column * block;
                let low_z = -size / 2.0 + row * block;
                if 0.0 >= low_x && 0.0 < low_x + block && 0.0 >= low_z && 0.0 < low_z + block {
                    found = found.min(level);
                }
            }
            found
        };
        let low = level_over_middle(0.0);
        let high = level_over_middle(400.0);
        assert!(high < low, "high {high} against low {low}");
    }

    #[test]
    fn a_selection_that_fills_its_arrays_says_the_capacity_was_too_small() {
        let size = 64.0;
        let resolution = 9;
        let heights = field(resolution, size, |_, _| 0.0);
        let (lows, highs) = bounds(&heights, resolution, size, 2);
        let capacity = 8usize;
        let mut leaves = vec![0i32; capacity * 3];
        let mut p = params();
        p[0] = size;
        p[1] = 1000.0;
        p[5] = 2.0;
        p[6] = 2.0;
        p[7] = 2.0;
        p[8] = capacity as f64;
        p[9] = lows.as_ptr() as usize as f64;
        p[10] = highs.as_ptr() as usize as f64;
        p[11] = leaves.as_mut_ptr() as usize as f64;
        let count = unsafe { terrain_select(p.as_ptr()) } as usize;
        assert_eq!(count, capacity + 1);
    }
}

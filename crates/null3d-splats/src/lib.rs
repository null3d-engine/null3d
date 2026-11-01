//! The splats add-on's per-frame selection: the chunk distances, their sort and the budget that
//! each chunk's prefix takes, as a WebAssembly module that the add-on runs on the engine's job
//! workers (hard rule 42).
//!
//! The module imports nothing and keeps no state between calls. The caller hands in every array,
//! so a call allocates nothing: the add-on's task copies the chunk table into this module's
//! memory, calls the export, and the counts land in the buffer that the sketch reads. Each value
//! is read and written as the add-on's TypeScript reference reads and writes it, in 64-bit floats
//! throughout, so a call gives the same counts that the reference gives.
//!
//! `splat_select(params)` reads a parameter block of 64-bit floats and writes one count for each
//! chunk:
//!
//! - params[0]: the number of chunks
//! - params[1]: the budget, the most splats that draw
//! - params[2], params[3] and params[4]: the camera's x, y and z
//! - params[5]: the radius of the bounds that hold the whole cloud
//! - params[6]: the address of the chunk table, 8 floats for each chunk: its centre, its radius
//!   and the counts of its four levels, finest first
//! - params[7]: the address of the output counts, one float for each chunk
//! - params[8]: the address of the distance scratch, one float for each chunk
//! - params[9]: the address of the level scratch, one byte for each chunk
//! - params[10]: the address of the order scratch, one 32-bit whole number for each chunk
//! - params[11]: the address of the sort scratch, one 32-bit whole number for each chunk
//!
//! It returns the total that draws.
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

/// The floats of one chunk in the table: its centre, its radius and the counts of its levels.
pub const STRIDE: usize = 8;

/// The number of detail levels of a chunk: every splat, then half, a quarter and an eighth.
pub const LEVELS: usize = 4;

/// The place of a chunk's first level count in its row of the table.
pub const LEVELS_AT: usize = 4;

/// Reads the parameter at `index`.
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

/// The level that a chunk draws at, from the distance to its nearest point and the cloud's size.
/// The distance is measured in the cloud's own radius, not the chunk's: a finer cut makes smaller
/// chunks, and measuring against them would let a smaller chunk pass for a farther one, so the
/// same view would draw fewer splats.
#[inline]
fn level_of(distance: f64, radius: f64, cloud_radius: f64) -> usize {
    let near = (distance - radius).max(0.0);
    let size = cloud_radius.max(1e-3);
    if near <= size * 2.0 {
        0
    } else if near <= size * 4.0 {
        1
    } else if near <= size * 8.0 {
        2
    } else {
        LEVELS - 1
    }
}

/// Sorts `order` by the distances at the same indices, nearest first, keeping equal distances in
/// the order they came. `scratch` holds one whole number for each entry.
fn sort_by_distance(distances: *const f32, order: *mut u32, scratch: *mut u32, count: usize) {
    if count < 2 {
        return;
    }
    let mut source = order;
    let mut target = scratch;
    let mut width = 1usize;
    while width < count {
        let mut start = 0usize;
        while start < count {
            let middle = (start + width).min(count);
            let end = (start + 2 * width).min(count);
            let mut left = start;
            let mut right = middle;
            let mut at = start;
            while left < middle && right < end {
                // A tie takes the left entry, which keeps the original order of equal distances.
                let take_left = unsafe { *distances.add(*source.add(left) as usize) }
                    <= unsafe { *distances.add(*source.add(right) as usize) };
                let index = if take_left {
                    let index = unsafe { *source.add(left) };
                    left += 1;
                    index
                } else {
                    let index = unsafe { *source.add(right) };
                    right += 1;
                    index
                };
                unsafe { *target.add(at) = index };
                at += 1;
            }
            while left < middle {
                unsafe { *target.add(at) = *source.add(left) };
                left += 1;
                at += 1;
            }
            while right < end {
                unsafe { *target.add(at) = *source.add(right) };
                right += 1;
                at += 1;
            }
            start = end;
        }
        core::mem::swap(&mut source, &mut target);
        width *= 2;
    }
    // An odd number of passes leaves the sorted list in the scratch; copy it back.
    if !core::ptr::eq(source, order) {
        unsafe { core::ptr::copy_nonoverlapping(source, order, count) };
    }
}

/// Chooses each chunk's count from the camera and the budget, and writes them into the caller's
/// array.
///
/// # Safety
/// `params` points at the 12 64-bit floats that the module's documentation describes, and every
/// address in it points at a buffer long enough for what the call writes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn splat_select(params: *const f64) -> u32 {
    let chunks = unsafe { param_usize(params, 0) };
    let budget = unsafe { param(params, 1) };
    let eye_x = unsafe { param(params, 2) };
    let eye_y = unsafe { param(params, 3) };
    let eye_z = unsafe { param(params, 4) };
    let cloud_radius = unsafe { param(params, 5) };
    let table = unsafe { param_usize(params, 6) } as *const f32;
    let counts = unsafe { param_usize(params, 7) } as *mut f32;
    let distances = unsafe { param_usize(params, 8) } as *mut f32;
    let levels = unsafe { param_usize(params, 9) } as *mut u8;
    let order = unsafe { param_usize(params, 10) } as *mut u32;
    let scratch = unsafe { param_usize(params, 11) } as *mut u32;
    for i in 0..chunks {
        let at = i * STRIDE;
        let x = unsafe { *table.add(at) } as f64;
        let y = unsafe { *table.add(at + 1) } as f64;
        let z = unsafe { *table.add(at + 2) } as f64;
        let radius = unsafe { *table.add(at + 3) } as f64;
        let dx = x - eye_x;
        let dy = y - eye_y;
        let dz = z - eye_z;
        let distance = libm::sqrt(dx * dx + dy * dy + dz * dz);
        let near = if distance > radius {
            distance - radius
        } else {
            0.0
        };
        unsafe { *distances.add(i) = near as f32 };
        unsafe { *levels.add(i) = level_of(distance, radius, cloud_radius) as u8 };
        unsafe { *order.add(i) = i as u32 };
    }
    sort_by_distance(distances, order, scratch, chunks);
    for i in 0..chunks {
        unsafe { *counts.add(i) = 0.0 };
    }
    let mut left = budget;
    let mut total = 0.0f64;
    // The base level: each chunk, nearest first, keeps its coarsest prefix while the budget lasts.
    // A budget too small for every level then thins the whole cloud rather than dropping its far
    // parts, and a stream still fetches only the chunks that the budget reaches.
    for k in 0..chunks {
        if left <= 0.0 {
            break;
        }
        let i = unsafe { *order.add(k) } as usize;
        let base = unsafe { *table.add(i * STRIDE + LEVELS_AT + LEVELS - 1) } as f64;
        let chosen = if base < left { base } else { left };
        unsafe { *counts.add(i) = chosen as f32 };
        left -= chosen;
        total += chosen;
    }
    // The rest of the budget refines the nearest chunks first, up to the level that each one's
    // distance asks for, so a near chunk is denser than a far one of the same size.
    for k in 0..chunks {
        if left <= 0.0 {
            break;
        }
        let i = unsafe { *order.add(k) } as usize;
        let at = i * STRIDE;
        let level = unsafe { *levels.add(i) } as usize;
        let target = unsafe { *table.add(at + LEVELS_AT + level) } as f64;
        let chosen = unsafe { *counts.add(i) } as f64;
        if chosen >= target {
            continue;
        }
        let rest = target - chosen;
        let more = if rest < left { rest } else { left };
        unsafe { *counts.add(i) = (chosen + more) as f32 };
        left -= more;
        total += more;
    }
    total as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A parameter block that holds every address of one call.
    fn params() -> [f64; 12] {
        [0.0; 12]
    }

    /// A chunk table of three chunks of 100 splats: at the camera, 150 m away and 1 km away, each
    /// of radius 1, halving at each level.
    fn table() -> Vec<f32> {
        let centres = [[0.0f32, 0.0, 0.0], [150.0, 0.0, 0.0], [1000.0, 0.0, 0.0]];
        let mut table = vec![0.0f32; centres.len() * STRIDE];
        for (i, centre) in centres.iter().enumerate() {
            let at = i * STRIDE;
            table[at] = centre[0];
            table[at + 1] = centre[1];
            table[at + 2] = centre[2];
            table[at + 3] = 1.0;
            table[at + 4] = 100.0;
            table[at + 5] = 50.0;
            table[at + 6] = 25.0;
            table[at + 7] = 13.0;
        }
        table
    }

    /// Runs one selection and gives the counts and the total.
    fn select(table: &[f32], budget: f64, eye: [f64; 3], cloud_radius: f64) -> (Vec<f32>, u32) {
        let chunks = table.len() / STRIDE;
        let mut counts = vec![0.0f32; chunks];
        let mut distances = vec![0.0f32; chunks];
        let mut levels = vec![0u8; chunks];
        let mut order = vec![0u32; chunks];
        let mut scratch = vec![0u32; chunks];
        let mut p = params();
        p[0] = chunks as f64;
        p[1] = budget;
        p[2] = eye[0];
        p[3] = eye[1];
        p[4] = eye[2];
        p[5] = cloud_radius;
        p[6] = table.as_ptr() as usize as f64;
        p[7] = counts.as_mut_ptr() as usize as f64;
        p[8] = distances.as_mut_ptr() as usize as f64;
        p[9] = levels.as_mut_ptr() as usize as f64;
        p[10] = order.as_mut_ptr() as usize as f64;
        p[11] = scratch.as_mut_ptr() as usize as f64;
        let total = unsafe { splat_select(p.as_ptr()) };
        (counts, total)
    }

    #[test]
    fn each_chunk_keeps_the_level_that_its_distance_asks_for() {
        let (counts, total) = select(&table(), 1000.0, [0.0, 0.0, 0.0], 50.0);
        assert_eq!(counts, vec![100.0, 50.0, 13.0]);
        assert_eq!(total, 163);
    }

    #[test]
    fn distance_is_measured_in_the_cloud_rather_than_the_chunk() {
        let coarse = table();
        let mut fine = table();
        for i in 0..3 {
            fine[i * STRIDE + 3] = 0.25;
        }
        // A finer cut keeps the same levels, so both cuts draw the same counts.
        let (a, _) = select(&coarse, 1000.0, [0.0, 0.0, 0.0], 50.0);
        let (b, _) = select(&fine, 1000.0, [0.0, 0.0, 0.0], 50.0);
        assert_eq!(a, b);
    }

    #[test]
    fn every_chunk_keeps_its_coarsest_prefix_when_the_budget_covers_it() {
        let (counts, total) = select(&table(), 39.0, [0.0, 0.0, 0.0], 50.0);
        assert_eq!(counts, vec![13.0, 13.0, 13.0]);
        assert_eq!(total, 39);
    }

    #[test]
    fn the_rest_of_the_budget_refines_the_nearest_chunks_first() {
        let (counts, total) = select(&table(), 150.0, [0.0, 0.0, 0.0], 50.0);
        assert_eq!(counts, vec![100.0, 37.0, 13.0]);
        assert_eq!(total, 150);
    }

    #[test]
    fn every_chunk_stays_in_the_view_when_the_budget_is_short() {
        let (counts, total) = select(&table(), 60.0, [0.0, 0.0, 0.0], 50.0);
        assert_eq!(counts, vec![34.0, 13.0, 13.0]);
        assert_eq!(total, 60);
    }

    #[test]
    fn the_camera_decides_which_chunk_is_nearest() {
        let (counts, _) = select(&table(), 1000.0, [150.0, 0.0, 0.0], 50.0);
        assert_eq!(counts, vec![50.0, 100.0, 13.0]);
    }

    #[test]
    fn equal_distances_keep_the_order_they_came_in() {
        // Two chunks at the same place: the first keeps the budget's refinement, as a stable sort
        // gives.
        let mut table = vec![0.0f32; 2 * STRIDE];
        for i in 0..2 {
            let at = i * STRIDE;
            table[at + 4] = 100.0;
            table[at + 5] = 50.0;
            table[at + 6] = 25.0;
            table[at + 7] = 13.0;
        }
        let (counts, _) = select(&table, 39.0, [0.0, 0.0, 0.0], 50.0);
        // The bases take 26. The first chunk then takes the rest, because equal distances keep
        // the order they came in.
        assert_eq!(counts, vec![26.0, 13.0]);
    }
}

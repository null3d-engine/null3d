//! Frustum culling of bounding spheres, four spheres per SIMD operation.
//!
//! Spheres come in four arrays (x, y, z, radius), so one `f32x4` load per array brings four
//! spheres into registers. `std::simd` compiles to WebAssembly `simd128` and to Arm NEON from the
//! same code. The SIMD test and the scalar reference use the same operations in the same order,
//! without fused multiply-adds, so they return identical results, even on plane boundaries.

use std::collections::TryReserveError;
use std::ops::Range;
use std::simd::prelude::*;

use crate::jobs::JobSystem;
use crate::shared::SharedMut;
use crate::world::SphereArrays;

/// Spheres per chunk when [`cull_parallel`] splits the work; a multiple of four.
pub const CULL_CHUNK: u32 = 4096;

/// For each 4-bit visibility mask, the byte shuffle that moves the visible 32-bit lanes to the
/// front, in order. Unused output bytes select index 128, which reads as zero.
const COMPACT: [[u8; 16]; 16] = {
    let mut table = [[128u8; 16]; 16];
    let mut mask = 0;
    while mask < 16 {
        let mut packed = 0;
        let mut lane = 0;
        while lane < 4 {
            if mask & (1 << lane) != 0 {
                let mut byte = 0;
                while byte < 4 {
                    table[mask][packed * 4 + byte] = (lane * 4 + byte) as u8;
                    byte += 1;
                }
                packed += 1;
            }
            lane += 1;
        }
        mask += 1;
    }
    table
};

/// Six normalized planes `(nx, ny, nz, d)`, each with its normal pointing into the frustum. A
/// sphere with centre `c` and radius `r` is inside a plane when `n · c + d >= -r`, and visible
/// when it is inside all six. The order is left, right, bottom, top, near and far.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frustum {
    planes: [[f32; 4]; 6],
}

impl Frustum {
    /// The frustum of a view-projection matrix in column-major order (element `[col * 4 + row]`),
    /// with WebGPU's clip space: x and y in [-w, w] and depth in [0, w]. This also covers reversed
    /// depth, which swaps the near and far planes. A plane that degenerates to a zero normal,
    /// such as the far plane of an infinite projection, becomes one that never culls.
    pub fn from_view_projection(m: &[f32; 16]) -> Frustum {
        let row = |i: usize| [m[i], m[4 + i], m[8 + i], m[12 + i]];
        let (r0, r1, r2, r3) = (row(0), row(1), row(2), row(3));
        let add = |a: [f32; 4], b: [f32; 4]| std::array::from_fn(|k| a[k] + b[k]);
        let sub = |a: [f32; 4], b: [f32; 4]| std::array::from_fn(|k| a[k] - b[k]);
        Frustum::from_planes([
            add(r3, r0),
            sub(r3, r0),
            add(r3, r1),
            sub(r3, r1),
            r2,
            sub(r3, r2),
        ])
    }

    /// A frustum from six planes `(nx, ny, nz, d)` with inward normals. Each plane is
    /// normalized.
    pub fn from_planes(planes: [[f32; 4]; 6]) -> Frustum {
        Frustum {
            planes: planes.map(normalize_plane),
        }
    }

    /// The six normalized planes.
    pub fn planes(&self) -> &[[f32; 4]; 6] {
        &self.planes
    }

    /// True when the sphere touches or crosses the inside of every plane. This is the scalar
    /// test; [`cull_spheres`] returns the same answers four at a time.
    #[inline(always)]
    pub fn contains_sphere(&self, x: f32, y: f32, z: f32, radius: f32) -> bool {
        let limit = -radius;
        self.planes
            .iter()
            .all(|p| x * p[0] + y * p[1] + z * p[2] + p[3] >= limit)
    }
}

/// Scales a plane to a unit normal, or returns a plane that keeps everything when the normal
/// has no length.
fn normalize_plane(p: [f32; 4]) -> [f32; 4] {
    let len = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
    if len > 0.0 && len.is_finite() {
        p.map(|v| v / len)
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

/// Checks the arguments shared by both culling functions and returns the range as `usize`.
fn check_range(xs: &[f32], ys: &[f32], zs: &[f32], rs: &[f32], range: &Range<u32>, out: &[u32]) {
    let end = range.end as usize;
    assert!(range.start <= range.end, "range {range:?} is reversed");
    assert!(
        end <= xs.len() && end <= ys.len() && end <= zs.len() && end <= rs.len(),
        "range {range:?} is past the sphere arrays"
    );
    assert!(
        out.len() >= range.len(),
        "the output holds {} indices, fewer than the {} spheres tested",
        out.len(),
        range.len()
    );
}

/// Writes the indices of the spheres in `range` that are inside the frustum to `out`, in
/// increasing order, and returns how many it wrote. Four spheres are tested per SIMD operation.
///
/// # Panics
/// When the range is past the arrays, or `out` is shorter than the range.
pub fn cull_spheres(
    frustum: &Frustum,
    xs: &[f32],
    ys: &[f32],
    zs: &[f32],
    rs: &[f32],
    range: Range<u32>,
    out: &mut [u32],
) -> usize {
    check_range(xs, ys, zs, rs, &range, out);
    let planes = frustum.planes.map(|p| p.map(f32x4::splat));
    let (start, end) = (range.start as usize, range.end as usize);
    let simd_end = start + (end - start) / 4 * 4;
    let lanes = u32x4::from_array([0, 1, 2, 3]);
    let mut n = 0;
    let mut i = start;
    while i < simd_end {
        let x = f32x4::from_slice(&xs[i..i + 4]);
        let y = f32x4::from_slice(&ys[i..i + 4]);
        let z = f32x4::from_slice(&zs[i..i + 4]);
        let limit = -f32x4::from_slice(&rs[i..i + 4]);
        let mut inside = mask32x4::splat(true);
        for p in &planes {
            inside &= (x * p[0] + y * p[1] + z * p[2] + p[3]).simd_ge(limit);
        }
        let bits = inside.to_bitmask() as usize;
        // Shuffle the visible indices to the front and store all four lanes; only the visible
        // ones count. `n` is at most `i - start`, so the store stays inside `out`, which holds a
        // slot per sphere.
        let indices = (u32x4::splat(i as u32) + lanes).to_ne_bytes();
        let packed = shuffle_bytes(indices, u8x16::from_array(COMPACT[bits]));
        u32x4::from_ne_bytes(packed).copy_to_slice(&mut out[n..n + 4]);
        n += bits.count_ones() as usize;
        i += 4;
    }
    for i in simd_end..end {
        out[n] = i as u32;
        n += usize::from(frustum.contains_sphere(xs[i], ys[i], zs[i], rs[i]));
    }
    n
}

/// The bytes of `bytes` that `picks` selects, with 0 where a pick is 16 or more. On WebAssembly
/// this is one `i8x16.swizzle`: the portable `swizzle_dyn` lowers to it only in code compiled
/// with SIMD, and the standard library that the single-threaded build links was compiled without.
#[inline(always)]
fn shuffle_bytes(bytes: u8x16, picks: u8x16) -> u8x16 {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use std::arch::wasm32::{u8x16_swizzle, v128};
        u8x16_swizzle(v128::from(bytes), v128::from(picks)).into()
    }
    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        bytes.swizzle_dyn(picks)
    }
}

/// The scalar version of [`cull_spheres`], one sphere at a time. It returns the same indices.
///
/// # Panics
/// As for [`cull_spheres`].
pub fn cull_spheres_reference(
    frustum: &Frustum,
    xs: &[f32],
    ys: &[f32],
    zs: &[f32],
    rs: &[f32],
    range: Range<u32>,
    out: &mut [u32],
) -> usize {
    check_range(xs, ys, zs, rs, &range, out);
    let mut n = 0;
    for i in range {
        let k = i as usize;
        if frustum.contains_sphere(xs[k], ys[k], zs[k], rs[k]) {
            out[n] = i;
            n += 1;
        }
    }
    n
}

/// Visible indices at or above this count are packed by a parallel loop; fewer are copied on
/// the calling thread, which is faster than waking the workers.
const PARALLEL_PACK_THRESHOLD: usize = 1 << 15;
/// Spheres at or above this count are culled on the job workers too; fewer are culled on the
/// calling thread, which takes less time than waking the workers and waiting for them.
const PARALLEL_CULL_THRESHOLD: usize = 1 << 14;

/// The output of [`cull_parallel`]: the index list, a scratch list each chunk culls into, and one
/// offset per chunk, all allocated once with room for every sphere.
#[derive(Clone, Debug)]
pub struct CullOutput {
    indices: Vec<u32>,
    scratch: Vec<u32>,
    offsets: Vec<u32>,
    len: usize,
}

impl CullOutput {
    /// Room for up to `max_spheres` spheres.
    pub fn with_capacity(max_spheres: u32) -> Self {
        Self {
            indices: vec![0; max_spheres as usize],
            scratch: vec![0; max_spheres as usize],
            offsets: vec![0; max_spheres.div_ceil(CULL_CHUNK) as usize + 1],
            len: 0,
        }
    }

    /// The largest sphere count this output can take.
    pub fn capacity(&self) -> u32 {
        self.indices.len() as u32
    }

    /// The indices of the visible spheres, in increasing order.
    pub fn visible(&self) -> &[u32] {
        &self.indices[..self.len]
    }

    /// The number of visible spheres.
    pub fn len(&self) -> usize {
        self.len
    }

    /// True when no sphere was visible.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

/// Culls every sphere on the calling thread and the job workers, in chunks of [`CULL_CHUNK`],
/// and compacts the visible indices into one list in increasing order. A few thousand spheres or
/// fewer are culled on the calling thread alone. It allocates nothing and returns the number of
/// visible spheres.
///
/// Each chunk culls into its own part of a scratch list and records its count. A prefix sum over
/// the counts gives each chunk's place in the output, and a second loop copies every chunk
/// there, in parallel when the list is long.
///
/// # Panics
/// When `out` has less room than there are spheres.
pub fn cull_parallel(
    jobs: &JobSystem,
    frustum: &Frustum,
    spheres: SphereArrays<'_>,
    out: &mut CullOutput,
) -> usize {
    let count = u32::try_from(spheres.len()).expect("at most u32::MAX spheres");
    assert!(
        count <= out.capacity(),
        "the cull output holds {} spheres, fewer than {count}",
        out.capacity()
    );
    let chunks = count.div_ceil(CULL_CHUNK) as usize;
    if (count as usize) < PARALLEL_CULL_THRESHOLD || jobs.worker_count() == 0 {
        // One thread culls straight into the output.
        out.len = cull_spheres(
            frustum,
            spheres.xs,
            spheres.ys,
            spheres.zs,
            spheres.radii,
            0..count,
            &mut out.indices,
        );
        return out.len;
    }

    let scratch = SharedMut::new(&mut out.scratch);
    let counts = SharedMut::new(&mut out.offsets);
    jobs.parallel_for(count, CULL_CHUNK, &|range, _| {
        let chunk = (range.start / CULL_CHUNK) as usize;
        // SAFETY: each chunk writes only its own part of the scratch list and its own count; the
        // parts of different chunks do not overlap.
        let dst = unsafe { scratch.slice(range.start as usize, range.len()) };
        let visible = cull_spheres(
            frustum,
            spheres.xs,
            spheres.ys,
            spheres.zs,
            spheres.radii,
            range,
            dst,
        );
        // SAFETY: as above.
        unsafe { counts.write(chunk, visible as u32) };
    });

    // Counts become offsets: chunk `c` goes to `offsets[c]..offsets[c + 1]`.
    let mut total = 0;
    for offset in &mut out.offsets[..chunks] {
        let visible = *offset;
        *offset = total;
        total += visible;
    }
    out.offsets[chunks] = total;
    let (offsets, scratch) = (&out.offsets, &out.scratch);
    let indices = SharedMut::new(&mut out.indices);
    let pack = |chunk: usize| {
        let (at, end) = (offsets[chunk] as usize, offsets[chunk + 1] as usize);
        let from = chunk * CULL_CHUNK as usize;
        // SAFETY: the offsets are a prefix sum, so the output ranges of different chunks do not
        // overlap.
        unsafe { indices.slice(at, end - at) }.copy_from_slice(&scratch[from..from + end - at]);
    };
    if total as usize >= PARALLEL_PACK_THRESHOLD {
        jobs.parallel_for(chunks as u32, 1, &|range, _| {
            for chunk in range {
                pack(chunk as usize);
            }
        });
    } else {
        (0..chunks).for_each(pack);
    }
    out.len = total as usize;
    out.len
}

/// The bucket of a run whose rows each look up their own bucket in the row bucket table.
pub const BY_ROW: u32 = u32::MAX - 1;
/// A row bucket that draws nowhere: the row is culled but never listed.
pub const NO_BUCKET: u32 = u32::MAX;

/// A run of rows for [`cull_into_buckets`]: rows `start..end` of one set of sphere arrays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CullRun {
    /// The set that holds the run's spheres, numbered as the caller's set function reads it.
    pub set: u32,
    /// The first row.
    pub start: u32,
    /// One past the last row.
    pub end: u32,
    /// The bucket of every visible row, or [`BY_ROW`] to look each row up in the row buckets.
    pub bucket: u32,
    /// Added to each visible row to make its list entry.
    pub base: u32,
}

impl CullRun {
    fn len(&self) -> usize {
        (self.end - self.start) as usize
    }
}

/// The output and working space of [`cull_into_buckets`]: the list of visible entries grouped by
/// bucket, and the scratch space behind it. Buffers grow only through [`BucketedCull::try_reserve`],
/// so culling itself never allocates.
#[derive(Clone, Debug, Default)]
pub struct BucketedCull {
    indices: Vec<u32>,
    bucket_starts: Vec<u32>,
    scratch: Vec<u32>,
    run_offsets: Vec<u32>,
    run_counts: Vec<u32>,
    run_positions: Vec<u32>,
    /// Per [`BY_ROW`] run, one count per bucket; then the next write position per bucket.
    histograms: Vec<u32>,
    cursors: Vec<u32>,
    buckets: usize,
    len: usize,
}

impl BucketedCull {
    /// Makes room for `rows` rows in `runs` runs, `by_row_runs` of them looking up their rows'
    /// buckets, and `buckets` buckets, or fails when memory cannot grow. Room only grows.
    pub fn try_reserve(
        &mut self,
        rows: u32,
        runs: u32,
        by_row_runs: u32,
        buckets: u32,
    ) -> Result<(), TryReserveError> {
        fn grow(v: &mut Vec<u32>, len: usize) -> Result<(), TryReserveError> {
            if v.len() < len {
                v.try_reserve_exact(len - v.len())?;
                v.resize(len, 0);
            }
            Ok(())
        }
        let (rows, runs, buckets) = (rows as usize, runs as usize, buckets as usize);
        grow(&mut self.indices, rows)?;
        grow(&mut self.scratch, rows)?;
        grow(&mut self.bucket_starts, buckets + 1)?;
        grow(&mut self.cursors, buckets)?;
        grow(&mut self.run_offsets, runs)?;
        grow(&mut self.run_counts, runs)?;
        grow(&mut self.run_positions, runs)?;
        grow(&mut self.histograms, by_row_runs as usize * buckets)?;
        Ok(())
    }

    /// Every visible entry, bucket by bucket; within a bucket, in run order and row order.
    pub fn indices(&self) -> &[u32] {
        &self.indices[..self.len]
    }

    /// Where each bucket's entries start in [`BucketedCull::indices`], and, last, the total.
    pub fn bucket_starts(&self) -> &[u32] {
        &self.bucket_starts[..self.buckets + 1]
    }

    /// The number of visible entries.
    pub fn len(&self) -> usize {
        self.len
    }

    /// True when nothing is visible.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

/// Culls runs of rows from several sets of sphere arrays, on the calling thread and the job
/// workers, and lists the visible rows grouped by bucket. Each visible row's entry is its row
/// plus its run's base. A run either puts every visible row in one bucket, or looks each row up
/// in `row_buckets`, where [`NO_BUCKET`] drops the row. Returns the number of entries.
///
/// Each run culls into its own part of a scratch list and counts its rows per bucket, on the
/// job workers too when the runs hold many rows. A prefix sum over the buckets and runs then
/// gives each run the places of its rows in the list, and a second pass copies them there, in
/// parallel when the list is long. Runs are best kept to [`CULL_CHUNK`] rows or fewer, so the
/// work spreads over the workers.
///
/// # Panics
/// When `out` has less room than the runs, their rows or the buckets need, or a run's bucket is
/// out of range.
pub fn cull_into_buckets<'a>(
    jobs: &JobSystem,
    frustum: &Frustum,
    sets: &(dyn Fn(u32) -> SphereArrays<'a> + Sync),
    runs: &[CullRun],
    row_buckets: &[u32],
    buckets: u32,
    out: &mut BucketedCull,
) -> usize {
    let bucket_count = buckets as usize;
    assert!(
        runs.len() <= out.run_offsets.len() && bucket_count < out.bucket_starts.len(),
        "the output has room for {} runs and {} buckets, fewer than {} and {bucket_count}",
        out.run_offsets.len(),
        out.bucket_starts.len().saturating_sub(1),
        runs.len()
    );
    out.buckets = bucket_count;
    // Each run's part of the scratch list, and for a looked-up run the start of its histogram,
    // which it keeps in its position slot until the second pass.
    let mut rows = 0;
    let mut histogram_at = 0;
    for (index, run) in runs.iter().enumerate() {
        assert!(
            run.bucket == BY_ROW || run.bucket < buckets,
            "run bucket {} is out of range",
            run.bucket
        );
        out.run_offsets[index] = rows as u32;
        rows += run.len();
        if run.bucket == BY_ROW {
            out.run_positions[index] = histogram_at as u32;
            histogram_at += bucket_count;
        }
    }
    assert!(
        rows <= out.scratch.len() && histogram_at <= out.histograms.len(),
        "the output has too little room for {rows} rows and {histogram_at} histogram counts"
    );

    // Pass 1: cull each run into its part of the scratch list, and count looked-up rows per
    // bucket in the run's histogram.
    let scratch = SharedMut::new(&mut out.scratch);
    let counts = SharedMut::new(&mut out.run_counts);
    let histograms = SharedMut::new(&mut out.histograms);
    let (offsets, positions) = (&out.run_offsets, &out.run_positions);
    let cull = |index: usize| {
        let run = runs[index];
        let spheres = sets(run.set);
        // SAFETY: each run writes only its own part of the scratch list, its own count and its
        // own histogram; the parts of different runs do not overlap.
        let dst = unsafe { scratch.slice(offsets[index] as usize, run.len()) };
        let visible = cull_spheres(
            frustum,
            spheres.xs,
            spheres.ys,
            spheres.zs,
            spheres.radii,
            run.start..run.end,
            dst,
        );
        // SAFETY: as above.
        unsafe { counts.write(index, visible as u32) };
        if run.bucket == BY_ROW {
            // SAFETY: as above.
            let histogram = unsafe { histograms.slice(positions[index] as usize, bucket_count) };
            histogram.fill(0);
            for &row in &dst[..visible] {
                let bucket = row_buckets[row as usize];
                if bucket != NO_BUCKET {
                    histogram[bucket as usize] += 1;
                }
            }
        }
    };
    if rows >= PARALLEL_CULL_THRESHOLD {
        jobs.parallel_for(runs.len() as u32, 1, &|range, _| {
            for index in range {
                cull(index as usize);
            }
        });
    } else {
        (0..runs.len()).for_each(cull);
    }

    // Bucket totals, then each bucket's start, then each run's place in its buckets.
    let totals = &mut out.cursors[..bucket_count];
    totals.fill(0);
    for (index, run) in runs.iter().enumerate() {
        if run.bucket == BY_ROW {
            let at = out.run_positions[index] as usize;
            for (total, count) in totals
                .iter_mut()
                .zip(&out.histograms[at..at + bucket_count])
            {
                *total += count;
            }
        } else {
            totals[run.bucket as usize] += out.run_counts[index];
        }
    }
    let mut total = 0;
    for (start, cursor) in out.bucket_starts.iter_mut().zip(totals.iter_mut()) {
        *start = total;
        total += *cursor;
        *cursor = *start;
    }
    out.bucket_starts[bucket_count] = total;
    let cursors = &mut out.cursors[..bucket_count];
    for (index, run) in runs.iter().enumerate() {
        if run.bucket == BY_ROW {
            let at = out.run_positions[index] as usize;
            for (count, cursor) in out.histograms[at..at + bucket_count]
                .iter_mut()
                .zip(cursors.iter_mut())
            {
                let start = *cursor;
                *cursor += *count;
                *count = start;
            }
        } else {
            let cursor = &mut cursors[run.bucket as usize];
            out.run_positions[index] = *cursor;
            *cursor += out.run_counts[index];
        }
    }

    // Pass 2: copy each run's visible rows to their places, adding the run's base.
    let (scratch, offsets, counts, positions) = (
        &out.scratch,
        &out.run_offsets,
        &out.run_counts,
        &out.run_positions,
    );
    let indices = SharedMut::new(&mut out.indices);
    let histograms = SharedMut::new(&mut out.histograms);
    let place = |index: usize| {
        let run = runs[index];
        let from = offsets[index] as usize;
        let visible = &scratch[from..from + counts[index] as usize];
        if run.bucket == BY_ROW {
            // SAFETY: the run's histogram holds its own write positions, and the prefix sum gave
            // each run and bucket its own range of the list, so no two runs write one place.
            let next = unsafe { histograms.slice(positions[index] as usize, bucket_count) };
            for &row in visible {
                let bucket = row_buckets[row as usize];
                if bucket != NO_BUCKET {
                    let at = &mut next[bucket as usize];
                    // SAFETY: as above.
                    unsafe { indices.write(*at as usize, row + run.base) };
                    *at += 1;
                }
            }
        } else {
            // SAFETY: as above.
            let dst = unsafe { indices.slice(positions[index] as usize, visible.len()) };
            for (entry, &row) in dst.iter_mut().zip(visible) {
                *entry = row + run.base;
            }
        }
    };
    if total as usize >= PARALLEL_PACK_THRESHOLD {
        jobs.parallel_for(runs.len() as u32, 1, &|range, _| {
            for index in range {
                place(index as usize);
            }
        });
    } else {
        (0..runs.len()).for_each(place);
    }
    out.len = total as usize;
    out.len
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A column-major perspective matrix in WebGPU's clip space, looking down -Z.
    pub(crate) fn perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> [f32; 16] {
        let f = 1.0 / (fov_y / 2.0).tan();
        let mut m = [0.0; 16];
        m[0] = f / aspect;
        m[5] = f;
        m[10] = far / (near - far);
        m[11] = -1.0;
        m[14] = near * far / (near - far);
        m
    }

    #[test]
    fn perspective_frustum_planes() {
        let frustum = Frustum::from_view_projection(&perspective(
            std::f32::consts::FRAC_PI_2,
            1.0,
            1.0,
            100.0,
        ));
        // Near plane at z = -1 faces -Z; far plane at z = -100 faces +Z.
        let near = frustum.planes()[4];
        let far = frustum.planes()[5];
        assert!((near[2] + 1.0).abs() < 1e-5 && (near[3] + 1.0).abs() < 1e-5);
        assert!((far[2] - 1.0).abs() < 1e-5 && (far[3] - 100.0).abs() < 1e-3);
        assert!(frustum.contains_sphere(0.0, 0.0, -10.0, 0.0));
        assert!(!frustum.contains_sphere(0.0, 0.0, 10.0, 1.0));
        assert!(!frustum.contains_sphere(0.0, 0.0, -10.0, f32::NEG_INFINITY));
        // With a 90 degree field of view, the right plane passes through x = -z.
        assert!(frustum.contains_sphere(10.5, 0.0, -10.0, 1.0));
        assert!(!frustum.contains_sphere(12.0, 0.0, -10.0, 1.0));
    }

    #[test]
    fn a_zero_plane_never_culls() {
        let frustum = Frustum::from_planes([[0.0; 4]; 6]);
        assert!(frustum.contains_sphere(1e30, -1e30, 0.0, 0.0));
    }

    #[test]
    fn simd_and_scalar_agree_on_a_small_set() {
        let frustum = Frustum::from_view_projection(&perspective(1.0, 1.5, 0.5, 50.0));
        let xs: Vec<f32> = (0..23).map(|i| i as f32 - 11.0).collect();
        let ys = vec![0.0; 23];
        let zs: Vec<f32> = (0..23).map(|i| -(i as f32)).collect();
        let rs = vec![0.5; 23];
        for range in [0..23, 3..20, 5..5, 22..23] {
            let mut a = vec![0; 23];
            let mut b = vec![0; 23];
            let na = cull_spheres(&frustum, &xs, &ys, &zs, &rs, range.clone(), &mut a);
            let nb = cull_spheres_reference(&frustum, &xs, &ys, &zs, &rs, range, &mut b);
            assert_eq!(a[..na], b[..nb]);
        }
    }
}

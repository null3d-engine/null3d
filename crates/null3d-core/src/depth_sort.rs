//! Culling and back-to-front sorting for the transparent pass, on the calling thread and the job
//! workers.
//!
//! Blended surfaces draw after the opaque ones, farthest first, so each one blends over what lies
//! behind it. [`cull_and_sort`] culls runs of rows as [`crate::culling::cull_into_buckets`] does,
//! gives each visible row a 64-bit key, and sorts the rows by key with a stable radix sort. The
//! key's high half holds the row's render order, so a lower order draws first at any depth. Its
//! low half holds the row's depth, turned around so that the farthest row comes first. Rows with
//! equal keys keep the order of their runs, so a frame sorts the same way on any thread count.
//!
//! A row's depth is the distance from the view's near plane to its sphere's center. three.js
//! orders transparent objects the same way: by the depth of their bounding sphere's center.
//!
//! Each sorted item names its run and its row within the run ([`split_item`]), so the caller finds
//! the row's set, bucket, cell and data from its runs.
//!
//! The radix sort takes 8 bits of the key per pass and skips each pass whose 8 bits are the same
//! in every key. Rows that share one render order, as most do, sort in 4 passes. Each pass counts
//! the keys of each chunk of 4,096 items, then places every chunk's items, on the job workers too
//! when there are many. Buffers grow only through [`DepthSorted::try_reserve`], so a frame's sort
//! never allocates.

use std::collections::TryReserveError;

use crate::culling::{
    CULL_CHUNK, CullRun, CullSet, CullView, ROW_CELLS, SetLayers, SetOrder, cull_in_parallel,
    cull_spheres, cull_spheres_in_cells, keep_layers,
};
use crate::jobs::JobSystem;
use crate::layers::shares_layer;
use crate::shared::SharedMut;

/// Bits of an item that hold its row within its run: a run holds at most [`CULL_CHUNK`] rows.
const ROW_BITS: u32 = 12;
const _: () = assert!(1 << ROW_BITS == CULL_CHUNK);
/// The most runs that one sort takes: the run index fills an item's bits above its row.
pub const MAX_SORT_RUNS: u32 = 1 << (32 - ROW_BITS);
/// Items per chunk of a radix pass, which one thread counts and places.
const SORT_CHUNK: usize = 4096;
/// Values of one 8-bit digit of a key.
const DIGITS: usize = 256;

/// The rows of one set that runs sort: the rows and cells that culling reads, and each row's
/// render order, or none for rows whose order is 0.
#[derive(Clone, Copy, Debug)]
pub struct SortSet<'a> {
    /// What culling reads of the set's rows, whose positions are its rows ([`SetOrder::Rows`]).
    pub rows: CullSet<'a>,
    /// Each row's render order, or `None` when every row has order 0.
    pub orders: Option<&'a [f32]>,
}

/// The run index and the row of a sorted item: the item of row `start + offset` of run `run`.
pub const fn split_item(item: u32) -> (usize, u32) {
    ((item >> ROW_BITS) as usize, item & ((1 << ROW_BITS) - 1))
}

/// The item of row `offset` of run `run`.
const fn item_of(run: usize, offset: u32) -> u32 {
    ((run as u32) << ROW_BITS) | offset
}

/// A float's bits turned so that unsigned order follows the float's order. Negative zero counts
/// as zero.
fn ordered_bits(value: f32) -> u32 {
    let bits = (value + 0.0).to_bits();
    if bits & 0x8000_0000 != 0 {
        !bits
    } else {
        bits | 0x8000_0000
    }
}

/// The sort key of a row: its render order first, then its depth, farthest first.
fn sort_key(order: f32, depth: f32) -> u64 {
    (u64::from(ordered_bits(order)) << 32) | u64::from(!ordered_bits(depth))
}

/// The output and working space of [`cull_and_sort`]: the sorted items and the scratch behind
/// them. Buffers grow only through [`DepthSorted::try_reserve`].
#[derive(Clone, Debug, Default)]
pub struct DepthSorted {
    /// Keys and items: each run's part while culling, then the sorted list.
    keys: Vec<u64>,
    items: Vec<u32>,
    /// The other buffers of each radix pass.
    spare_keys: Vec<u64>,
    spare_items: Vec<u32>,
    /// Each run's visible rows while culling.
    rows: Vec<u32>,
    run_offsets: Vec<u32>,
    run_counts: Vec<u32>,
    /// The bitwise AND and OR of each run's keys, which show the bits that differ.
    run_bits: Vec<[u64; 2]>,
    /// One count per digit for each chunk of a pass, which then become its write positions.
    histograms: Vec<u32>,
    len: usize,
}

impl DepthSorted {
    /// Makes room for `rows` rows in `runs` runs, or fails when memory cannot grow. Room only
    /// grows.
    pub fn try_reserve(&mut self, rows: u32, runs: u32) -> Result<(), TryReserveError> {
        fn grow<T: Copy + Default>(v: &mut Vec<T>, len: usize) -> Result<(), TryReserveError> {
            if v.len() < len {
                v.try_reserve_exact(len - v.len())?;
                v.resize(len, T::default());
            }
            Ok(())
        }
        let (rows, runs) = (rows as usize, runs as usize);
        grow(&mut self.keys, rows)?;
        grow(&mut self.items, rows)?;
        grow(&mut self.spare_keys, rows)?;
        grow(&mut self.spare_items, rows)?;
        grow(&mut self.rows, rows)?;
        grow(&mut self.run_offsets, runs)?;
        grow(&mut self.run_counts, runs)?;
        grow(&mut self.run_bits, runs)?;
        grow(&mut self.histograms, rows.div_ceil(SORT_CHUNK) * DIGITS)
    }

    /// The visible rows' items, sorted: farthest first within each render order, lower orders
    /// first. [`split_item`] gives each item's run and row.
    pub fn items(&self) -> &[u32] {
        &self.items[..self.len]
    }

    /// The number of visible rows.
    pub fn len(&self) -> usize {
        self.len
    }

    /// True when no row is visible.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

/// Culls runs of rows from several sets for one view, on the calling thread and the job workers,
/// and sorts the visible rows back to front. `depth` is the view's near plane: its normal points
/// into the view, and a center's depth is the plane's equation there. A row is visible when its
/// sphere is in the view's frustum and its layer mask shares a bit with the view's. Returns the
/// number of visible rows, whose items [`DepthSorted::items`] then gives.
///
/// # Panics
/// When `out` has less room than the runs or their rows need, when there are more than
/// [`MAX_SORT_RUNS`] runs, or when a run is longer than [`CULL_CHUNK`] rows or names a cell past
/// the view's offsets.
pub fn cull_and_sort<'a>(
    jobs: &JobSystem,
    view: CullView<'_>,
    depth: [f32; 4],
    sets: &(dyn Fn(u32) -> SortSet<'a> + Sync),
    runs: &[CullRun],
    out: &mut DepthSorted,
) -> usize {
    assert!(
        runs.len() <= out.run_offsets.len() && runs.len() <= MAX_SORT_RUNS as usize,
        "the output has room for {} runs, fewer than {}",
        out.run_offsets.len(),
        runs.len()
    );
    let mut rows = 0;
    for (index, run) in runs.iter().enumerate() {
        assert!(
            run.end - run.start <= CULL_CHUNK,
            "run {index} holds more than {CULL_CHUNK} rows"
        );
        out.run_offsets[index] = rows as u32;
        rows += (run.end - run.start) as usize;
    }
    assert!(
        rows <= out.rows.len(),
        "the output has room for {} rows, fewer than {rows}",
        out.rows.len()
    );
    let parallel = cull_in_parallel(jobs, rows);

    // Pass 1: cull each run into its part of the lists, and key each visible row.
    {
        let keys = SharedMut::new(&mut out.keys);
        let items = SharedMut::new(&mut out.items);
        let visible_rows = SharedMut::new(&mut out.rows);
        let counts = SharedMut::new(&mut out.run_counts);
        let bits = SharedMut::new(&mut out.run_bits);
        let offsets = &out.run_offsets;
        let cull = |index: usize| {
            let run = runs[index];
            let set = sets(run.set);
            let len = (run.end - run.start) as usize;
            let at = offsets[index] as usize;
            // SAFETY: each run writes only its own part of the lists, its count and its bits.
            let dst = unsafe { visible_rows.slice(at, len) };
            let visible = cull_run(view, set.rows, run, dst);
            // SAFETY: as above.
            let (keys, items) = unsafe { (keys.slice(at, visible), items.slice(at, visible)) };
            let spheres = set.rows.spheres;
            let (mut all, mut any) = (u64::MAX, 0);
            for (k, &row) in dst[..visible].iter().enumerate() {
                let i = row as usize;
                let cell = if run.cell == ROW_CELLS {
                    set.rows.cells[i]
                } else {
                    run.cell
                };
                let [x, y, z, _] = view.offsets[cell as usize];
                let (cx, cy, cz) = (spheres.xs[i] + x, spheres.ys[i] + y, spheres.zs[i] + z);
                let distance = depth[0] * cx + depth[1] * cy + depth[2] * cz + depth[3];
                let order = set.orders.map_or(0.0, |orders| orders[i]);
                let key = sort_key(order, distance);
                keys[k] = key;
                items[k] = item_of(index, row - run.start);
                all &= key;
                any |= key;
            }
            // SAFETY: as above.
            unsafe {
                counts.write(index, visible as u32);
                bits.write(index, [all, any]);
            }
        };
        if parallel {
            jobs.parallel_for(runs.len() as u32, 1, &|range, _| {
                for index in range {
                    cull(index as usize);
                }
            });
        } else {
            (0..runs.len()).for_each(cull);
        }
    }

    // Pass 2: pack the runs' parts into the spare lists, in run order, and find the key bits
    // that differ between rows.
    let (mut all, mut any, mut total) = (u64::MAX, 0, 0usize);
    for index in 0..runs.len() {
        let [run_all, run_any] = out.run_bits[index];
        if out.run_counts[index] > 0 {
            all &= run_all;
            any |= run_any;
        }
        let count = out.run_counts[index];
        out.run_counts[index] = total as u32;
        total += count as usize;
    }
    {
        let spare_keys = SharedMut::new(&mut out.spare_keys);
        let spare_items = SharedMut::new(&mut out.spare_items);
        let (keys, items, offsets, places) =
            (&out.keys, &out.items, &out.run_offsets, &out.run_counts);
        let pack = |index: usize| {
            let from = offsets[index] as usize;
            let to = places[index] as usize;
            let count = if index + 1 < runs.len() {
                places[index + 1] as usize - to
            } else {
                total - to
            };
            // SAFETY: the places come from a prefix sum, so no two runs write one place.
            unsafe {
                spare_keys
                    .slice(to, count)
                    .copy_from_slice(&keys[from..from + count]);
                spare_items
                    .slice(to, count)
                    .copy_from_slice(&items[from..from + count]);
            }
        };
        if parallel {
            jobs.parallel_for(runs.len() as u32, 1, &|range, _| {
                for index in range {
                    pack(index as usize);
                }
            });
        } else {
            (0..runs.len()).for_each(pack);
        }
    }
    std::mem::swap(&mut out.keys, &mut out.spare_keys);
    std::mem::swap(&mut out.items, &mut out.spare_items);
    out.len = total;

    // Pass 3: the radix passes, over the bytes whose bits differ between keys.
    let differ = all ^ any;
    for byte in 0..8 {
        if (differ >> (byte * 8)) & 0xff != 0 {
            radix_pass(jobs, out, byte * 8, parallel);
        }
    }
    total
}

/// Culls one run's rows into `dst`, and keeps those on the view's layers. Returns their count.
fn cull_run(view: CullView<'_>, set: CullSet<'_>, run: CullRun, dst: &mut [u32]) -> usize {
    debug_assert!(
        matches!(set.order, SetOrder::Rows),
        "sorted sets cull by row"
    );
    let visible = match set.layers {
        SetLayers::All(mask) if !shares_layer(mask, view.layers) => 0,
        _ if run.cell == ROW_CELLS => cull_spheres_in_cells(
            view.frustum,
            set.spheres,
            set.cells,
            view.offsets,
            run.start..run.end,
            dst,
        ),
        _ => {
            let [x, y, z, _] = view.offsets[run.cell as usize];
            let spheres = set.spheres;
            cull_spheres(
                &view.frustum.moved_by([x, y, z]),
                spheres.xs,
                spheres.ys,
                spheres.zs,
                spheres.radii,
                run.start..run.end,
                dst,
            )
        }
    };
    match set.layers {
        SetLayers::Rows(masks) => keep_layers(&mut dst[..visible], masks, view.layers),
        SetLayers::All(_) => visible,
    }
}

/// Sorts the output's items by the 8 key bits from `shift` up, keeping the order of equal ones:
/// each chunk counts its digits, a prefix sum over digits then chunks gives each chunk its places,
/// and each chunk places its items. The sorted items end in the output's main lists.
fn radix_pass(jobs: &JobSystem, out: &mut DepthSorted, shift: u32, parallel: bool) {
    let n = out.len;
    let chunks = n.div_ceil(SORT_CHUNK);
    let digit = |key: u64| ((key >> shift) & 0xff) as usize;
    {
        let histograms = SharedMut::new(&mut out.histograms);
        let keys = &out.keys;
        let count = |chunk: usize| {
            // SAFETY: each chunk writes only its own histogram.
            let histogram = unsafe { histograms.slice(chunk * DIGITS, DIGITS) };
            histogram.fill(0);
            let end = (chunk * SORT_CHUNK + SORT_CHUNK).min(n);
            for &key in &keys[chunk * SORT_CHUNK..end] {
                histogram[digit(key)] += 1;
            }
        };
        run_chunks(jobs, chunks, parallel, &count);
    }
    let mut place = 0;
    for d in 0..DIGITS {
        for chunk in 0..chunks {
            let slot = &mut out.histograms[chunk * DIGITS + d];
            let count = *slot;
            *slot = place;
            place += count;
        }
    }
    {
        let histograms = SharedMut::new(&mut out.histograms);
        let spare_keys = SharedMut::new(&mut out.spare_keys);
        let spare_items = SharedMut::new(&mut out.spare_items);
        let (keys, items) = (&out.keys, &out.items);
        let scatter = |chunk: usize| {
            // SAFETY: each chunk reads and advances only its own write positions, and the prefix
            // sum gave every chunk and digit places of their own, so no two items share a place.
            let next = unsafe { histograms.slice(chunk * DIGITS, DIGITS) };
            let end = (chunk * SORT_CHUNK + SORT_CHUNK).min(n);
            for i in chunk * SORT_CHUNK..end {
                let key = keys[i];
                let at = &mut next[digit(key)];
                // SAFETY: as above.
                unsafe {
                    spare_keys.write(*at as usize, key);
                    spare_items.write(*at as usize, items[i]);
                }
                *at += 1;
            }
        };
        run_chunks(jobs, chunks, parallel, &scatter);
    }
    std::mem::swap(&mut out.keys, &mut out.spare_keys);
    std::mem::swap(&mut out.items, &mut out.spare_items);
}

/// Runs `f` on each chunk: on the job workers too when `parallel` is set, else on this thread.
fn run_chunks(jobs: &JobSystem, chunks: usize, parallel: bool, f: &(dyn Fn(usize) + Sync)) {
    if parallel {
        jobs.parallel_for(chunks as u32, 1, &|range, _| {
            for chunk in range {
                f(chunk as usize);
            }
        });
    } else {
        (0..chunks).for_each(f);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::culling::Frustum;
    use crate::layers::ALL_LAYERS;
    use crate::world::SphereArrays;

    /// A frustum that holds every sphere, and the plane z = 0 facing -z: depth grows along -z.
    fn everything() -> (Frustum, [f32; 4]) {
        let open = [0.0, 0.0, 0.0, f32::MAX];
        (Frustum::from_planes([open; 6]), [0.0, 0.0, -1.0, 0.0])
    }

    /// Spheres of radius 1 at x = 0, y = 0 and each z.
    struct Rows {
        xs: Vec<f32>,
        zs: Vec<f32>,
        radii: Vec<f32>,
    }

    impl Rows {
        fn new(zs: &[f32]) -> Self {
            Self {
                xs: vec![0.0; zs.len()],
                zs: zs.to_vec(),
                radii: vec![1.0; zs.len()],
            }
        }

        fn set<'a>(&'a self, orders: Option<&'a [f32]>, layers: SetLayers<'a>) -> SortSet<'a> {
            SortSet {
                rows: CullSet {
                    spheres: SphereArrays {
                        xs: &self.xs,
                        ys: &self.xs,
                        zs: &self.zs,
                        radii: &self.radii,
                    },
                    cells: &[],
                    order: SetOrder::Rows,
                    layers,
                },
                orders,
            }
        }
    }

    fn run(set: u32, start: u32, end: u32) -> CullRun {
        CullRun {
            set,
            start,
            end,
            bucket: 0,
            base: 0,
            cell: 0,
        }
    }

    /// Each sorted item as its set and row.
    fn sorted(out: &DepthSorted, runs: &[CullRun]) -> Vec<(u32, u32)> {
        out.items()
            .iter()
            .map(|&item| {
                let (index, offset) = split_item(item);
                (runs[index].set, runs[index].start + offset)
            })
            .collect()
    }

    #[test]
    fn rows_sort_farthest_first_and_equal_depths_keep_their_order() {
        let rows = Rows::new(&[-1.0, -5.0, -3.0, -5.0, 2.0]);
        let (frustum, plane) = everything();
        let offsets = [[0.0; 4]];
        let view = CullView {
            frustum: &frustum,
            offsets: &offsets,
            layers: ALL_LAYERS,
        };
        let runs = [run(0, 0, 3), run(0, 3, 5)];
        let mut out = DepthSorted::default();
        out.try_reserve(5, 2).unwrap();
        let sets = |_| rows.set(None, SetLayers::All(1));
        let n = cull_and_sort(&JobSystem::new(0), view, plane, &sets, &runs, &mut out);
        assert_eq!(n, 5);
        // Depth is -z: 5, 5, 3, 1, then -2 behind the plane.
        assert_eq!(
            sorted(&out, &runs),
            [(0, 1), (0, 3), (0, 2), (0, 0), (0, 4)]
        );
    }

    #[test]
    fn a_lower_render_order_draws_first_at_any_depth() {
        let rows = Rows::new(&[-1.0, -9.0, -4.0, -2.0]);
        let orders = [1.0, 0.0, -0.5, 0.0];
        let (frustum, plane) = everything();
        let offsets = [[0.0; 4]];
        let view = CullView {
            frustum: &frustum,
            offsets: &offsets,
            layers: ALL_LAYERS,
        };
        let runs = [run(0, 0, 4)];
        let mut out = DepthSorted::default();
        out.try_reserve(4, 1).unwrap();
        let sets = |_| rows.set(Some(&orders), SetLayers::All(1));
        cull_and_sort(&JobSystem::new(0), view, plane, &sets, &runs, &mut out);
        assert_eq!(sorted(&out, &runs), [(0, 2), (0, 1), (0, 3), (0, 0)]);
    }

    #[test]
    fn hidden_rows_and_rows_out_of_view_or_off_the_layers_are_left_out() {
        let mut rows = Rows::new(&[-1.0, -2.0, -3.0, -4.0]);
        rows.radii[1] = f32::NEG_INFINITY;
        rows.xs[2] = 100.0;
        let masks = [1, 1, 1, 2];
        // Everything from x = -10 to x = 10.
        let open = [0.0, 0.0, 0.0, f32::MAX];
        let slab = Frustum::from_planes([
            [1.0, 0.0, 0.0, 10.0],
            [-1.0, 0.0, 0.0, 10.0],
            open,
            open,
            open,
            open,
        ]);
        let offsets = [[0.0; 4]];
        let view = CullView {
            frustum: &slab,
            offsets: &offsets,
            layers: 1,
        };
        let runs = [run(0, 0, 4)];
        let mut out = DepthSorted::default();
        out.try_reserve(4, 1).unwrap();
        let sets = |_| rows.set(None, SetLayers::Rows(&masks));
        let n = cull_and_sort(
            &JobSystem::new(0),
            view,
            [0.0, 0.0, -1.0, 0.0],
            &sets,
            &runs,
            &mut out,
        );
        assert_eq!(n, 1);
        assert_eq!(sorted(&out, &runs), [(0, 0)]);
    }

    #[test]
    fn cells_move_centers_by_their_offset_before_depth() {
        let rows = Rows::new(&[-1.0, -1.0, -1.0]);
        let cells = [0, 1, 2];
        let (frustum, plane) = everything();
        let offsets = [[0.0; 4], [0.0, 0.0, -10.0, 0.0], [0.0, 0.0, 4.0, 0.0]];
        let view = CullView {
            frustum: &frustum,
            offsets: &offsets,
            layers: ALL_LAYERS,
        };
        let runs = [CullRun {
            cell: ROW_CELLS,
            ..run(0, 0, 3)
        }];
        let mut out = DepthSorted::default();
        out.try_reserve(3, 1).unwrap();
        let sets = |_| SortSet {
            rows: CullSet {
                cells: &cells,
                ..rows.set(None, SetLayers::All(1)).rows
            },
            orders: None,
        };
        cull_and_sort(&JobSystem::new(0), view, plane, &sets, &runs, &mut out);
        assert_eq!(sorted(&out, &runs), [(0, 1), (0, 0), (0, 2)]);
    }
}

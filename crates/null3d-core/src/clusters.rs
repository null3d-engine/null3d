//! Clusters: groups of nearby rows that culling tests as one sphere each.
//!
//! A set of rows that stays still, such as a static instance batch at rest, is sorted along a
//! Morton curve through the box around its sphere centres. The curve puts rows that are close in
//! space next to each other, so cutting the sorted rows into groups of [`CLUSTER_ROWS`] gives
//! compact clusters. Each cluster gets a sphere that holds the spheres of all its rows.
//!
//! Culling the cluster spheres lists the clusters in view, and each listed cluster stands for all
//! its rows. A cluster that is only partly in view draws some rows outside the view, which the GPU
//! clips; a cluster in view never leaves out a row that culling row by row would keep. Culling
//! costs one sphere per cluster instead of one per row, and the list of visible clusters is as
//! many times shorter.
//!
//! # Clusters inside cells
//!
//! Sphere centres are relative to the centres of their grid cells (see [`crate::cells`]), so rows
//! in different cells never share a cluster. When the rows lie in several cells, the build groups
//! them by cell, in increasing cell index, and sorts each cell's rows along a curve through the
//! box around that cell's centres. Each cell's clusters are then one run of clusters
//! ([`CellClusters`]), and the last cluster of each cell may hold fewer rows than the others. So
//! rows in several cells can need more clusters than their count alone does, up to the room that
//! [`cluster_room`] gives. A build that needs more builds nothing.
//!
//! Building sorts with a four-pass radix sort over 30-bit Morton codes. It allocates nothing once
//! [`RowClusters::try_reserve`] and [`ClusterScratch::try_reserve`] have made room.

use std::collections::TryReserveError;

use crate::cells::MAX_CELLS;
use crate::world::SphereArrays;

/// Rows per cluster, as a shift: a cluster holds `1 << CLUSTER_SHIFT` rows.
pub const CLUSTER_SHIFT: u32 = 6;
/// Rows per cluster.
pub const CLUSTER_ROWS: u32 = 1 << CLUSTER_SHIFT;
/// The order entry of a place in a cluster that holds no row: the end of a cell's last cluster.
pub const NO_ROW: u32 = u32::MAX;

/// The highest grid cell on each axis of the Morton curve: ten bits per axis.
const GRID_MAX: u32 = (1 << 10) - 1;

/// The most clusters that [`RowClusters::try_reserve`] makes room for over `rows` rows: the
/// clusters of the rows in one cell, and as many again, but at most one more per cell, for rows
/// in several cells.
pub const fn cluster_room(rows: u32) -> u32 {
    let whole = rows.div_ceil(CLUSTER_ROWS);
    let extra = if whole < MAX_CELLS - 1 {
        whole
    } else {
        MAX_CELLS - 1
    };
    whole + extra
}

/// Where the rows of a build lie.
#[derive(Clone, Copy, Debug)]
pub enum RowCells<'a> {
    /// Every row lies in this cell.
    One(u32),
    /// Each row lies in the cell of its entry, a cell index below [`MAX_CELLS`].
    Each(&'a [u32]),
}

/// The clusters of one cell: clusters `start..end`, whose rows all lie in `cell`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CellClusters {
    /// The cell index.
    pub cell: u32,
    /// The first cluster.
    pub start: u32,
    /// One past the last cluster.
    pub end: u32,
}

/// Working space that [`RowClusters::build`] sorts in. One scratch can serve every build once it
/// has room for the largest.
#[derive(Clone, Debug, Default)]
pub struct ClusterScratch {
    codes: Vec<u32>,
    codes_back: Vec<u32>,
    order_back: Vec<u32>,
    /// The rows grouped by cell.
    grouped: Vec<u32>,
    /// Rows per cell index, then where each cell's rows end in `grouped`.
    ends: Vec<u32>,
}

impl ClusterScratch {
    /// Makes room to build clusters over `rows` rows, or fails when memory cannot grow. Room
    /// only grows.
    pub fn try_reserve(&mut self, rows: u32) -> Result<(), TryReserveError> {
        let rows = rows as usize;
        grow(&mut self.codes, rows, 0)?;
        grow(&mut self.codes_back, rows, 0)?;
        grow(&mut self.order_back, rows, 0)?;
        grow(&mut self.grouped, rows, 0)?;
        grow(&mut self.ends, MAX_CELLS as usize, 0)
    }
}

/// The clusters of one set of rows: the rows in cluster order, and a sphere per cluster.
#[derive(Clone, Debug, Default)]
pub struct RowClusters {
    order: Vec<u32>,
    xs: Vec<f32>,
    ys: Vec<f32>,
    zs: Vec<f32>,
    radii: Vec<f32>,
    cells: Vec<CellClusters>,
    clusters: u32,
    rows: u32,
}

impl RowClusters {
    /// Makes room for the clusters of `rows` rows in any cells, [`cluster_room`] of them, or fails
    /// when memory cannot grow. Room only grows.
    pub fn try_reserve(&mut self, rows: u32) -> Result<(), TryReserveError> {
        let clusters = cluster_room(rows) as usize;
        grow(&mut self.order, clusters * CLUSTER_ROWS as usize, NO_ROW)?;
        grow(&mut self.xs, clusters, 0.0)?;
        grow(&mut self.ys, clusters, 0.0)?;
        grow(&mut self.zs, clusters, 0.0)?;
        grow(&mut self.radii, clusters, 0.0)?;
        let cells = (rows as usize).min(MAX_CELLS as usize);
        if self.cells.capacity() < cells {
            self.cells.try_reserve_exact(cells - self.cells.len())?;
        }
        Ok(())
    }

    /// The rows the clusters were last built over: rows `0..rows()`.
    pub fn rows(&self) -> u32 {
        self.rows
    }

    /// The number of clusters.
    pub fn len(&self) -> u32 {
        self.clusters
    }

    /// True when there are no clusters.
    pub fn is_empty(&self) -> bool {
        self.clusters == 0
    }

    /// One sphere per cluster, holding the spheres of all its rows.
    pub fn spheres(&self) -> SphereArrays<'_> {
        let n = self.clusters as usize;
        SphereArrays::new(
            &self.xs[..n],
            &self.ys[..n],
            &self.zs[..n],
            &self.radii[..n],
        )
    }

    /// The rows in cluster order: cluster `c` holds entries `c * CLUSTER_ROWS` up to the next
    /// cluster's. A cell's last cluster ends with [`NO_ROW`] entries when its rows do not fill it.
    pub fn order(&self) -> &[u32] {
        &self.order[..(self.clusters * CLUSTER_ROWS) as usize]
    }

    /// Each cell's run of clusters, in increasing cell index. The runs follow each other and cover
    /// every cluster.
    pub fn cells(&self) -> &[CellClusters] {
        &self.cells
    }

    /// Builds clusters over rows `0..rows` of `spheres`, each inside one cell, and returns true.
    /// When the rows' cells need more clusters than [`RowClusters::try_reserve`] made room for, it
    /// builds none and returns false.
    ///
    /// A row whose centre is not finite, or whose radius is NaN or infinite, makes its cluster's
    /// radius infinite, so culling always keeps that cluster. A row with a negative infinite
    /// radius, which culling always rejects, adds nothing to its cluster's sphere.
    ///
    /// # Panics
    /// When the spheres or the cells hold fewer than `rows` rows, a cell index is not below
    /// [`MAX_CELLS`], the scratch has less room than `rows` needs, or the clusters have less room
    /// than the rows of one cell need.
    pub fn build(
        &mut self,
        spheres: SphereArrays<'_>,
        rows: u32,
        cells: RowCells<'_>,
        scratch: &mut ClusterScratch,
    ) -> bool {
        let n = rows as usize;
        assert!(
            n <= spheres.len(),
            "{n} rows asked for, the spheres hold {}",
            spheres.len()
        );
        assert!(
            n.div_ceil(CLUSTER_ROWS as usize) <= self.xs.len() && n <= scratch.codes.len(),
            "room for {} clusters and {} rows, fewer than {rows} rows need",
            self.xs.len(),
            scratch.codes.len()
        );
        self.cells.clear();
        self.clusters = 0;
        self.rows = 0;
        let centres = [spheres.xs, spheres.ys, spheres.zs];
        let one = match cells {
            RowCells::One(cell) => Some(cell),
            RowCells::Each(cells) => {
                assert!(
                    n <= cells.len(),
                    "{n} rows asked for, {} cells",
                    cells.len()
                );
                let cells = &cells[..n];
                let first = cells.first().copied().unwrap_or_default();
                cells.iter().all(|&cell| cell == first).then_some(first)
            }
        };
        let ClusterScratch {
            codes,
            codes_back,
            order_back,
            grouped,
            ends,
        } = scratch;
        let mut next = 0;
        match (one, cells) {
            (Some(cell), _) => {
                morton_sort(
                    centres,
                    None,
                    &mut codes[..n],
                    &mut codes_back[..n],
                    &mut order_back[..n],
                    &mut self.order[..n],
                );
                next = self.close_cell(cell, 0, n);
            }
            (None, RowCells::Each(cells)) => {
                let cells = &cells[..n];
                count_cells(cells, ends);
                let needed: usize = ends
                    .iter()
                    .map(|&count| (count as usize).div_ceil(CLUSTER_ROWS as usize))
                    .sum();
                if needed > self.xs.len() {
                    return false;
                }
                group_by_cell(cells, ends, &mut grouped[..n]);
                let mut start = 0;
                for (cell, &end) in ends.iter().enumerate() {
                    let (s, e) = (start, end as usize);
                    start = e;
                    if s == e {
                        continue;
                    }
                    let at = next as usize * CLUSTER_ROWS as usize;
                    morton_sort(
                        centres,
                        Some(&grouped[s..e]),
                        &mut codes[s..e],
                        &mut codes_back[s..e],
                        &mut order_back[s..e],
                        &mut self.order[at..at + e - s],
                    );
                    next = self.close_cell(cell as u32, next, e - s);
                }
            }
            (None, RowCells::One(_)) => unreachable!("one cell always has a cell"),
        }
        for c in 0..next as usize {
            let start = c * CLUSTER_ROWS as usize;
            let members = &self.order[start..start + CLUSTER_ROWS as usize];
            let [x, y, z, r] = bounding_sphere(members, spheres);
            (self.xs[c], self.ys[c], self.zs[c], self.radii[c]) = (x, y, z, r);
        }
        self.clusters = next;
        self.rows = rows;
        true
    }

    /// Ends the clusters of a cell whose `len` rows sit in cluster order from cluster `first` on:
    /// fills the rest of its last cluster with [`NO_ROW`], records the cell's run of clusters, and
    /// returns the next free cluster.
    fn close_cell(&mut self, cell: u32, first: u32, len: usize) -> u32 {
        let end = first + (len as u32).div_ceil(CLUSTER_ROWS);
        let at = first as usize * CLUSTER_ROWS as usize;
        self.order[at + len..end as usize * CLUSTER_ROWS as usize].fill(NO_ROW);
        if end > first {
            self.cells.push(CellClusters {
                cell,
                start: first,
                end,
            });
        }
        end
    }
}

/// Counts the rows in each cell: `counts[cell]` for every cell index below [`MAX_CELLS`].
pub(crate) fn count_cells(cells: &[u32], counts: &mut [u32]) {
    counts.fill(0);
    for &cell in cells {
        counts[cell as usize] += 1;
    }
}

/// Lists rows `0..cells.len()` grouped by cell, in increasing cell index and in row order
/// within a cell: a stable counting sort. `ends` holds each cell's count from [`count_cells`]
/// and ends holding where each cell's rows end in `grouped`.
pub(crate) fn group_by_cell(cells: &[u32], ends: &mut [u32], grouped: &mut [u32]) {
    // Each count becomes its cell's start, and placing the rows moves it to its cell's end.
    let mut total = 0;
    for at in ends.iter_mut() {
        let count = *at;
        *at = total;
        total += count;
    }
    for (row, &cell) in cells.iter().enumerate() {
        let at = &mut ends[cell as usize];
        grouped[*at as usize] = row as u32;
        *at += 1;
    }
}

/// Sorts rows along a Morton curve through the box around their finite centres, and writes them
/// in curve order to `out`, with their codes in curve order in `codes`. The rows are `members`,
/// or rows `0..out.len()` for `None`. The other slices are working space as long as `out`.
pub(crate) fn morton_sort(
    [xs, ys, zs]: [&[f32]; 3],
    members: Option<&[u32]>,
    codes: &mut [u32],
    codes_back: &mut [u32],
    order_back: &mut [u32],
    out: &mut [u32],
) {
    let row = |i: usize| members.map_or(i, |members| members[i] as usize);
    // The box around every finite centre, which the curve's grid spans.
    let mut lo = [f32::INFINITY; 3];
    let mut hi = [f32::NEG_INFINITY; 3];
    for i in 0..out.len() {
        let r = row(i);
        let centre = [xs[r], ys[r], zs[r]];
        if centre.iter().all(|v| v.is_finite()) {
            for k in 0..3 {
                lo[k] = lo[k].min(centre[k]);
                hi[k] = hi[k].max(centre[k]);
            }
        }
    }
    let scale: [f32; 3] = std::array::from_fn(|k| {
        if hi[k] > lo[k] {
            GRID_MAX as f32 / (hi[k] - lo[k])
        } else {
            0.0
        }
    });
    // A float-to-integer cast saturates and turns NaN into 0, so every centre lands in the grid.
    let cell = |v: f32, k: usize| (((v - lo[k]) * scale[k]) as u32).min(GRID_MAX);
    for (i, code) in codes.iter_mut().enumerate() {
        let r = row(i);
        *code = spread_bits(cell(xs[r], 0))
            | (spread_bits(cell(ys[r], 1)) << 1)
            | (spread_bits(cell(zs[r], 2)) << 2);
    }
    // Four stable passes of eight bits, from the lowest; the even count ends in `out`.
    radix_pass(0, codes, members, codes_back, order_back);
    radix_pass(8, codes_back, Some(order_back), codes, out);
    radix_pass(16, codes, Some(out), codes_back, order_back);
    radix_pass(24, codes_back, Some(order_back), codes, out);
}

/// Grows `v` to `len` entries of `fill`, or fails when memory cannot grow.
pub(crate) fn grow<T: Copy>(v: &mut Vec<T>, len: usize, fill: T) -> Result<(), TryReserveError> {
    if v.len() < len {
        v.try_reserve_exact(len - v.len())?;
        v.resize(len, fill);
    }
    Ok(())
}

/// Spreads the low ten bits of `v` two bits apart, for one axis of a 30-bit Morton code.
fn spread_bits(v: u32) -> u32 {
    let mut x = v & 0x3ff;
    x = (x | (x << 16)) & 0x0300_00ff;
    x = (x | (x << 8)) & 0x0300_f00f;
    x = (x | (x << 4)) & 0x030c_30c3;
    (x | (x << 2)) & 0x0924_9249
}

/// One stable counting-sort pass by the byte of each code at `shift`, from `codes` and `order`
/// (the rows in their own order when `None`) into `out_codes` and `out_order`.
fn radix_pass(
    shift: u32,
    codes: &[u32],
    order: Option<&[u32]>,
    out_codes: &mut [u32],
    out_order: &mut [u32],
) {
    let mut starts = [0u32; 256];
    for &code in codes {
        starts[((code >> shift) & 0xff) as usize] += 1;
    }
    let mut total = 0;
    for start in &mut starts {
        let count = *start;
        *start = total;
        total += count;
    }
    for (i, &code) in codes.iter().enumerate() {
        let byte = ((code >> shift) & 0xff) as usize;
        let at = starts[byte] as usize;
        starts[byte] += 1;
        out_codes[at] = code;
        out_order[at] = order.map_or(i as u32, |order| order[i]);
    }
}

/// A sphere around the spheres of the rows that `members` lists, skipping its [`NO_ROW`] entries:
/// centred in the box around their centres, with a margin for the rounding of culling's plane
/// tests.
fn bounding_sphere(members: &[u32], spheres: SphereArrays<'_>) -> [f32; 4] {
    let SphereArrays {
        xs,
        ys,
        zs,
        radii: rs,
    } = spheres;
    let rows = || {
        members
            .iter()
            .filter(|&&row| row != NO_ROW)
            .map(|&row| row as usize)
    };
    let mut lo = [f32::INFINITY; 3];
    let mut hi = [f32::NEG_INFINITY; 3];
    let mut unbounded = false;
    let mut any = false;
    for r in rows() {
        let (centre, radius) = ([xs[r], ys[r], zs[r]], rs[r]);
        if radius == f32::NEG_INFINITY {
            continue;
        }
        if !(radius.is_finite() && centre.iter().all(|v| v.is_finite())) {
            unbounded = true;
            continue;
        }
        any = true;
        for k in 0..3 {
            lo[k] = lo[k].min(centre[k]);
            hi[k] = hi[k].max(centre[k]);
        }
    }
    if unbounded {
        return [0.0, 0.0, 0.0, f32::INFINITY];
    }
    if !any {
        return [0.0, 0.0, 0.0, f32::NEG_INFINITY];
    }
    let centre: [f32; 3] = std::array::from_fn(|k| lo[k] + (hi[k] - lo[k]) * 0.5);
    let mut radius = 0.0f32;
    for r in rows() {
        if rs[r] == f32::NEG_INFINITY {
            continue;
        }
        let (dx, dy, dz) = (xs[r] - centre[0], ys[r] - centre[1], zs[r] - centre[2]);
        radius = radius.max((dx * dx + dy * dy + dz * dz).sqrt() + rs[r]);
    }
    let size = centre[0].abs() + centre[1].abs() + centre[2].abs() + radius;
    [
        centre[0],
        centre[1],
        centre[2],
        radius + size * 16.0 * f32::EPSILON,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spread_bits_leaves_two_zero_bits_between_bits() {
        assert_eq!(spread_bits(0), 0);
        assert_eq!(spread_bits(1), 1);
        assert_eq!(spread_bits(0b11), 0b1001);
        assert_eq!(spread_bits(GRID_MAX), 0x0924_9249);
    }

    #[test]
    fn radix_passes_sort_stably() {
        let codes = [5u32, 0x0100, 5, 0x0200_0000, 3, 0x0100];
        let n = codes.len();
        let (mut a, mut b) = (codes.to_vec(), vec![0; n]);
        let (mut order, mut order_back) = (vec![0; n], vec![0; n]);
        radix_pass(0, &a, None, &mut b, &mut order_back);
        radix_pass(8, &b, Some(&order_back), &mut a, &mut order);
        radix_pass(16, &a, Some(&order), &mut b, &mut order_back);
        radix_pass(24, &b, Some(&order_back), &mut a, &mut order);
        assert_eq!(a, vec![3, 5, 5, 0x0100, 0x0100, 0x0200_0000]);
        assert_eq!(order, vec![4, 0, 2, 1, 5, 3]);
    }

    #[test]
    fn the_room_doubles_the_clusters_up_to_one_more_per_cell() {
        assert_eq!(cluster_room(0), 0);
        assert_eq!(cluster_room(1), 2);
        assert_eq!(cluster_room(64), 2);
        assert_eq!(cluster_room(65), 4);
        assert_eq!(cluster_room(64 * 1000), 1000 + MAX_CELLS - 1);
    }
}

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
//! Building sorts with a four-pass radix sort over 30-bit Morton codes. It allocates nothing once
//! [`RowClusters::try_reserve`] and [`ClusterScratch::try_reserve`] have made room.

use std::collections::TryReserveError;

use crate::world::SphereArrays;

/// Rows per cluster, as a shift: a cluster holds `1 << CLUSTER_SHIFT` rows.
pub const CLUSTER_SHIFT: u32 = 6;
/// Rows per cluster.
pub const CLUSTER_ROWS: u32 = 1 << CLUSTER_SHIFT;
/// The order entry of a place in a cluster that holds no row: the end of the last cluster.
pub const NO_ROW: u32 = u32::MAX;

/// The highest grid cell on each axis of the Morton curve: ten bits per axis.
const GRID_MAX: u32 = (1 << 10) - 1;

/// Working space that [`RowClusters::build`] sorts in. One scratch can serve every build once it
/// has room for the largest.
#[derive(Clone, Debug, Default)]
pub struct ClusterScratch {
    codes: Vec<u32>,
    codes_back: Vec<u32>,
    order_back: Vec<u32>,
}

impl ClusterScratch {
    /// Makes room to build clusters over `rows` rows, or fails when memory cannot grow. Room
    /// only grows.
    pub fn try_reserve(&mut self, rows: u32) -> Result<(), TryReserveError> {
        let rows = rows as usize;
        grow(&mut self.codes, rows, 0)?;
        grow(&mut self.codes_back, rows, 0)?;
        grow(&mut self.order_back, rows, 0)
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
    clusters: u32,
    rows: u32,
}

impl RowClusters {
    /// Makes room for clusters over `rows` rows, or fails when memory cannot grow. Room only
    /// grows.
    pub fn try_reserve(&mut self, rows: u32) -> Result<(), TryReserveError> {
        let clusters = rows.div_ceil(CLUSTER_ROWS) as usize;
        grow(&mut self.order, clusters * CLUSTER_ROWS as usize, NO_ROW)?;
        grow(&mut self.xs, clusters, 0.0)?;
        grow(&mut self.ys, clusters, 0.0)?;
        grow(&mut self.zs, clusters, 0.0)?;
        grow(&mut self.radii, clusters, 0.0)
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
    /// cluster's. The last cluster ends with [`NO_ROW`] entries when the rows do not fill it.
    pub fn order(&self) -> &[u32] {
        &self.order[..(self.clusters * CLUSTER_ROWS) as usize]
    }

    /// Builds clusters over rows `0..rows` of `spheres`.
    ///
    /// A row whose centre is not finite, or whose radius is NaN or infinite, makes its cluster's
    /// radius infinite, so culling always keeps that cluster. A row with a negative infinite
    /// radius, which culling always rejects, adds nothing to its cluster's sphere.
    ///
    /// # Panics
    /// When the spheres hold fewer than `rows` rows, or the clusters or the scratch have less room
    /// than `rows` needs.
    pub fn build(&mut self, spheres: SphereArrays<'_>, rows: u32, scratch: &mut ClusterScratch) {
        let n = rows as usize;
        let clusters = n.div_ceil(CLUSTER_ROWS as usize);
        assert!(
            n <= spheres.len(),
            "{n} rows asked for, the spheres hold {}",
            spheres.len()
        );
        assert!(
            clusters <= self.xs.len() && n <= scratch.codes.len(),
            "room for {} clusters and {} rows, fewer than {rows} rows need",
            self.xs.len(),
            scratch.codes.len()
        );
        let (xs, ys, zs, rs) = (
            &spheres.xs[..n],
            &spheres.ys[..n],
            &spheres.zs[..n],
            &spheres.radii[..n],
        );

        // The box around every finite centre, which the curve's grid spans.
        let mut lo = [f32::INFINITY; 3];
        let mut hi = [f32::NEG_INFINITY; 3];
        for i in 0..n {
            let centre = [xs[i], ys[i], zs[i]];
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
        // A float-to-integer cast saturates and turns NaN into 0, so every centre lands in the
        // grid.
        let cell = |v: f32, k: usize| (((v - lo[k]) * scale[k]) as u32).min(GRID_MAX);
        let codes = &mut scratch.codes[..n];
        for (i, code) in codes.iter_mut().enumerate() {
            *code = spread_bits(cell(xs[i], 0))
                | (spread_bits(cell(ys[i], 1)) << 1)
                | (spread_bits(cell(zs[i], 2)) << 2);
        }

        // Four stable passes of eight bits, from the lowest; the even count ends in `order`.
        let order = &mut self.order[..n];
        let (codes_back, order_back) = (&mut scratch.codes_back[..n], &mut scratch.order_back[..n]);
        radix_pass(0, codes, None, codes_back, order_back);
        radix_pass(8, codes_back, Some(order_back), codes, order);
        radix_pass(16, codes, Some(order), codes_back, order_back);
        radix_pass(24, codes_back, Some(order_back), codes, order);

        for c in 0..clusters {
            let start = c * CLUSTER_ROWS as usize;
            let members = &self.order[start..(start + CLUSTER_ROWS as usize).min(n)];
            let [x, y, z, r] = bounding_sphere(members, xs, ys, zs, rs);
            (self.xs[c], self.ys[c], self.zs[c], self.radii[c]) = (x, y, z, r);
        }
        self.order[n..clusters * CLUSTER_ROWS as usize].fill(NO_ROW);
        self.clusters = clusters as u32;
        self.rows = rows;
    }
}

/// Grows `v` to `len` entries of `fill`, or fails when memory cannot grow.
fn grow<T: Copy>(v: &mut Vec<T>, len: usize, fill: T) -> Result<(), TryReserveError> {
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

/// A sphere around the spheres of `rows`: centred in the box around their centres, with a margin
/// for the rounding of culling's plane tests.
fn bounding_sphere(rows: &[u32], xs: &[f32], ys: &[f32], zs: &[f32], rs: &[f32]) -> [f32; 4] {
    let mut lo = [f32::INFINITY; 3];
    let mut hi = [f32::NEG_INFINITY; 3];
    let mut unbounded = false;
    let mut any = false;
    for &row in rows {
        let r = row as usize;
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
    for &row in rows {
        let r = row as usize;
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
}

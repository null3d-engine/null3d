//! Clusters of rows against culling row by row: every row sits in exactly one cluster, each
//! cluster's sphere holds the spheres of its rows, and a cluster in view never leaves out a row in
//! view.

mod common;

use common::{Rng, frusta, random_spheres};
use null3d_core::clusters::{
    CLUSTER_ROWS, CellClusters, ClusterScratch, NO_ROW, RowCells, RowClusters, cluster_room,
};
use null3d_core::culling::{cull_spheres, cull_spheres_reference};
use null3d_core::world::SphereArrays;

/// Clusters over the first `rows` spheres, in one cell.
fn built(arrays: &[Vec<f32>; 4], rows: u32) -> RowClusters {
    built_in(arrays, rows, RowCells::One(0)).expect("rows in one cell always fit")
}

/// Clusters over the first `rows` spheres, in the cells given, or `None` when they do not fit.
fn built_in(arrays: &[Vec<f32>; 4], rows: u32, cells: RowCells<'_>) -> Option<RowClusters> {
    let mut clusters = RowClusters::default();
    let mut scratch = ClusterScratch::default();
    clusters.try_reserve(rows).unwrap();
    scratch.try_reserve(rows).unwrap();
    let [xs, ys, zs, rs] = arrays;
    let spheres = SphereArrays::new(xs, ys, zs, rs);
    clusters
        .build(spheres, rows, cells, &mut scratch)
        .then_some(clusters)
}

/// `count` spheres of radius 0.5 spread evenly through a cube 120 units wide.
fn even_spheres(count: usize, seed: u64) -> [Vec<f32>; 4] {
    let mut rng = Rng::new(seed);
    let mut axis = || {
        (0..count)
            .map(|_| rng.range(-60.0, 60.0))
            .collect::<Vec<_>>()
    };
    [axis(), axis(), axis(), vec![0.5; count]]
}

fn members(clusters: &RowClusters, cluster: usize) -> impl Iterator<Item = usize> + '_ {
    let rows = CLUSTER_ROWS as usize;
    clusters.order()[cluster * rows..(cluster + 1) * rows]
        .iter()
        .filter(|&&row| row != NO_ROW)
        .map(|&row| row as usize)
}

#[test]
fn every_row_sits_in_one_cluster_and_padding_ends_the_last() {
    for rows in [0u32, 1, 63, 64, 65, 1000, 4097] {
        let clusters = built(&random_spheres(rows as usize + 5, 11), rows);
        assert_eq!(clusters.len(), rows.div_ceil(CLUSTER_ROWS));
        assert_eq!(clusters.rows(), rows);
        let order = clusters.order();
        assert_eq!(order.len(), (clusters.len() * CLUSTER_ROWS) as usize);
        let mut seen = vec![false; rows as usize];
        for &row in &order[..rows as usize] {
            assert!(row < rows, "{rows} rows: entry {row}");
            assert!(!seen[row as usize], "{rows} rows: row {row} twice");
            seen[row as usize] = true;
        }
        assert!(order[rows as usize..].iter().all(|&row| row == NO_ROW));
    }
}

#[test]
fn each_cluster_sphere_holds_the_spheres_of_its_rows() {
    let arrays = random_spheres(20_000, 5);
    let [xs, ys, zs, rs] = &arrays;
    let clusters = built(&arrays, 20_000);
    let spheres = clusters.spheres();
    for c in 0..clusters.len() as usize {
        let radius = spheres.radii[c];
        for r in members(&clusters, c) {
            if rs[r] == f32::NEG_INFINITY {
                continue;
            }
            let finite = rs[r].is_finite() && xs[r].is_finite() && ys[r].is_finite();
            if !(finite && zs[r].is_finite()) {
                assert_eq!(
                    radius,
                    f32::INFINITY,
                    "cluster {c} holds row {r}, which has no bound"
                );
                continue;
            }
            let (dx, dy, dz) = (
                xs[r] - spheres.xs[c],
                ys[r] - spheres.ys[c],
                zs[r] - spheres.zs[c],
            );
            let reach = (dx * dx + dy * dy + dz * dz).sqrt() + rs[r];
            assert!(
                reach <= radius,
                "cluster {c} of radius {radius} misses row {r} at {reach}"
            );
        }
    }
}

#[test]
fn culling_clusters_keeps_every_row_that_culling_rows_keeps() {
    for arrays in [random_spheres(50_000, 9), even_spheres(50_000, 4)] {
        let [xs, ys, zs, rs] = &arrays;
        let clusters = built(&arrays, 50_000);
        let spheres = clusters.spheres();
        let mut rows_in_view = vec![0; 50_000];
        let mut clusters_in_view = vec![0; clusters.len() as usize];
        for (f, frustum) in frusta().iter().enumerate() {
            let n = cull_spheres_reference(frustum, xs, ys, zs, rs, 0..50_000, &mut rows_in_view);
            let m = cull_spheres(
                frustum,
                spheres.xs,
                spheres.ys,
                spheres.zs,
                spheres.radii,
                0..clusters.len(),
                &mut clusters_in_view,
            );
            let mut drawn = vec![false; 50_000];
            for &c in &clusters_in_view[..m] {
                for r in members(&clusters, c as usize) {
                    drawn[r] = true;
                }
            }
            for &row in &rows_in_view[..n] {
                assert!(
                    drawn[row as usize],
                    "frustum {f}: row {row} is in view, its cluster is not"
                );
            }
        }
    }
}

#[test]
fn clusters_of_evenly_spread_rows_are_compact() {
    let clusters = built(&even_spheres(100_000, 21), 100_000);
    let radii = clusters.spheres().radii;
    let mean = radii.iter().sum::<f32>() / radii.len() as f32;
    // 64 of 100,000 rows spread evenly through the cube fill a cube about 10 units wide, whose
    // corners are under 9 units from its centre; the whole cube's corners are 104 units away.
    assert!(mean < 15.0, "the mean cluster radius is {mean}");
}

#[test]
fn a_rebuild_over_fewer_rows_leaves_out_the_rest() {
    let arrays = even_spheres(1000, 2);
    let mut clusters = built(&arrays, 1000);
    let mut scratch = ClusterScratch::default();
    scratch.try_reserve(1000).unwrap();
    let [xs, ys, zs, rs] = &arrays;
    let spheres = SphereArrays::new(xs, ys, zs, rs);
    assert!(clusters.build(spheres, 100, RowCells::One(0), &mut scratch));
    assert_eq!(clusters.len(), 2);
    assert_eq!(clusters.rows(), 100);
    assert!(clusters.order()[..100].iter().all(|&row| row < 100));
    assert!(clusters.order()[100..].iter().all(|&row| row == NO_ROW));
}

#[test]
#[should_panic(expected = "room for")]
fn building_without_room_panics() {
    let arrays = even_spheres(100, 3);
    let mut clusters = RowClusters::default();
    let [xs, ys, zs, rs] = &arrays;
    clusters.build(
        SphereArrays::new(xs, ys, zs, rs),
        100,
        RowCells::One(0),
        &mut ClusterScratch::default(),
    );
}

/// Each row's cell: rows fall into `cells` cells in blocks of uneven size, cell indices
/// scattered, so that every cell's last cluster is only partly full.
fn scattered_cells(rows: usize, cells: u32, seed: u64) -> Vec<u32> {
    let mut rng = Rng::new(seed);
    (0..rows)
        .map(|_| (rng.range(0.0, cells as f32) as u32).min(cells - 1) * 7 % 509)
        .collect()
}

#[test]
fn clusters_form_inside_cells_and_each_cell_has_one_run() {
    const ROWS: usize = 20_000;
    let arrays = random_spheres(ROWS, 17);
    let cells = scattered_cells(ROWS, 40, 3);
    let clusters = built_in(&arrays, ROWS as u32, RowCells::Each(&cells)).unwrap();
    let runs = clusters.cells();
    // The runs follow each other, in increasing cell index, and cover every cluster.
    assert_eq!(runs.first().map(|run| run.start), Some(0));
    assert_eq!(runs.last().map(|run| run.end), Some(clusters.len()));
    assert!(
        runs.windows(2)
            .all(|w| w[0].end == w[1].start && w[0].cell < w[1].cell)
    );
    let mut seen = vec![false; ROWS];
    for &CellClusters { cell, start, end } in runs {
        let rows_in_cell = cells.iter().filter(|&&c| c == cell).count();
        assert_eq!(
            (end - start) as usize,
            rows_in_cell.div_ceil(CLUSTER_ROWS as usize)
        );
        for c in start..end {
            for r in members(&clusters, c as usize) {
                assert_eq!(cells[r], cell, "cluster {c} of cell {cell} holds row {r}");
                assert!(!seen[r], "row {r} twice");
                seen[r] = true;
            }
        }
    }
    assert!(seen.iter().all(|&s| s), "every row sits in a cluster");
    // Rows in one cell alone build as they do with that cell given for all.
    let same = vec![5; ROWS];
    let alone = built_in(&arrays, ROWS as u32, RowCells::Each(&same)).unwrap();
    let whole = built(&arrays, ROWS as u32);
    assert_eq!(alone.order(), whole.order());
    assert_eq!(
        alone.cells(),
        [CellClusters {
            cell: 5,
            start: 0,
            end: whole.len()
        }]
    );
}

#[test]
fn clusters_inside_cells_keep_every_row_in_view_of_their_cell() {
    const ROWS: usize = 30_000;
    let arrays = random_spheres(ROWS, 23);
    let [xs, ys, zs, rs] = &arrays;
    let cells = scattered_cells(ROWS, 12, 8);
    let clusters = built_in(&arrays, ROWS as u32, RowCells::Each(&cells)).unwrap();
    let spheres = clusters.spheres();
    let mut rows_in_view = vec![0; ROWS];
    let mut clusters_in_view = vec![0; clusters.len() as usize];
    for frustum in frusta() {
        let n = cull_spheres_reference(&frustum, xs, ys, zs, rs, 0..ROWS as u32, &mut rows_in_view);
        let m = cull_spheres(
            &frustum,
            spheres.xs,
            spheres.ys,
            spheres.zs,
            spheres.radii,
            0..clusters.len(),
            &mut clusters_in_view,
        );
        let mut drawn = vec![false; ROWS];
        for &c in &clusters_in_view[..m] {
            members(&clusters, c as usize).for_each(|r| drawn[r] = true);
        }
        assert!(rows_in_view[..n].iter().all(|&row| drawn[row as usize]));
    }
}

#[test]
fn rows_spread_too_thinly_over_cells_build_no_clusters() {
    // 256 rows, one per cell, need 256 clusters; the room is 8.
    let arrays = random_spheres(256, 29);
    let cells: Vec<u32> = (0..256).collect();
    assert_eq!(cluster_room(256), 8);
    assert!(built_in(&arrays, 256, RowCells::Each(&cells)).is_none());
    // Four cells need at most eight clusters, which fit.
    let few: Vec<u32> = (0..256).map(|row| row % 4).collect();
    let clusters = built_in(&arrays, 256, RowCells::Each(&few)).unwrap();
    assert_eq!(clusters.len(), 4);
    assert_eq!(clusters.cells().len(), 4);
}

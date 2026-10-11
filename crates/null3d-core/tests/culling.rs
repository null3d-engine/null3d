//! SIMD culling against the scalar reference: random spheres under several frusta, spheres on
//! plane boundaries, and the parallel version with 0 to 8 job workers.

mod common;

use common::{Rng, Workers, frusta, orthographic, perspective, random_spheres};
use null3d_core::cells::CELL_SHIFT;
use null3d_core::culling::{
    BY_ROW, BucketedCull, CULL_CHUNK, CullOutput, CullRun, CullSet, CullView, Frustum, NO_BUCKET,
    ROW_CELLS, SetLayers, SetOrder, cull_into_buckets, cull_parallel, cull_spheres,
    cull_spheres_in_cells, cull_spheres_reference,
};
use null3d_core::layers::{ALL_LAYERS, DEFAULT_LAYERS};
use null3d_core::world::SphereArrays;

#[test]
fn simd_matches_the_scalar_reference_on_100k_random_spheres() {
    let [xs, ys, zs, rs] = random_spheres(100_000, 3);
    let mut simd = vec![0; xs.len()];
    let mut scalar = vec![0; xs.len()];
    let mut total_visible = 0;
    for (f, frustum) in frusta().iter().enumerate() {
        for range in [0..100_000, 1..99_999, 17..40_018, 99_990..100_000, 5..5] {
            let a = cull_spheres(frustum, &xs, &ys, &zs, &rs, range.clone(), &mut simd);
            let b = cull_spheres_reference(frustum, &xs, &ys, &zs, &rs, range.clone(), &mut scalar);
            assert_eq!(a, b, "frustum {f}, range {range:?}");
            assert_eq!(simd[..a], scalar[..b], "frustum {f}, range {range:?}");
            assert!(simd[..a].windows(2).all(|w| w[0] < w[1]));
            assert!(simd[..a].iter().all(|i| range.contains(i)));
            if range == (0..100_000) {
                total_visible += a;
                // Every frustum sees some spheres and misses some.
                assert!(a > 0 && a < 100_000, "frustum {f} sees {a} spheres");
            }
        }
    }
    assert!(total_visible > 0);
}

#[test]
fn spheres_on_plane_boundaries() {
    // Every plane of this box is exact in binary: x in [-8, 8], y in [-4, 4], z in [-33, -1].
    let frustum = Frustum::from_view_projection(&orthographic(-8.0, 8.0, -4.0, 4.0, 1.0, 33.0));
    let planes = frustum.planes();
    assert_eq!(planes[0], [1.0, 0.0, 0.0, 8.0]);
    assert_eq!(planes[5], [0.0, 0.0, 1.0, 33.0]);
    // The next float away from zero. Each step-out case below is exact in f32: the sum lands
    // a whole unit of the last place past the plane, so rounding cannot bring it back.
    let above = |v: f32| f32::from_bits(v.to_bits() + 1);
    // (x, y, z, r, visible)
    let cases = [
        (8.5, 0.0, -10.0, 0.5, true), // touches the right plane from outside
        (above(8.5), 0.0, -10.0, 0.5, false), // one step further out
        (-8.0, 0.0, -10.0, 0.0, true), // a point on the left plane
        (-above(8.0), 0.0, -10.0, 0.0, false),
        (0.0, 4.25, -10.0, 0.25, true), // touches the top plane
        (0.0, -above(4.25), -10.0, 0.25, false),
        (0.0, 0.0, -0.5, 0.5, true), // touches the near plane
        (0.0, 0.0, -(0.5 - f32::EPSILON / 2.0), 0.5, false),
        (0.0, 0.0, -34.0, 1.0, true), // touches the far plane
        (0.0, 0.0, -above(34.0), 1.0, false),
        (0.0, 0.0, -10.0, -0.0, true), // negative zero radius
        (0.0, 0.0, -10.0, f32::NEG_INFINITY, false), // hidden
        (0.0, 0.0, -10.0, f32::INFINITY, true),
        (f32::NAN, 0.0, -10.0, 1.0, false),
        (1000.0, 0.0, -10.0, f32::INFINITY, true),
    ];
    // Pad to an odd count so both the SIMD loop and the scalar tail see boundary cases.
    let n = cases.len();
    let xs: Vec<f32> = cases.iter().map(|c| c.0).collect();
    let ys: Vec<f32> = cases.iter().map(|c| c.1).collect();
    let zs: Vec<f32> = cases.iter().map(|c| c.2).collect();
    let rs: Vec<f32> = cases.iter().map(|c| c.3).collect();
    let expected: Vec<u32> = (0..n as u32).filter(|&i| cases[i as usize].4).collect();
    for start in 0..4 {
        let mut simd = vec![0; n];
        let mut scalar = vec![0; n];
        let range = start..n as u32;
        let a = cull_spheres(&frustum, &xs, &ys, &zs, &rs, range.clone(), &mut simd);
        let b = cull_spheres_reference(&frustum, &xs, &ys, &zs, &rs, range, &mut scalar);
        let want: Vec<u32> = expected.iter().copied().filter(|&i| i >= start).collect();
        assert_eq!(simd[..a], want[..], "start {start}");
        assert_eq!(scalar[..b], want[..], "start {start}");
    }
}

#[test]
fn parallel_culling_matches_the_reference_for_0_to_8_workers() {
    let [xs, ys, zs, rs] = random_spheres(100_003, 11);
    let frusta = frusta();
    let mut expected = vec![0; xs.len()];
    for workers in [0, 1, 2, 3, 4, 8] {
        let pool = Workers::start(workers);
        let mut out = CullOutput::with_capacity(xs.len() as u32);
        for count in [0usize, 1, 5, 4096, 4097, 100_003] {
            let spheres = SphereArrays::new(&xs[..count], &ys[..count], &zs[..count], &rs[..count]);
            for (f, frustum) in frusta.iter().enumerate() {
                let n = cull_parallel(pool.jobs(), frustum, spheres, &mut out);
                let m = cull_spheres_reference(
                    frustum,
                    &xs,
                    &ys,
                    &zs,
                    &rs,
                    0..count as u32,
                    &mut expected,
                );
                assert_eq!(n, out.len());
                assert_eq!(
                    out.visible(),
                    &expected[..m],
                    "{workers} workers, {count} spheres, frustum {f}"
                );
            }
        }
    }
}

/// Offsets from the camera to four cells, which the tests spread spheres over.
const OFFSETS: [[f32; 4]; 4] = [
    [0.0; 4],
    [-12.0, 0.0, 0.0, 0.0],
    [0.0, 3.0, 10.0, 0.0],
    [5.0, -3.0, -20.0, 0.0],
];

/// Splits rows `0..rows` of a set into runs of at most one culling chunk, in one cell or each row
/// in its own.
fn runs_of(set: u32, rows: u32, bucket: u32, base: u32, cell: u32, out: &mut Vec<CullRun>) {
    let mut start = 0;
    while start < rows {
        let end = (start + CULL_CHUNK).min(rows);
        out.push(CullRun {
            set,
            start,
            end,
            bucket,
            base,
            cell,
        });
        start = end;
    }
}

/// The list [`cull_into_buckets`] must make, one run and one row at a time: every visible entry
/// on the view's layers in bucket order, and within a bucket in run order and row order. A run in
/// one cell tests its spheres against the frustum moved into the cell; a run whose rows lie in
/// different cells moves each sphere by its cell's offset.
fn bucketed_reference(
    view: CullView<'_>,
    sets: &[[Vec<f32>; 4]],
    cells: &[Vec<u32>],
    layers: &[SetLayers<'_>],
    runs: &[CullRun],
    row_buckets: &[u32],
    buckets: u32,
) -> (Vec<u32>, Vec<u32>) {
    let frustum = view.frustum;
    let mut by_bucket = vec![Vec::new(); buckets as usize];
    for run in runs {
        let [xs, ys, zs, rs] = &sets[run.set as usize];
        for row in run.start..run.end {
            let r = row as usize;
            let mask = match layers[run.set as usize] {
                SetLayers::All(mask) => mask,
                SetLayers::Rows(masks) => masks[r],
            };
            let (cell, visible) = if run.cell == ROW_CELLS {
                let cell = cells[run.set as usize][r];
                let [x, y, z, _] = OFFSETS[cell as usize];
                let visible = frustum.contains_sphere(xs[r] + x, ys[r] + y, zs[r] + z, rs[r]);
                (cell, visible)
            } else {
                let [x, y, z, _] = OFFSETS[run.cell as usize];
                let moved = frustum.moved_by([x, y, z]);
                (run.cell, moved.contains_sphere(xs[r], ys[r], zs[r], rs[r]))
            };
            let bucket = if run.bucket == BY_ROW {
                row_buckets[r]
            } else {
                run.bucket
            };
            if visible && bucket != NO_BUCKET && mask & view.layers != 0 {
                by_bucket[bucket as usize].push(row + run.base + (cell << CELL_SHIFT));
            }
        }
    }
    let mut starts = vec![0];
    for list in &by_bucket {
        starts.push(starts.last().unwrap() + list.len() as u32);
    }
    (by_bucket.concat(), starts)
}

#[test]
fn bucketed_culling_matches_the_reference_for_0_to_8_workers() {
    const BUCKETS: u32 = 7;
    // A scene whose rows look up their buckets, some drawing nowhere, and two batches that each
    // fill one bucket. The scene's rows and the first batch's lie in different cells; the second
    // batch lies in one cell. The first batch is long enough that the copy pass runs in parallel.
    // The scene's rows have layer masks of their own, and each batch has one mask for its rows.
    let sets = [
        random_spheres(10_001, 21),
        random_spheres(90_000, 22),
        random_spheres(4_099, 23),
    ];
    let mut rng = Rng::new(24);
    let row_buckets: Vec<u32> = (0..10_001)
        .map(|_| match rng.below(10) {
            0 => NO_BUCKET,
            _ => rng.below(BUCKETS),
        })
        .collect();
    let mut cells: Vec<Vec<u32>> = [10_001, 90_000]
        .iter()
        .map(|&n| (0..n).map(|_| rng.below(OFFSETS.len() as u32)).collect())
        .collect();
    cells.push(vec![2; 4_099]);
    let masks = [0, DEFAULT_LAYERS, 2, 3, 1 << 31, ALL_LAYERS];
    let scene_layers: Vec<u32> = (0..10_001)
        .map(|_| masks[rng.below(masks.len() as u32) as usize])
        .collect();
    let layers = [
        SetLayers::Rows(&scene_layers),
        SetLayers::All(DEFAULT_LAYERS),
        SetLayers::All(2),
    ];
    let mut runs = Vec::new();
    runs_of(0, 10_001, BY_ROW, 0, ROW_CELLS, &mut runs);
    runs_of(1, 90_000, 3, 20_000, ROW_CELLS, &mut runs);
    runs.push(CullRun {
        set: 2,
        start: 7,
        end: 7,
        bucket: 5,
        base: 0,
        cell: 2,
    });
    runs_of(2, 4_099, 3, 200_000, 2, &mut runs);
    let by_row = runs.iter().filter(|r| r.bucket == BY_ROW).count() as u32;
    let rows: u32 = runs.iter().map(|r| r.end - r.start).sum();
    let set = |set: u32| {
        let [xs, ys, zs, rs] = &sets[set as usize];
        CullSet {
            spheres: SphereArrays::new(xs, ys, zs, rs),
            cells: &cells[set as usize],
            order: SetOrder::Rows,
            layers: layers[set as usize],
        }
    };
    // The usual frusta, and one that culls nothing, so the list is long enough for the parallel
    // copy. Each is seen on every layer, on the default layer alone, and on two layers that leave
    // out the first batch's.
    let mut frusta = frusta();
    frusta.push(Frustum::from_planes([[0.0; 4]; 6]));
    let views: Vec<CullView<'_>> = frusta
        .iter()
        .flat_map(|frustum| {
            [ALL_LAYERS, DEFAULT_LAYERS, 2 | 1 << 31].map(|layers| CullView {
                frustum,
                offsets: &OFFSETS,
                layers,
                occlusion: None,
            })
        })
        .collect();
    for workers in [0, 1, 2, 3, 4, 8] {
        let pool = Workers::start(workers);
        let mut out = BucketedCull::default();
        out.try_reserve(rows, runs.len() as u32, by_row, BUCKETS)
            .unwrap();
        let mut longest = 0;
        for (v, &view) in views.iter().enumerate() {
            let n = cull_into_buckets(
                pool.jobs(),
                view,
                &set,
                &runs,
                &row_buckets,
                BUCKETS,
                None,
                &mut out,
            );
            let (entries, starts) =
                bucketed_reference(view, &sets, &cells, &layers, &runs, &row_buckets, BUCKETS);
            assert_eq!(n, entries.len(), "{workers} workers, view {v}");
            assert_eq!(out.indices(), &entries[..], "{workers} workers, view {v}");
            assert_eq!(
                out.bucket_starts(),
                &starts[..],
                "{workers} workers, view {v}"
            );
            longest = longest.max(n);
        }
        assert!(
            longest > 1 << 15,
            "no view made a long list: {longest} entries"
        );
    }
}

#[test]
fn spheres_in_cells_cull_like_spheres_moved_by_their_offsets() {
    let [xs, ys, zs, rs] = random_spheres(10_003, 31);
    let mut rng = Rng::new(32);
    let cells: Vec<u32> = (0..xs.len())
        .map(|_| rng.below(OFFSETS.len() as u32))
        .collect();
    let moved: [Vec<f32>; 3] = std::array::from_fn(|k| {
        let axis = [&xs, &ys, &zs][k];
        axis.iter()
            .zip(&cells)
            .map(|(v, &cell)| v + OFFSETS[cell as usize][k])
            .collect()
    });
    let spheres = SphereArrays::new(&xs, &ys, &zs, &rs);
    for (f, frustum) in frusta().iter().enumerate() {
        for range in [0..10_003, 3..10_001, 9_999..10_003] {
            let mut simd = vec![0; xs.len()];
            let mut scalar = vec![0; xs.len()];
            let a =
                cull_spheres_in_cells(frustum, spheres, &cells, &OFFSETS, range.clone(), &mut simd);
            let [mx, my, mz] = &moved;
            let b = cull_spheres_reference(frustum, mx, my, mz, &rs, range.clone(), &mut scalar);
            assert_eq!(simd[..a], scalar[..b], "frustum {f}, range {range:?}");
        }
    }
}

#[test]
fn runs_through_a_list_of_rows_list_the_rows_that_culling_each_row_keeps() {
    const ROWS: usize = 12_345;
    let arrays = random_spheres(ROWS, 41);
    let [xs, ys, zs, rs] = &arrays;
    let mut rng = Rng::new(42);
    let cells: Vec<u32> = (0..ROWS).map(|_| rng.below(OFFSETS.len() as u32)).collect();
    // Each row on layer 0, layer 1 or both; the view draws layer 0.
    let masks: Vec<u32> = (0..ROWS).map(|_| 1 + rng.below(3)).collect();
    // Two rows in three, in a shuffled order, and copies of their spheres in that order.
    let mut list: Vec<u32> = (0..ROWS as u32).filter(|row| row % 3 != 1).collect();
    for i in (1..list.len()).rev() {
        list.swap(i, rng.below(i as u32 + 1) as usize);
    }
    let copies: [Vec<f32>; 4] =
        std::array::from_fn(|k| list.iter().map(|&row| arrays[k][row as usize]).collect());
    let spheres = SphereArrays::new(xs, ys, zs, rs);
    let copied = SphereArrays::new(&copies[0], &copies[1], &copies[2], &copies[3]);
    let positions = list.len() as u32;
    // Each run covers all the list's positions: the copies in one cell, and the gathered rows each
    // in its own cell.
    let run = |set: u32, cell: u32| CullRun {
        set,
        start: 0,
        end: positions,
        bucket: 0,
        base: 0,
        cell,
    };
    let jobs = null3d_core::jobs::JobSystem::new(0);
    for frustum in frusta() {
        for (set, order, cell) in [
            (0, SetOrder::Copied(&list), 2),
            (1, SetOrder::Gathered(&list), ROW_CELLS),
        ] {
            let spheres = if set == 0 { copied } else { spheres };
            let mut out = BucketedCull::default();
            out.try_reserve(positions, 1, 0, 1).unwrap();
            let sets = |_| CullSet {
                spheres,
                cells: &cells,
                order,
                layers: SetLayers::Rows(&masks),
            };
            let view = CullView {
                frustum: &frustum,
                offsets: &OFFSETS,
                layers: 0b1,
                occlusion: None,
            };
            let n = cull_into_buckets(
                &jobs,
                view,
                &sets,
                &[run(set, cell)],
                &[],
                1,
                None,
                &mut out,
            );
            // The reference tests each listed row on the view's layer where it lies, in the list's
            // order.
            let expected: Vec<u32> = list
                .iter()
                .filter(|&&row| masks[row as usize] & 0b1 != 0)
                .filter(|&&row| {
                    let r = row as usize;
                    let at = if cell == ROW_CELLS { cells[r] } else { cell };
                    let [x, y, z, _] = OFFSETS[at as usize];
                    if cell == ROW_CELLS {
                        frustum.contains_sphere(xs[r] + x, ys[r] + y, zs[r] + z, rs[r])
                    } else {
                        frustum
                            .moved_by([x, y, z])
                            .contains_sphere(xs[r], ys[r], zs[r], rs[r])
                    }
                })
                .map(|&row| {
                    let at = if cell == ROW_CELLS {
                        cells[row as usize]
                    } else {
                        cell
                    };
                    row | (at << CELL_SHIFT)
                })
                .collect();
            assert_eq!(n, expected.len(), "{order:?}, cell {cell}");
            assert_eq!(out.indices(), &expected[..], "cell {cell}");
        }
    }
}

#[test]
#[should_panic(expected = "one cell")]
fn a_run_of_copied_spheres_in_several_cells_panics() {
    let v = vec![0.0; 8];
    let list: Vec<u32> = (0..8).collect();
    let run = CullRun {
        set: 0,
        start: 0,
        end: 8,
        bucket: 0,
        base: 0,
        cell: ROW_CELLS,
    };
    let mut out = BucketedCull::default();
    out.try_reserve(8, 1, 0, 1).unwrap();
    let frustum = Frustum::from_view_projection(&perspective(1.0, 1.0, 0.1, 10.0));
    let view = CullView {
        frustum: &frustum,
        offsets: &OFFSETS,
        layers: ALL_LAYERS,
        occlusion: None,
    };
    cull_into_buckets(
        &null3d_core::jobs::JobSystem::new(0),
        view,
        &|_| CullSet {
            spheres: SphereArrays::new(&v, &v, &v, &v),
            cells: &[0; 8],
            order: SetOrder::Copied(&list),
            layers: SetLayers::All(ALL_LAYERS),
        },
        &[run],
        &[],
        1,
        None,
        &mut out,
    );
}

#[test]
fn a_frustum_moved_into_a_cell_sees_what_the_camera_sees() {
    let [xs, ys, zs, rs] = random_spheres(20_000, 33);
    for frustum in frusta() {
        for [x, y, z, _] in OFFSETS {
            let moved = frustum.moved_by([x, y, z]);
            for i in 0..xs.len() {
                let (cx, cy, cz, r) = (xs[i], ys[i], zs[i], rs[i]);
                let camera = frustum.contains_sphere(cx + x, cy + y, cz + z, r);
                if moved.contains_sphere(cx, cy, cz, r) == camera {
                    continue;
                }
                // The two may differ by rounding only, for a sphere that grazes a plane.
                let grazes = frustum.planes().iter().any(|p| {
                    let d = f64::from(p[0]) * f64::from(cx + x)
                        + f64::from(p[1]) * f64::from(cy + y)
                        + f64::from(p[2]) * f64::from(cz + z)
                        + f64::from(p[3]);
                    (d + f64::from(r)).abs() < 1e-4
                });
                assert!(grazes, "sphere {i} at offset {:?}", [x, y, z]);
            }
        }
    }
}

#[test]
#[should_panic(expected = "fewer than")]
fn a_bucketed_output_without_room_for_the_runs_panics() {
    let v = vec![0.0; 10];
    let frustum = Frustum::from_view_projection(&perspective(1.0, 1.0, 0.1, 10.0));
    let run = CullRun {
        set: 0,
        start: 0,
        end: 10,
        bucket: 0,
        base: 0,
        cell: 0,
    };
    let view = CullView {
        frustum: &frustum,
        offsets: &OFFSETS,
        layers: ALL_LAYERS,
        occlusion: None,
    };
    cull_into_buckets(
        &null3d_core::jobs::JobSystem::new(0),
        view,
        &|_| CullSet {
            spheres: SphereArrays::new(&v, &v, &v, &v),
            cells: &[],
            order: SetOrder::Rows,
            layers: SetLayers::All(DEFAULT_LAYERS),
        },
        &[run],
        &[],
        1,
        None,
        &mut BucketedCull::default(),
    );
}

#[test]
#[should_panic(expected = "fewer than")]
fn a_short_output_panics() {
    let v = vec![0.0; 10];
    let frustum = Frustum::from_view_projection(&perspective(1.0, 1.0, 0.1, 10.0));
    let mut out = CullOutput::with_capacity(5);
    cull_parallel(
        &null3d_core::jobs::JobSystem::new(0),
        &frustum,
        SphereArrays::new(&v, &v, &v, &v),
        &mut out,
    );
}

/// Rows of one sphere each, of radius 1 and scale 1, straight ahead of the camera at `distances`,
/// culled into a mesh's three levels and their fade buckets: buckets 0 to 2 are the levels, 3 to 5
/// their fade buckets. Returns each bucket's words.
fn cull_levels(distances: &[f32], by_row: bool, band: f32) -> Vec<Vec<u32>> {
    use null3d_core::culling::{LevelChoice, LevelRows, RowCells, RowRadii};
    use null3d_core::levels::{LevelLink, LevelRule, NO_LINK};
    let n = distances.len();
    let (xs, ys) = (vec![0.0; n], vec![0.0; n]);
    let zs: Vec<f32> = distances.iter().map(|d| -d).collect();
    let rs = vec![1.0; n];
    let spheres = SphereArrays::new(&xs, &ys, &zs, &rs);
    let frustum = Frustum::from_view_projection(&perspective(1.0, 1.0, 0.1, 1000.0));
    let view = CullView {
        frustum: &frustum,
        offsets: &OFFSETS,
        layers: ALL_LAYERS,
        occlusion: None,
    };
    // Level 1 switches in past 5 m and level 2 past 20 m, with a factor of 100.
    let link = |error: f32, next: u32, fade: u32| LevelLink { error, next, fade };
    let links = [
        link(0.0, 1, 3),
        link(0.05, 2, 4),
        link(0.2, NO_LINK, 5),
        LevelLink::NONE,
        LevelLink::NONE,
        LevelLink::NONE,
    ];
    let rows = |_| LevelRows {
        spheres,
        cells: RowCells::One(0),
        radii: RowRadii::One(1.0),
    };
    let choice = LevelChoice {
        rule: LevelRule {
            factor: 100.0,
            orthographic: false,
            band,
        },
        links: &links,
        rows: &rows,
    };
    let run = CullRun {
        set: 0,
        start: 0,
        end: n as u32,
        bucket: if by_row { BY_ROW } else { 0 },
        base: 0,
        cell: 0,
    };
    let row_buckets = vec![0; n];
    let mut out = BucketedCull::default();
    out.try_reserve(4 * n as u32, 1, 1, 6).unwrap();
    cull_into_buckets(
        &null3d_core::jobs::JobSystem::new(0),
        view,
        &|_| CullSet {
            spheres,
            cells: &[],
            order: SetOrder::Rows,
            layers: SetLayers::All(DEFAULT_LAYERS),
        },
        &[run],
        &row_buckets,
        6,
        Some(&choice),
        &mut out,
    );
    let starts = out.bucket_starts();
    (0..6)
        .map(|b| out.indices()[starts[b] as usize..starts[b + 1] as usize].to_vec())
        .collect()
}

#[test]
fn rows_pick_the_level_their_distance_and_scale_give() {
    let distances = [3.0, 4.9, 8.0, 19.0, 30.0, 400.0];
    for by_row in [false, true] {
        let buckets = cull_levels(&distances, by_row, 0.0);
        assert_eq!(
            buckets[0],
            [0, 1],
            "rows nearer than 5 m draw the base level"
        );
        assert_eq!(buckets[1], [2, 3], "rows from 5 m to 20 m draw level 1");
        assert_eq!(buckets[2], [4, 5], "rows past 20 m draw level 2");
        assert!(buckets[3..].iter().all(Vec::is_empty), "no band, no fade");
    }
}

#[test]
fn rows_inside_a_band_list_pairs_in_both_levels_fade_buckets() {
    // 5.375 m lies halfway through level 1's band, and 21.2 m two fifths into level 2's.
    let distances = [5.375, 8.0, 21.2];
    let buckets = cull_levels(&distances, true, 0.15);
    let bits = |word: u32| f32::from_bits(word);
    assert!(buckets[0].is_empty() && buckets[2].is_empty());
    assert_eq!(buckets[1], [1]);
    // Each fade bucket holds the row, then its fade value: positive for the new level, negative
    // for the old one.
    let (old, new) = (&buckets[3], &buckets[4]);
    assert_eq!((old.len(), new.len()), (2, 4));
    assert_eq!((new[0], old[0]), (0, 0));
    assert!((bits(new[1]) - 0.5).abs() < 1e-3 && (bits(old[1]) + 0.5).abs() < 1e-3);
    let fading = &buckets[5];
    assert_eq!((fading[0], new[2]), (2, 2));
    assert!((bits(fading[1]) - 0.4).abs() < 1e-3 && (bits(new[3]) + 0.4).abs() < 1e-3);
}

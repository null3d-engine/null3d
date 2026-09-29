//! SIMD culling against the scalar reference: random spheres under several frusta, spheres on
//! plane boundaries, and the parallel version with 0 to 8 job workers.

mod common;

use common::{Rng, Workers, frusta, orthographic, perspective, random_spheres};
use null3d_core::culling::{
    BY_ROW, BucketedCull, CULL_CHUNK, CullOutput, CullRun, Frustum, NO_BUCKET, cull_into_buckets,
    cull_parallel, cull_spheres, cull_spheres_reference,
};
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

/// Splits rows `0..rows` of a set into runs of at most one culling chunk.
fn runs_of(set: u32, rows: u32, bucket: u32, base: u32, out: &mut Vec<CullRun>) {
    let mut start = 0;
    while start < rows {
        let end = (start + CULL_CHUNK).min(rows);
        out.push(CullRun {
            set,
            start,
            end,
            bucket,
            base,
        });
        start = end;
    }
}

/// The list [`cull_into_buckets`] must make, one run and one row at a time: every visible entry
/// in bucket order, and within a bucket in run order and row order.
fn bucketed_reference(
    frustum: &Frustum,
    sets: &[[Vec<f32>; 4]],
    runs: &[CullRun],
    row_buckets: &[u32],
    buckets: u32,
) -> (Vec<u32>, Vec<u32>) {
    let mut by_bucket = vec![Vec::new(); buckets as usize];
    for run in runs {
        let [xs, ys, zs, rs] = &sets[run.set as usize];
        let mut visible = vec![0; xs.len()];
        let n = cull_spheres_reference(frustum, xs, ys, zs, rs, run.start..run.end, &mut visible);
        for &row in &visible[..n] {
            let bucket = if run.bucket == BY_ROW {
                row_buckets[row as usize]
            } else {
                run.bucket
            };
            if bucket != NO_BUCKET {
                by_bucket[bucket as usize].push(row + run.base);
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
    // fill one bucket. The first batch is long enough that the copy pass runs in parallel.
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
    let mut runs = Vec::new();
    runs_of(0, 10_001, BY_ROW, 0, &mut runs);
    runs_of(1, 90_000, 3, 20_000, &mut runs);
    runs.push(CullRun {
        set: 2,
        start: 7,
        end: 7,
        bucket: 5,
        base: 0,
    });
    runs_of(2, 4_099, 3, 200_000, &mut runs);
    let by_row = runs.iter().filter(|r| r.bucket == BY_ROW).count() as u32;
    let rows: u32 = runs.iter().map(|r| r.end - r.start).sum();
    let spheres = |set: u32| {
        let [xs, ys, zs, rs] = &sets[set as usize];
        SphereArrays::new(xs, ys, zs, rs)
    };
    // The usual views, and one that culls nothing, so the list is long enough for the parallel
    // copy.
    let mut views = frusta();
    views.push(Frustum::from_planes([[0.0; 4]; 6]));
    for workers in [0, 1, 2, 3, 4, 8] {
        let pool = Workers::start(workers);
        let mut out = BucketedCull::default();
        out.try_reserve(rows, runs.len() as u32, by_row, BUCKETS)
            .unwrap();
        let mut longest = 0;
        for (f, frustum) in views.iter().enumerate() {
            let n = cull_into_buckets(
                pool.jobs(),
                frustum,
                &spheres,
                &runs,
                &row_buckets,
                BUCKETS,
                &mut out,
            );
            let (entries, starts) =
                bucketed_reference(frustum, &sets, &runs, &row_buckets, BUCKETS);
            assert_eq!(n, entries.len(), "{workers} workers, frustum {f}");
            assert_eq!(
                out.indices(),
                &entries[..],
                "{workers} workers, frustum {f}"
            );
            assert_eq!(
                out.bucket_starts(),
                &starts[..],
                "{workers} workers, frustum {f}"
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
    };
    cull_into_buckets(
        &null3d_core::jobs::JobSystem::new(0),
        &frustum,
        &|_| SphereArrays::new(&v, &v, &v, &v),
        &[run],
        &[],
        1,
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

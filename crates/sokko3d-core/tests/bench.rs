//! Benchmarks, ignored by default. Run them with:
//!
//! ```text
//! cargo test -p sokko3d-core --release --test bench -- --ignored --nocapture --test-threads=1
//! ```
//!
//! Each figure is the fastest of several timed runs, which filters out interference from other
//! processes. "Threads" counts the calling thread plus the job workers.
#![allow(clippy::disallowed_methods)] // Benchmarks read the clock and start threads.

mod common;

use std::hint::black_box;
use std::time::{Duration, Instant};

use common::{Rng, Workers};
use sokko3d_core::culling::{
    CullOutput, Frustum, cull_parallel, cull_spheres, cull_spheres_reference,
};
use sokko3d_core::world::SphereArrays;

/// Job worker counts, as (job workers, threads) pairs.
const THREAD_COUNTS: [(u32, u32); 4] = [(0, 1), (1, 2), (3, 4), (7, 8)];

/// The fastest time of `runs` calls of `f`, after at least 100 ms of warm-up calls, so the
/// core reaches its full clock speed first.
fn fastest(runs: u32, mut f: impl FnMut()) -> Duration {
    let warm_up = Instant::now();
    while warm_up.elapsed() < Duration::from_millis(100) {
        f();
    }
    (0..runs)
        .map(|_| {
            let start = Instant::now();
            f();
            start.elapsed()
        })
        .min()
        .unwrap()
}

fn micros(d: Duration) -> f64 {
    d.as_secs_f64() * 1e6
}

/// A perspective frustum looking down -Z from 150 units away, at a cube of random spheres, so
/// about a third of them are visible.
fn bench_scene(count: usize) -> ([Vec<f32>; 4], Frustum) {
    let mut rng = Rng::new(5);
    let mut arrays: [Vec<f32>; 4] = Default::default();
    for _ in 0..count {
        arrays[0].push(rng.range(-100.0, 100.0));
        arrays[1].push(rng.range(-100.0, 100.0));
        arrays[2].push(rng.range(-100.0, 100.0));
        arrays[3].push(rng.range(0.1, 2.0));
    }
    let (near, far, f) = (0.5f32, 400.0f32, 1.0 / 0.5f32.tan());
    let mut m = [0.0; 16];
    m[0] = f;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1.0;
    m[14] = near * far / (near - far);
    // Move the camera to z = 150: translate the view by -150 along Z.
    m[14] += m[10] * -150.0;
    m[15] = 150.0;
    (arrays, Frustum::from_view_projection(&m))
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_culling() {
    println!("\nculling: SIMD against scalar, one thread");
    for count in [100_000usize, 1_000_000] {
        let ([xs, ys, zs, rs], frustum) = bench_scene(count);
        let mut out = vec![0u32; count];
        let range = 0..count as u32;
        let mut visible = 0;
        let scalar = fastest(50, || {
            visible = cull_spheres_reference(&frustum, &xs, &ys, &zs, &rs, range.clone(), &mut out);
            black_box(&out);
        });
        let simd = fastest(50, || {
            let n = cull_spheres(&frustum, &xs, &ys, &zs, &rs, range.clone(), &mut out);
            assert_eq!(n, visible);
            black_box(&out);
        });
        println!(
            "  {count:>9} spheres ({visible} visible): scalar {:>8.1} µs, SIMD {:>8.1} µs, speedup {:.2}x",
            micros(scalar),
            micros(simd),
            scalar.as_secs_f64() / simd.as_secs_f64()
        );
    }

    println!("\nculling: cull_parallel against the one-thread SIMD time");
    for count in [100_000usize, 1_000_000] {
        let ([xs, ys, zs, rs], frustum) = bench_scene(count);
        let spheres = SphereArrays::new(&xs, &ys, &zs, &rs);
        let mut out = CullOutput::with_capacity(count as u32);
        let mut single = vec![0u32; count];
        let base = fastest(50, || {
            black_box(cull_spheres(
                &frustum,
                &xs,
                &ys,
                &zs,
                &rs,
                0..count as u32,
                &mut single,
            ));
        });
        for (workers, threads) in THREAD_COUNTS {
            let pool = Workers::start(workers);
            let t = fastest(100, || {
                black_box(cull_parallel(pool.jobs(), &frustum, spheres, &mut out));
            });
            println!(
                "  {count:>9} spheres, {threads} threads: {:>8.1} µs, speedup {:.2}x",
                micros(t),
                base.as_secs_f64() / t.as_secs_f64()
            );
        }
    }
}

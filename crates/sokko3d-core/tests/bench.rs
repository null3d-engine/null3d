//! Benchmarks, ignored by default. Run them with:
//!
//! ```text
//! cargo test -p sokko3d-core --release --test bench -- --ignored --nocapture --test-threads=1
//! ```
//!
//! Timings come after at least 100 ms of warm-up, so the cores reach full clock speed. Loop
//! benchmarks report the fastest of many runs, which filters out interference from other
//! processes; frame benchmarks also report the median frame. "Threads" counts the calling thread
//! plus the job workers, so `threads = job workers + 1`.
#![feature(portable_simd)]
#![allow(clippy::disallowed_methods)] // Benchmarks read the clock and start threads.

mod common;

use std::hint::black_box;
use std::simd::prelude::*;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use common::{Rng, Workers, mul4, perspective, translation};
use sokko3d_core::culling::{
    CullOutput, Frustum, cull_parallel, cull_spheres, cull_spheres_reference,
};
use sokko3d_core::handle::Handle;
use sokko3d_core::instances::BatchTable;
use sokko3d_core::jobs::JobSystem;
use sokko3d_core::scene::{Command, SceneStorage, flags};
use sokko3d_core::world::SphereArrays;

/// Job worker counts to measure: 1, 2, 3, 4, 5, 8 and 9 threads.
const JOB_WORKERS: [u32; 7] = [0, 1, 2, 3, 4, 7, 8];

fn warm_up(mut f: impl FnMut()) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(100) {
        f();
    }
}

/// The fastest time of `runs` calls of `f`, after the warm-up.
fn fastest(runs: u32, mut f: impl FnMut()) -> Duration {
    warm_up(&mut f);
    (0..runs)
        .map(|_| {
            let start = Instant::now();
            f();
            start.elapsed()
        })
        .min()
        .unwrap()
}

/// The median and the fastest time of `runs` calls of `f`, after the warm-up.
fn median_and_fastest(runs: usize, mut f: impl FnMut()) -> (Duration, Duration) {
    warm_up(&mut f);
    let mut times: Vec<Duration> = (0..runs)
        .map(|_| {
            let start = Instant::now();
            f();
            start.elapsed()
        })
        .collect();
    times.sort();
    (times[runs / 2], times[0])
}

fn micros(d: Duration) -> f64 {
    d.as_secs_f64() * 1e6
}

/// A perspective frustum looking down -Z from 150 units away at a cube of random spheres, so
/// about two thirds of them are visible.
fn bench_scene(count: usize) -> ([Vec<f32>; 4], Frustum) {
    let mut rng = Rng::new(5);
    let mut arrays: [Vec<f32>; 4] = Default::default();
    for _ in 0..count {
        arrays[0].push(rng.range(-100.0, 100.0));
        arrays[1].push(rng.range(-100.0, 100.0));
        arrays[2].push(rng.range(-100.0, 100.0));
        arrays[3].push(rng.range(0.1, 2.0));
    }
    let view_projection = mul4(
        &perspective(1.0, 1.0, 0.5, 400.0),
        &translation(0.0, 0.0, -150.0),
    );
    (arrays, Frustum::from_view_projection(&view_projection))
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
        for workers in JOB_WORKERS {
            let pool = Workers::start(workers);
            let t = fastest(100, || {
                black_box(cull_parallel(pool.jobs(), &frustum, spheres, &mut out));
            });
            println!(
                "  {count:>9} spheres, {} threads: {:>8.1} µs, speedup {:.2}x",
                workers + 1,
                micros(t),
                base.as_secs_f64() / t.as_secs_f64()
            );
        }
    }
}

/// Sums a slice with four `f32x4` accumulators.
fn simd_sum(data: &[f32]) -> f32 {
    let (blocks, rest) = data.as_chunks::<16>();
    let mut acc = [f32x4::splat(0.0); 4];
    for block in blocks {
        for (k, a) in acc.iter_mut().enumerate() {
            *a += f32x4::from_slice(&block[k * 4..k * 4 + 4]);
        }
    }
    ((acc[0] + acc[1]) + (acc[2] + acc[3])).reduce_sum() + rest.iter().sum::<f32>()
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_sum_10m_floats() {
    const COUNT: usize = 10_000_000;
    const CHUNK: u32 = 1 << 16;
    let data: Vec<f32> = (0..COUNT).map(|i| (i % 8) as f32 * 0.125).collect();
    let expected: f64 = data.iter().map(|&v| f64::from(v)).sum();
    let partials: Vec<AtomicU32> = (0..(COUNT as u32).div_ceil(CHUNK))
        .map(|_| AtomicU32::new(0))
        .collect();
    println!("\nSIMD sum of 10,000,000 floats (40 MB), chunks of {CHUNK}");
    let mut base = None;
    for workers in JOB_WORKERS {
        let pool = Workers::start(workers);
        let mut total = 0.0f32;
        let t = fastest(40, || {
            pool.jobs().parallel_for(COUNT as u32, CHUNK, &|range, _| {
                let sum = simd_sum(&data[range.start as usize..range.end as usize]);
                partials[(range.start / CHUNK) as usize].store(sum.to_bits(), Ordering::Relaxed);
            });
            total = partials
                .iter()
                .map(|p| f32::from_bits(p.load(Ordering::Relaxed)))
                .sum();
        });
        assert!((f64::from(total) - expected).abs() <= expected * 1e-4);
        let base = *base.get_or_insert(t);
        println!(
            "  {} threads: {:>7.1} µs ({:>5.1} GB/s), speedup {:.2}x",
            workers + 1,
            micros(t),
            (COUNT * 4) as f64 / t.as_secs_f64() / 1e9,
            base.as_secs_f64() / t.as_secs_f64()
        );
    }
}

/// The S2 hierarchy: 14 roots with 3 children each, 6 levels, 5,096 objects. Roots are dynamic;
/// the rest are dynamic too when `all_dynamic` is set, and static otherwise.
fn s2_scene(all_dynamic: bool) -> (SceneStorage, Vec<usize>) {
    let mut scene = SceneStorage::with_capacity(5096);
    let mut commands = Vec::new();
    let mut level = vec![Handle::NONE; 14];
    let mut roots = Vec::new();
    for depth in 0..6 {
        let parents = if depth == 0 {
            level.clone()
        } else {
            level.repeat(3)
        };
        level.clear();
        for (i, parent) in parents.into_iter().enumerate() {
            let h = scene.reserve().unwrap();
            scene
                .set_position(h, [(i % 7) as f32, 1.0, (i % 5) as f32])
                .unwrap();
            scene.set_local_radius(h, 0.5).unwrap();
            let dynamic = depth == 0 || all_dynamic;
            let f = flags::VISIBLE | if dynamic { flags::DYNAMIC } else { 0 };
            commands.push(Command::create(h, parent, 1, f));
            if depth == 0 {
                roots.push(scene.resolve(h).unwrap() as usize);
            }
            level.push(h);
        }
    }
    assert_eq!(commands.len(), 5096);
    scene.apply_commands(&commands, 1).unwrap();
    (scene, roots)
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_s2_propagation() {
    println!("\nS2 transform propagation (5,096 objects, 6 levels), per frame");
    for all_dynamic in [false, true] {
        let label = if all_dynamic {
            "every object dynamic"
        } else {
            "dynamic roots, static children"
        };
        for workers in [0, 3, 4] {
            let (mut scene, roots) = s2_scene(all_dynamic);
            let pool = Workers::start(workers);
            let mut frame = 1;
            let (median, best) = median_and_fastest(2000, || {
                for &slot in &roots {
                    let angle = frame as f32 * 0.01;
                    scene.rotations_mut()[slot * 4 + 1] = angle.sin();
                    scene.rotations_mut()[slot * 4 + 3] = angle.cos();
                }
                scene.begin_frame(frame);
                scene.update_transforms(pool.jobs());
                frame += 1;
            });
            assert_eq!(scene.changed().count_ones(), 5096);
            println!(
                "  {label}, {} threads: median {:>6.1} µs, fastest {:>6.1} µs",
                workers + 1,
                micros(median),
                micros(best)
            );
        }
    }
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_s1_batch_update() {
    println!("\nS1 batch update (100,000 dynamic rows), per frame");
    for workers in [0, 1, 3, 7] {
        let mut table = BatchTable::with_capacity(1);
        let id = table.create(100_000, true, false, 1, 1, 0.5).unwrap();
        let mut rng = Rng::new(3);
        let batch = table.get_mut(id).unwrap();
        for p in batch.positions_mut() {
            *p = rng.range(-100.0, 100.0);
        }
        for q in batch.rotations_mut().as_chunks_mut::<4>().0 {
            *q = rng.quaternion();
        }
        let pool = Workers::start(workers);
        let jobs: &JobSystem = pool.jobs();
        let mut frame = 1;
        let (median, best) = median_and_fastest(500, || {
            table.update(jobs, frame);
            frame += 1;
        });
        println!(
            "  {} threads: median {:>7.1} µs, fastest {:>7.1} µs",
            workers + 1,
            micros(median),
            micros(best)
        );
    }
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_parallel_for_overhead() {
    println!("\nparallel_for with trivial chunks: the cost of one loop");
    for chunks in [4u32, 27] {
        for workers in [0, 3, 4, 7] {
            let pool = Workers::start(workers);
            let sink = AtomicU32::new(0);
            let (median, best) = median_and_fastest(20_000, || {
                pool.jobs().parallel_for(chunks, 1, &|range, _| {
                    sink.fetch_add(range.start, Ordering::Relaxed);
                });
            });
            println!(
                "  {chunks:>2} chunks, {} threads: median {:>5.2} µs, fastest {:>5.2} µs",
                workers + 1,
                micros(median),
                micros(best)
            );
        }
    }
}

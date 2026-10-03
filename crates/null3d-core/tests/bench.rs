//! Benchmarks, ignored by default. Run them with:
//!
//! ```text
//! cargo test -p null3d-core --release --test bench -- --ignored --nocapture --test-threads=1
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
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use common::{
    Rng, Workers, character, mul4, perspective, terrain, translation, wait_for_every_thread,
};
use null3d_core::animation::Animations;
use null3d_core::bvh::mesh::{IndexedTriangles, MeshBvh, Side, Triangles, raycast_brute_force};
use null3d_core::bvh::scene::SceneBvh;
use null3d_core::bvh::top::{TopTree, WorldRay};
use null3d_core::bvh::{Aabb, Ray, ray_box_entry};
use null3d_core::cells::CellTable;
use null3d_core::culling::{
    CullOutput, Frustum, cull_parallel, cull_spheres, cull_spheres_reference,
};
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::{BackgroundTask, JobConfig, JobSystem, WorkerId};
use null3d_core::scene::{Command, SceneStorage, flags};
use null3d_core::world::SphereArrays;

/// Job worker counts to measure: 1, 2, 3, 4, 5, 8, 9, 12 and 17 threads. On an 18-core Mac, 17
/// threads is "logical cores minus 2" job workers plus the calling thread.
const JOB_WORKERS: [u32; 9] = [0, 1, 2, 3, 4, 7, 8, 11, 16];

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
        let mut cells = CellTable::new();
        let mut frame = 1;
        let (median, best) = median_and_fastest(500, || {
            table.update(jobs, frame, &mut cells);
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
fn bench_animation_crowd() {
    // S5's crowd: each character blends two clips at times of its own, as a crossfade does.
    const JOINTS: u32 = 48;
    println!("\nanimation: characters of {JOINTS} joints, each blending two clips, per frame");
    for characters in [100u32, 500] {
        for workers in [0, 1, 3, 7] {
            let (skeleton, clips) = character(JOINTS);
            let pool = Workers::start(workers);
            let jobs: &JobSystem = pool.jobs();
            let mut animations = Animations::new(jobs, characters, characters * JOINTS).unwrap();
            let id = animations.add_skeleton(skeleton).unwrap();
            let ids: Vec<u32> = clips
                .into_iter()
                .map(|clip| animations.add_clip(id, clip).unwrap())
                .collect();
            for _ in 0..characters {
                animations.add_instance(id).unwrap();
            }
            let mut frame = 0u32;
            let (median, best) = median_and_fastest(500, || {
                for i in 0..characters {
                    let t = (frame + i * 7) as f32 / 60.0;
                    animations.set_sample(i, 0, ids[0], t % 1.0, 0.6);
                    animations.set_sample(i, 1, ids[1], (t * 1.3) % 0.75, 0.4);
                }
                animations.update(jobs);
                frame += 1;
            });
            println!(
                "  {characters} characters, {} threads: median {:>7.1} µs, fastest {:>7.1} µs",
                workers + 1,
                micros(median),
                micros(best)
            );
        }
    }
}

/// A background task that busy-waits for `micros` microseconds, as real work would.
fn spin_task(micros: u64, _: WorkerId) {
    let end = Instant::now() + Duration::from_micros(micros);
    while Instant::now() < end {
        std::hint::spin_loop();
    }
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_job_workers_join_a_frame_job() {
    const TASK_MICROS: u64 = 1000;
    const ROUNDS: usize = 500;
    println!(
        "\nA frame job while the job workers run background tasks of {TASK_MICROS} µs: when the last \
         job worker joins it"
    );
    for workers in [1, 3, 7] {
        let pool = Workers::with_config(JobConfig {
            workers,
            background_capacity: 1 << 12,
            ..JobConfig::default()
        });
        let jobs = pool.jobs();
        let threads = jobs.thread_count();
        let mut joins: Vec<Duration> = Vec::with_capacity(ROUNDS);
        for _ in 0..ROUNDS {
            while jobs.pending_background() < 4 * workers {
                jobs.spawn_background(BackgroundTask {
                    run: spin_task,
                    arg: TASK_MICROS,
                })
                .unwrap();
            }
            // Workers take the tasks between frame jobs.
            std::thread::sleep(Duration::from_micros(TASK_MICROS / 2));
            let joined = AtomicU64::new(0);
            let last_join = AtomicU64::new(0);
            let start = Instant::now();
            jobs.parallel_for(threads, 1, &|_, worker| {
                if worker != WorkerId::CALLER {
                    last_join.fetch_max(start.elapsed().as_nanos() as u64, Ordering::Relaxed);
                }
                wait_for_every_thread(&joined, worker, threads);
            });
            joins.push(Duration::from_nanos(last_join.load(Ordering::Relaxed)));
        }
        joins.sort();
        println!(
            "  {threads} threads: median {:>7.1} µs, slowest {:>7.1} µs",
            micros(joins[ROUNDS / 2]),
            micros(joins[ROUNDS - 1])
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

/// Random rays from above a mesh's box toward points inside it.
fn rays_into(rng: &mut Rng, b: &Aabb, count: usize) -> Vec<Ray> {
    (0..count)
        .map(|_| {
            let target: [f32; 3] = std::array::from_fn(|k| rng.range(b.min[k], b.max[k]));
            let origin = [
                target[0] + rng.range(-50.0, 50.0),
                b.max[1] + 20.0,
                target[2] + rng.range(-50.0, 50.0),
            ];
            Ray::new(origin, std::array::from_fn(|k| target[k] - origin[k]))
        })
        .collect()
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_bvh_mesh() {
    println!("\nmesh BVH: SAH build, refit and closest-hit raycasts on a height field, one thread");
    let mut rng = Rng::new(21);
    for quads in [71u32, 224, 707] {
        let (positions, indices) = terrain(&mut rng, quads);
        let mesh = IndexedTriangles {
            positions: &positions,
            indices: &indices,
        };
        let triangles = mesh.count();
        let runs = if triangles < 20_000 {
            41
        } else if triangles < 200_000 {
            9
        } else {
            3
        };
        let (build, build_best) = median_and_fastest(runs, || {
            black_box(MeshBvh::build(&mesh).unwrap());
        });
        let mut bvh = MeshBvh::build(&mesh).unwrap();
        let (refit, _) = median_and_fastest(runs, || bvh.refit(&mesh));
        let rays = rays_into(&mut rng, &bvh.bounds(), 10_000);
        let mut hits = 0;
        let query = fastest(5, || {
            hits = rays
                .iter()
                .filter(|r| bvh.raycast(&mesh, r, Side::Front).is_some())
                .count();
        });
        println!(
            "  {triangles:>9} triangles: build median {:>9.1} µs (fastest {:>9.1}), refit {:>8.1} µs, \
             {} nodes, {:.1} bytes per triangle; a ray {:.3} µs ({hits} of 10000 hit)",
            micros(build),
            micros(build_best),
            micros(refit),
            bvh.nodes().len(),
            bvh.memory_bytes() as f64 / f64::from(triangles),
            micros(query) / 10_000.0,
        );
        if triangles < 20_000 {
            let brute = fastest(3, || {
                for r in &rays[..1000] {
                    black_box(raycast_brute_force(&mesh, r, Side::Front));
                }
            });
            println!(
                "  {triangles:>9} triangles: a ray by brute force {:.1} µs",
                micros(brute) / 1000.0
            );
        }
    }
}

/// `n` items of about 1 m in one cell, spread over a cube of `spread` meters.
fn top_items(rng: &mut Rng, n: u32, spread: f32) -> TopTree {
    let mut tree = TopTree::new();
    tree.try_reserve(n).unwrap();
    for i in 0..n {
        let c = [(); 3].map(|_| rng.range(-spread, spread));
        tree.push(i, 0, Aabb::of_sphere(c, rng.range(0.5, 1.5)));
    }
    tree
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_bvh_top_level() {
    let table = CellTable::new();
    let mut rng = Rng::new(22);
    println!(
        "\ntop level, static: SAH build on 1 and 8 threads, refit on one; raycasts that test each \
         item's box"
    );
    let serial = JobSystem::new(0);
    let pool = Workers::start(7);
    for n in [1_000u32, 20_000, 100_000] {
        let mut tree = top_items(&mut rng, n, 500.0);
        let runs = if n < 50_000 { 41 } else { 9 };
        let (build, _) = median_and_fastest(runs, || tree.build_sah(&table, &serial).unwrap());
        let (build8, _) = median_and_fastest(runs, || tree.build_sah(&table, pool.jobs()).unwrap());
        let (refit, _) = median_and_fastest(runs, || tree.refit());
        let boxes: Vec<Aabb> = tree.boxes().to_vec();
        let rays: Vec<WorldRay> = rays_into(&mut rng, &tree.roots()[0].bounds, 10_000)
            .iter()
            .map(|r| WorldRay::new(r.origin.map(f64::from), r.direction))
            .collect();
        let query = fastest(5, || {
            for r in &rays {
                black_box(tree.raycast(r, |id, local| ray_box_entry(local, &boxes[id as usize])));
            }
        });
        println!(
            "  {n:>7} items: build median {:>8.1} µs, on 8 threads {:>8.1} µs, refit {:>7.1} µs, a ray {:.3} µs",
            micros(build),
            micros(build8),
            micros(refit),
            micros(query) / 10_000.0
        );
    }
    println!("\ntop level, dynamic: Morton rebuild by thread count");
    for n in [1_000u32, 10_000, 100_000] {
        let mut tree = top_items(&mut rng, n, 500.0);
        let mut line = format!("  {n:>7} items:");
        for workers in [0, 1, 3, 7] {
            let pool = Workers::start(workers);
            let (median, _) = median_and_fastest(201, || {
                tree.build_morton(&table, pool.jobs()).unwrap();
            });
            line += &format!(" {} threads {:>7.1} µs,", workers + 1, micros(median));
        }
        let boxes: Vec<Aabb> = tree.boxes().to_vec();
        let rays: Vec<WorldRay> = rays_into(&mut rng, &tree.roots()[0].bounds, 10_000)
            .iter()
            .map(|r| WorldRay::new(r.origin.map(f64::from), r.direction))
            .collect();
        let query = fastest(5, || {
            for r in &rays {
                black_box(tree.raycast(r, |id, local| ray_box_entry(local, &boxes[id as usize])));
            }
        });
        line += &format!(" a ray {:.3} µs", micros(query) / 10_000.0);
        println!("{line}");
    }
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_bvh_scene_sync() {
    println!(
        "\nscene trees: a sync in a frame where only dynamic objects moved (20,000 static objects)"
    );
    for dynamic in [1_000u32, 10_000, 50_000] {
        let mut line = format!("  {dynamic:>6} dynamic:");
        for workers in [0, 3, 7] {
            let pool = Workers::start(workers);
            let jobs = pool.jobs();
            let mut rng = Rng::new(23);
            let mut scene = SceneStorage::with_capacity(20_000 + dynamic);
            let mut commands = Vec::new();
            let mut moving = Vec::new();
            for i in 0..20_000 + dynamic {
                let h = scene.reserve().unwrap();
                scene
                    .set_position(h, [(); 3].map(|_| rng.range(-500.0, 500.0)))
                    .unwrap();
                scene.set_local_radius(h, 1.0).unwrap();
                let f = if i < 20_000 {
                    flags::VISIBLE
                } else {
                    flags::VISIBLE | flags::DYNAMIC
                };
                commands.push(Command::create(h, Handle::NONE, 1, f));
                if i >= 20_000 {
                    moving.push(scene.resolve(h).unwrap() as usize);
                }
            }
            scene.apply_commands(&commands, 1).unwrap();
            let mut bvh = SceneBvh::new();
            let batches = BatchTable::with_capacity(1);
            let unit = Aabb {
                min: [-1.0; 3],
                max: [1.0; 3],
            };
            let mut times = Vec::new();
            for frame in 1..=120u32 {
                scene.begin_frame(frame);
                for &slot in &moving {
                    scene.positions_mut()[slot * 3] += 0.1;
                }
                scene.update_transforms(jobs);
                let start = Instant::now();
                bvh.sync(&scene, &batches, jobs, &|_| unit).unwrap();
                if frame > 20 {
                    times.push(start.elapsed());
                }
            }
            times.sort();
            line += &format!(
                " {} threads {:>7.1} µs,",
                workers + 1,
                micros(times[times.len() / 2])
            );
        }
        println!("{}", line.trim_end_matches(','));
    }
}

/// A city block: 2,000 buildings of 10 to 40 m on a grid, and 18,000 props of 0.3 to 2 m.
fn city(rng: &mut Rng) -> TopTree {
    let mut tree = TopTree::new();
    tree.try_reserve(20_000).unwrap();
    for i in 0..2_000u32 {
        let (gx, gz) = (
            (i % 45) as f32 * 50.0 - 1100.0,
            (i / 45) as f32 * 50.0 - 1100.0,
        );
        let (w, h) = (rng.range(10.0, 40.0), rng.range(10.0, 80.0));
        let building = Aabb {
            min: [gx, 0.0, gz],
            max: [gx + w, h, gz + w],
        };
        tree.push(i, 0, building);
    }
    for i in 2_000..20_000u32 {
        let c = [rng.range(-1100.0, 1100.0), 0.5, rng.range(-1100.0, 1100.0)];
        tree.push(i, 0, Aabb::of_sphere(c, rng.range(0.3, 2.0)));
    }
    tree
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_bvh_city() {
    println!("\ntop level on a city block of 20,000 objects: SAH against Morton, one thread");
    let table = CellTable::new();
    let mut rng = Rng::new(24);
    let serial = JobSystem::new(0);
    let mut rays = Vec::new();
    for i in 0..10_000 {
        let (x, z) = (
            f64::from(rng.range(-1000.0, 1000.0)),
            f64::from(rng.range(-1000.0, 1000.0)),
        );
        // Half along the streets at eye height, half down from above.
        let ray = if i % 2 == 0 {
            WorldRay::new(
                [x, 1.7, z],
                [
                    rng.range(-1.0, 1.0),
                    rng.range(-0.05, 0.1),
                    rng.range(-1.0, 1.0),
                ],
            )
        } else {
            WorldRay::new(
                [x, 300.0, z],
                [rng.range(-0.3, 0.3), -1.0, rng.range(-0.3, 0.3)],
            )
        };
        rays.push(ray);
    }
    for morton in [false, true] {
        let mut tree = city(&mut rng);
        let (build, _) = median_and_fastest(21, || {
            if morton {
                tree.build_morton(&table, &serial).unwrap();
            } else {
                tree.build_sah(&table, &serial).unwrap();
            }
        });
        let boxes: Vec<Aabb> = tree.boxes().to_vec();
        let mut tested = 0u64;
        let query = fastest(5, || {
            tested = 0;
            for r in &rays {
                black_box(tree.raycast(r, |id, local| {
                    tested += 1;
                    ray_box_entry(local, &boxes[id as usize])
                }));
            }
        });
        println!(
            "  {}: build {:>8.1} µs, a ray {:.3} µs, {:.1} objects tested per ray",
            if morton { "Morton" } else { "SAH   " },
            micros(build),
            micros(query) / 10_000.0,
            tested as f64 / 10_000.0
        );
    }
}

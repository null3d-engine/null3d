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
    Rng, Workers, character, mul4, perspective, reversed_perspective, sphere, terrain, translation,
    wait_for_every_thread,
};
use null3d_core::animation::Animations;
use null3d_core::bvh::mesh::{IndexedTriangles, MeshBvh, Side, Triangles, raycast_brute_force};
use null3d_core::bvh::query::{QueryMeshes, QueryScene, SceneQueries};
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
                animations.update(jobs, 0.0);
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

/// A box of 12 triangles and a sphere of 960, the meshes of the query benchmark's scene.
struct BenchMeshes {
    meshes: Vec<(Vec<f32>, Vec<u32>)>,
}

impl QueryMeshes for BenchMeshes {
    type Mesh<'a> = IndexedTriangles<'a, u32>;

    fn count(&self) -> u32 {
        self.meshes.len() as u32
    }

    fn mesh(&self, id: u32) -> Option<IndexedTriangles<'_, u32>> {
        let (positions, indices) = self.meshes.get(id.checked_sub(1)? as usize)?;
        Some(IndexedTriangles { positions, indices })
    }

    fn side(&self, _: u32) -> Side {
        Side::Front
    }
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_scene_queries() {
    println!(
        "\nscene queries: 20,000 static objects, 2,000 dynamic ones and 10,000 static rows in 1 km"
    );
    let box_positions = vec![
        -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, //
        -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
    ];
    let box_indices = vec![
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5,
        0, 4, 7, 0, 7, 3,
    ];
    let (sphere_positions, sphere_indices) = sphere(16, 30);
    let meshes = BenchMeshes {
        meshes: vec![
            (box_positions, box_indices),
            (
                sphere_positions,
                sphere_indices.into_iter().map(u32::from).collect(),
            ),
        ],
    };
    let mut rng = Rng::new(25);
    let mut scene = SceneStorage::with_capacity(22_000);
    let mut batches = BatchTable::with_capacity(1);
    let mut commands = Vec::new();
    let mut moving = Vec::new();
    let place = |rng: &mut Rng| {
        [
            rng.range(-500.0, 500.0),
            rng.range(0.0, 20.0),
            rng.range(-500.0, 500.0),
        ]
    };
    for i in 0..22_000u32 {
        let h = scene.reserve().unwrap();
        scene.set_position(h, place(&mut rng)).unwrap();
        scene.set_rotation(h, rng.quaternion()).unwrap();
        let s = rng.range(0.5, 4.0);
        scene.set_scale(h, [s, s, s]).unwrap();
        scene.set_local_radius(h, 1.8).unwrap();
        let f = if i < 20_000 {
            flags::VISIBLE
        } else {
            flags::VISIBLE | flags::DYNAMIC
        };
        commands.push(Command::create(h, Handle::NONE, 1 + i % 2, f));
        if i >= 20_000 {
            moving.push(scene.resolve(h).unwrap() as usize);
        }
    }
    scene.apply_commands(&commands, 1).unwrap();
    let rows = batches.create(10_000, false, false, 1, 1, 1.8).unwrap();
    let batch = batches.get_mut(rows).unwrap();
    for r in 0..10_000 {
        let p = place(&mut rng);
        batch.positions_mut()[r * 3..r * 3 + 3].copy_from_slice(&p);
    }
    let serial = JobSystem::new(0);
    scene.update_transforms(&serial);
    batches.update(&serial, 1, scene.cell_table_mut());
    let mut queries = SceneQueries::new();
    queries.reserve(100_000).unwrap();
    let start = Instant::now();
    let view = QueryScene {
        scene: &scene,
        batches: &batches,
        meshes: &meshes,
        rows: Default::default(),
    };
    queries.sync(&view, &serial).unwrap();
    println!(
        "  first sync, mesh trees and both scene trees, one thread: {:.2} ms",
        micros(start.elapsed()) / 1000.0
    );
    // Rays from 30 m up toward points on the ground, as picks from a camera above.
    let rays: Vec<WorldRay> = (0..10_000)
        .map(|_| {
            let o = [rng.range(-500.0, 500.0), 30.0, rng.range(-500.0, 500.0)];
            let t = [rng.range(-500.0, 500.0), 0.0, rng.range(-500.0, 500.0)];
            let d: [f32; 3] = std::array::from_fn(|k| t[k] - o[k]);
            let len = d.iter().map(|v| v * v).sum::<f32>().sqrt();
            WorldRay::new(o.map(f64::from), d.map(|v| v / len))
        })
        .collect();
    let per = |d: Duration, n: usize| micros(d) / n as f64;
    let closest = fastest(20, || {
        for r in &rays {
            black_box(queries.raycast(&view, r, u32::MAX));
        }
    });
    let any = fastest(20, || {
        for r in &rays {
            black_box(queries.raycast_any(&view, r, u32::MAX));
        }
    });
    let hits = rays
        .iter()
        .filter(|r| queries.raycast(&view, r, u32::MAX).is_some())
        .count();
    println!(
        "  one thread: raycast {:.2} µs, raycastAny {:.2} µs a ray ({hits} of 10,000 rays hit)",
        per(closest, rays.len()),
        per(any, rays.len())
    );
    let all = fastest(20, || {
        for r in &rays[..1000] {
            black_box(queries.raycast_all(&view, r, u32::MAX).len());
        }
    });
    let mut found = 0;
    let sphere_query = fastest(20, || {
        found = 0;
        for r in &rays[..1000] {
            let c = [r.origin[0], 5.0, r.origin[2]];
            found += queries.overlap_sphere(&view, c, 10.0, u32::MAX).len();
        }
    });
    let box_query = fastest(20, || {
        for r in &rays[..1000] {
            let lo = [r.origin[0] - 10.0, 0.0, r.origin[2] - 10.0];
            let hi = [r.origin[0] + 10.0, 20.0, r.origin[2] + 10.0];
            black_box(queries.overlap_box(&view, lo, hi, u32::MAX).len());
        }
    });
    println!(
        "  one thread: raycastAll {:.2} µs, overlapSphere of 10 m {:.2} µs ({:.1} found), overlapBox of 20 m {:.2} µs",
        per(all, 1000),
        per(sphere_query, 1000),
        found as f64 / 1000.0,
        per(box_query, 1000)
    );
    let mut line = String::from("  a batch of 10,000 rays:");
    for workers in [0, 3, 7] {
        let pool = Workers::start(workers);
        let jobs = pool.jobs();
        let batch = fastest(20, || {
            let out =
                queries.raycast_batch(&view, jobs, 10_000, &|i| Some(rays[i as usize]), u32::MAX);
            black_box(out.unwrap().len());
        });
        line += &format!(" {} threads {:.2} ms,", workers + 1, micros(batch) / 1000.0);
    }
    println!("{}", line.trim_end_matches(','));
    // Frames where only the dynamic objects moved.
    let mut times = Vec::new();
    let pool = Workers::start(3);
    for frame in 2..=60u32 {
        scene.begin_frame(frame);
        for &slot in &moving {
            scene.positions_mut()[slot * 3] += 0.1;
        }
        scene.update_transforms(pool.jobs());
        batches.update(pool.jobs(), frame, scene.cell_table_mut());
        let start = Instant::now();
        let view = QueryScene {
            scene: &scene,
            batches: &batches,
            meshes: &meshes,
            rows: Default::default(),
        };
        queries.sync(&view, pool.jobs()).unwrap();
        if frame > 10 {
            times.push(start.elapsed());
        }
    }
    times.sort();
    println!(
        "  a sync where 2,000 dynamic objects moved, 4 threads: {:.1} µs",
        micros(times[times.len() / 2])
    );
}

/// A sphere's center and radius.
type Ball = ([f32; 3], f32);

/// The occlusion city at `blocks` x `blocks` buildings of 12 triangles, 20 m wide on a 30 m grid,
/// 12 to 60 m high, and 20,000 spheres along its streets: the buildings' world matrices and the
/// spheres, both relative to the city's center.
fn occlusion_city(blocks: u32) -> (Vec<[f32; 12]>, Vec<Ball>) {
    let mut rng = Rng::new(36);
    let first = -((blocks - 1) as f32 * 30.0) / 2.0;
    let mut buildings = Vec::new();
    for i in 0..blocks {
        for j in 0..blocks {
            let h = rng.range(12.0, 60.0);
            let (x, z) = (first + i as f32 * 30.0, first + j as f32 * 30.0);
            buildings.push([20.0, 0.0, 0.0, x, 0.0, h, 0.0, h / 2.0, 0.0, 0.0, 20.0, z]);
        }
    }
    let side = blocks as f32 * 30.0;
    let spheres = (0..20_000)
        .map(|_| {
            let street = first - 15.0 + 30.0 * rng.range(0.0, blocks as f32 + 0.999).floor();
            let along = rng.range(-side / 2.0, side / 2.0);
            let across = street + rng.range(-4.0, 4.0);
            let at = if rng.range(0.0, 1.0) < 0.5 {
                [across, 0.5, along]
            } else {
                [along, 0.5, across]
            };
            (at, rng.range(0.15, 0.6))
        })
        .collect();
    (buildings, spheres)
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_software_occlusion() {
    use null3d_core::bvh::mesh::IndexedTriangles;
    use null3d_core::occlusion::{Blocker, BlockerMesh, OcclusionBuffer, clip_matrix};

    // A unit box from -0.5 to 0.5, wound counterclockwise seen from outside.
    let positions = [
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, //
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ];
    let indices: [u32; 36] = [
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5,
        0, 4, 7, 0, 7, 3,
    ];
    let meshes = [BlockerMesh::build(&IndexedTriangles {
        positions: &positions,
        indices: &indices,
    })
    .unwrap()];
    let projection = reversed_perspective(1.2, 16.0 / 9.0, 0.2, Some(600.0));
    println!("\nsoftware occlusion: the occlusion city, a camera 2 m up in a street, 1280 x 720");
    for blocks in [8, 16] {
        let (buildings, spheres) = occlusion_city(blocks);
        // Camera poses down the middle street, each turning its head: the camera's position, and
        // the view-projection matrix for positions relative to it.
        let poses: Vec<([f32; 3], [f32; 16])> = (0..32)
            .map(|k| {
                let at = [-(blocks as f32) * 15.0 + 4.0 * k as f32, 2.0, 0.0];
                let yaw = (k as f32 * 0.7).sin() * 0.6 + std::f32::consts::FRAC_PI_2;
                let (s, c) = yaw.sin_cos();
                let mut view = [0.0; 16];
                (view[0], view[2], view[8], view[10]) = (c, -s, s, c);
                (view[5], view[15]) = (1.0, 1.0);
                (at, mul4(&projection, &view))
            })
            .collect();
        for workers in [0, 3, 4] {
            let pool = Workers::start(workers);
            let mut buffer = OcclusionBuffer::new();
            buffer.resize(1280, 720).unwrap();
            let mut blockers = Vec::with_capacity(buildings.len());
            let (mut draws, mut tests) = (Vec::new(), Vec::new());
            let (mut hidden, mut tested) = (0, 0);
            for round in 0..20 {
                for (at, view_proj) in &poses {
                    let offset = [-at[0], -at[1], -at[2]];
                    let start = Instant::now();
                    blockers.clear();
                    for world in &buildings {
                        blockers.push(Blocker {
                            mesh: 0,
                            clip: clip_matrix(view_proj, world, offset),
                            double_sided: false,
                        });
                    }
                    buffer
                        .draw(pool.jobs(), view_proj, &meshes, &blockers)
                        .unwrap();
                    let drawn = start.elapsed();
                    let start = Instant::now();
                    // Four spheres at a time, as culling tests them.
                    let n: u32 = spheres
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .map(|four| {
                            let axis =
                                |i: usize| f32x4::from_array(four.map(|(c, _)| c[i] + offset[i]));
                            let radii = f32x4::from_array(four.map(|(_, r)| r));
                            buffer
                                .hidden4(axis(0), axis(1), axis(2), radii)
                                .count_ones()
                        })
                        .sum();
                    let test = start.elapsed();
                    if round > 2 {
                        draws.push(drawn);
                        tests.push(test);
                        hidden += n as usize;
                        tested += spheres.len();
                    }
                }
            }
            draws.sort();
            tests.sort();
            println!(
                "  {} buildings, {} threads: draw median {:.1} µs, fastest {:.1} µs; \
                 20,000 sphere tests {:.1} µs on one thread; {:.0}% hidden",
                buildings.len(),
                workers + 1,
                micros(draws[draws.len() / 2]),
                micros(draws[0]),
                micros(tests[tests.len() / 2]),
                100.0 * hidden as f64 / tested as f64
            );
        }
    }
}

#[test]
#[ignore = "benchmark: run with --release --ignored"]
fn bench_row_queries() {
    use null3d_core::bvh::rows::{QueryCamera, RowQuery};
    use null3d_core::lines::{LineLook, LineMode};
    use null3d_core::sprites::SpriteLook;
    println!(
        "\nrow queries: 20,000 static boxes, 10,000 points and 2,000 line segments sized in pixels, in 1 km"
    );
    let box_positions = vec![
        -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, //
        -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
    ];
    let box_indices = vec![
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5,
        0, 4, 7, 0, 7, 3,
    ];
    let quad = vec![
        -0.5, -0.5, 0.0, 0.5, -0.5, 0.0, 0.5, 0.5, 0.0, -0.5, 0.5, 0.0,
    ];
    let meshes = BenchMeshes {
        meshes: vec![(box_positions, box_indices), (quad, vec![0, 1, 2, 0, 2, 3])],
    };
    let mut rng = Rng::new(26);
    let mut scene = SceneStorage::with_capacity(20_000);
    let mut batches = BatchTable::with_capacity(2);
    let place = |rng: &mut Rng| {
        [
            rng.range(-500.0, 500.0),
            rng.range(0.0, 20.0),
            rng.range(-500.0, 500.0),
        ]
    };
    let mut commands = Vec::new();
    for _ in 0..20_000u32 {
        let h = scene.reserve().unwrap();
        scene.set_position(h, place(&mut rng)).unwrap();
        scene.set_local_radius(h, 1.8).unwrap();
        commands.push(Command::create(h, Handle::NONE, 1, flags::VISIBLE));
    }
    scene.apply_commands(&commands, 1).unwrap();
    // The rows sit on layer 1, the boxes on layer 0.
    let look = SpriteLook::new(1, 1, true).as_points();
    let points = batches
        .create_sprites(10_000, false, 2, 1, 0.71, look)
        .unwrap();
    let batch = batches.get_mut(points).unwrap();
    batch.set_layers(0b10);
    for r in 0..10_000 {
        let p = place(&mut rng);
        batch.positions_mut()[r * 3..r * 3 + 3].copy_from_slice(&p);
    }
    batch.sprite_rows_mut().0.fill(6.0);
    let look = LineLook::new(LineMode::Segments, 3.0, false, false);
    let lines = batches.create_lines(4_000, false, 1, 1, 1.5, look).unwrap();
    let batch = batches.get_mut(lines).unwrap();
    batch.set_layers(0b10);
    for p in 0..2_000 {
        let a = place(&mut rng);
        let b: [f32; 3] = std::array::from_fn(|k| a[k] + rng.range(-5.0, 5.0));
        batch.line_points_mut().0[p * 6..p * 6 + 6].copy_from_slice(&[a, b].concat());
    }
    let serial = JobSystem::new(0);
    scene.update_transforms(&serial);
    batches.update(&serial, 1, scene.cell_table_mut());
    let eye = [0.0f64, 60.0, 600.0];
    let pixel = 2.0 * 30.0f32.to_radians().tan() / 1080.0;
    let rows = RowQuery {
        camera: Some(QueryCamera {
            eye,
            right: [1.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            forward: [0.0, 0.0, -1.0],
            perspective: true,
            pixel: [pixel, pixel],
            near: 0.1,
            far: 5000.0,
        }),
        ..RowQuery::default()
    };
    let view = QueryScene {
        scene: &scene,
        batches: &batches,
        meshes: &meshes,
        rows,
    };
    let mut queries = SceneQueries::new();
    queries.sync(&view, &serial).unwrap();
    // Rays from the camera toward points of the scene, as pointer events cast them.
    let rays: Vec<WorldRay> = (0..10_000)
        .map(|_| {
            let t = place(&mut rng).map(f64::from);
            WorldRay::toward(eye, std::array::from_fn(|k| t[k] - eye[k])).unwrap()
        })
        .collect();
    let per = |d: Duration| micros(d) / rays.len() as f64;
    for (name, layers) in [
        ("boxes alone", 0b1),
        ("rows alone", 0b10),
        ("boxes and rows", 0b11),
    ] {
        let hits = rays
            .iter()
            .filter(|r| queries.raycast(&view, r, layers).is_some())
            .count();
        let closest = fastest(20, || {
            for r in &rays {
                black_box(queries.raycast(&view, r, layers));
            }
        });
        println!(
            "  {name}: raycast {:.2} µs a ray ({hits} of 10,000 rays hit)",
            per(closest)
        );
    }
}

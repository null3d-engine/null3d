//! The transparent pass's sort on real job worker threads: many rows, which spread over the
//! workers, sort as a stable comparison sort does, with render order first and farthest first,
//! and a frame's sort makes no allocator call once the output has room.

mod common;

use common::{Rng, Workers};
use null3d_core::culling::{CULL_CHUNK, CullRun, CullSet, CullView, Frustum, SetLayers, SetOrder};
use null3d_core::depth_sort::{DepthSorted, SortSet, cull_and_sort, split_item};
use null3d_core::jobs::{JobConfig, JobSystem};
use null3d_core::layers::ALL_LAYERS;
use null3d_core::testing::CountingAllocator;
use null3d_core::world::SphereArrays;

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

const ROWS: usize = 50_000;

/// Rows at few distinct depths and render orders, so many keys tie and the sort's stability
/// shows: spheres on the z axis, and a frustum that holds them all.
struct Scene {
    xs: Vec<f32>,
    zs: Vec<f32>,
    radii: Vec<f32>,
    orders: Vec<f32>,
    runs: Vec<CullRun>,
}

impl Scene {
    fn new() -> Self {
        let mut rng = Rng::new(7);
        let zs = (0..ROWS).map(|_| -(rng.below(700) as f32)).collect();
        let orders = (0..ROWS).map(|_| rng.below(3) as f32 - 1.0).collect();
        let runs = (0..ROWS as u32)
            .step_by(CULL_CHUNK as usize)
            .map(|start| CullRun {
                set: 0,
                start,
                end: (start + CULL_CHUNK).min(ROWS as u32),
                bucket: 0,
                base: 0,
                cell: 0,
            })
            .collect();
        Self {
            xs: vec![0.0; ROWS],
            zs,
            radii: vec![1.0; ROWS],
            orders,
            runs,
        }
    }

    fn set(&self) -> SortSet<'_> {
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
                layers: SetLayers::All(1),
            },
            orders: Some(&self.orders),
        }
    }

    /// Sorts the rows for a view that looks down -Z from the origin, and returns the sorted rows.
    fn sort(&self, jobs: &JobSystem, out: &mut DepthSorted) -> usize {
        let open = [0.0, 0.0, 0.0, f32::MAX];
        let frustum = Frustum::from_planes([open; 6]);
        let offsets = [[0.0; 4]];
        let view = CullView {
            frustum: &frustum,
            offsets: &offsets,
            layers: ALL_LAYERS,
        };
        let sets = |_| self.set();
        cull_and_sort(jobs, view, [0.0, 0.0, -1.0, 0.0], &sets, &self.runs, out)
    }

    fn sorted_rows(&self, out: &DepthSorted) -> Vec<u32> {
        out.items()
            .iter()
            .map(|&item| {
                let (run, offset) = split_item(item);
                self.runs[run].start + offset
            })
            .collect()
    }
}

#[test]
fn many_rows_sort_as_a_stable_comparison_sort_does() {
    let scene = Scene::new();
    let mut expected: Vec<u32> = (0..ROWS as u32).collect();
    // Lower orders first, then the most negative z, the farthest from the view, first.
    expected.sort_by(|&a, &b| {
        let (a, b) = (a as usize, b as usize);
        scene.orders[a]
            .total_cmp(&scene.orders[b])
            .then(scene.zs[a].total_cmp(&scene.zs[b]))
    });
    for workers in [0, 3] {
        let pool = Workers::start(workers);
        let mut out = DepthSorted::default();
        out.try_reserve(ROWS as u32, scene.runs.len() as u32)
            .unwrap();
        assert_eq!(scene.sort(pool.jobs(), &mut out), ROWS);
        assert!(
            scene.sorted_rows(&out) == expected,
            "{workers} workers sort another way"
        );
    }
}

#[test]
fn a_sort_makes_no_allocator_call() {
    let _exclusive = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let pool = Workers::with_setup(
        JobConfig {
            workers: 3,
            ..JobConfig::default()
        },
        CountingAllocator::track_this_thread,
    );
    let scene = Scene::new();
    let mut out = DepthSorted::default();
    out.try_reserve(ROWS as u32, scene.runs.len() as u32)
        .unwrap();
    scene.sort(pool.jobs(), &mut out);
    CountingAllocator::arm();
    for _ in 0..3 {
        scene.sort(pool.jobs(), &mut out);
    }
    let allocations = CountingAllocator::disarm();
    assert_eq!(allocations, 0, "sorts made {allocations} allocator calls");
}

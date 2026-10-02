//! The light grid: every light that reaches a point is in the point's cluster, the clusters list
//! what a search of every cluster and light finds, the job workers list what one thread lists, and
//! the caps keep the lights they promise. The file that the GPU's light clustering test page
//! reads holds lights, the GPU's parameters for them, and what the job workers list.
#![allow(clippy::disallowed_methods)] // Native job workers are threads.

use std::mem::offset_of;
use std::ops::Range;
use std::thread;

use null3d_core::culling::Frustum;
use null3d_core::jobs::JobSystem;
use null3d_core::lights::{POINT_CONE, VisibleLight, kind};
use null3d_render::camera::{Affine, Lens, Orthographic, Perspective};
use null3d_render::light_grid::{
    ClusterParams, DEFAULT_GRID, GridShape, GridView, LightGrid, LightLimits, START_BITS,
};

/// Runs `f` with a job system whose workers are native threads.
fn with_workers<R>(workers: u32, f: impl FnOnce(&JobSystem) -> R) -> R {
    let jobs = JobSystem::new(workers);
    thread::scope(|scope| {
        for i in 0..workers {
            let jobs = &jobs;
            scope.spawn(move || jobs.worker_loop(i));
        }
        let result = f(&jobs);
        jobs.shutdown();
        result
    })
}

/// A small generator of repeatable numbers.
struct Rng(u64);

impl Rng {
    /// A number from 0 to 1.
    fn next(&mut self) -> f32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }

    fn between(&mut self, low: f32, high: f32) -> f32 {
        low + (high - low) * self.next()
    }
}

const PERSPECTIVE: Lens = Lens::Perspective(Perspective {
    fov_degrees: 60.0,
    near: 0.25,
    far: 400.0,
});

const ORTHOGRAPHIC: Lens = Lens::Orthographic(Orthographic {
    height: 40.0,
    width: None,
    center: [0.0, 0.0],
    near: -10.0,
    far: 300.0,
});

/// A camera at the origin that looks down -Z.
const AHEAD: Affine = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0];
/// A camera at (5, 2, 1) scaled by 2 and turned 30 degrees about +Y, which the grid sees only
/// through its rotation and scale.
const TURNED: Affine = [
    1.732_050_8,
    0.0,
    1.0,
    5.0,
    0.0,
    2.0,
    0.0,
    2.0,
    -1.0,
    0.0,
    1.732_050_8,
    1.0,
];

fn view(lens: Lens, world: &Affine) -> GridView {
    GridView {
        view_proj: lens.relative_view_projection(world, 16.0 / 9.0),
        depth: lens.depth(world),
    }
}

/// A light at `position`, relative to the camera, with range `range`: a spot light that points
/// down -Z when `spot`, else a point light.
fn light(position: [f32; 3], range: f32, spot: bool, row: u32) -> VisibleLight {
    let (direction, cone_cos, penumbra_cos, light_kind) = if spot {
        ([0.0, 0.0, -1.0], 0.5, 0.7, kind::SPOT)
    } else {
        ([0.0; 3], POINT_CONE[0], POINT_CONE[1], kind::POINT)
    };
    VisibleLight {
        position,
        range,
        color: [1.0; 3],
        decay: 2.0,
        direction,
        cone_cos,
        penumbra_cos,
        kind: light_kind,
        light: row,
        unused: 0,
    }
}

/// `count` lights in and around the view, the ones the core would find visible, in a region that
/// reaches `depth` along the view of `world`, and ranges up to `range`.
fn lights_in(
    rng: &mut Rng,
    view: &GridView,
    world: &Affine,
    count: usize,
    depth: f32,
    range: f32,
) -> Vec<VisibleLight> {
    let frustum = Frustum::from_view_projection(&view.view_proj);
    let axis = |k: usize| [world[k], world[4 + k], world[8 + k]];
    let (right, up, back) = (axis(0), axis(1), axis(2));
    let mut lights = Vec::new();
    while lights.len() < count {
        let (x, y, z) = (
            rng.between(-1.2, 1.2) * depth * 0.6,
            rng.between(-1.2, 1.2) * depth * 0.35,
            rng.between(-0.05, 1.0) * depth,
        );
        let position: [f32; 3] =
            std::array::from_fn(|k| (x * right[k] + y * up[k] - z * back[k]) / 2.0);
        let r = rng.between(0.2, range);
        if frustum.contains_sphere(position[0], position[1], position[2], r) {
            let spot = lights.len() % 3 == 0;
            lights.push(light(position, r, spot, lights.len() as u32 + 1));
        }
    }
    lights
}

/// True when a position relative to the camera lies in the view.
fn in_view(view: &GridView, p: [f32; 3]) -> bool {
    let m = &view.view_proj;
    let clip = |row: usize| m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row];
    let (x, y, z, w) = (clip(0), clip(1), clip(2), clip(3));
    w > 0.0 && x.abs() <= w && y.abs() <= w && (0.0..=w).contains(&z)
}

fn distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    (0..3).map(|k| (a[k] - b[k]).powi(2)).sum::<f32>().sqrt()
}

/// Checks that each point that a light reaches finds the light in its cluster.
fn assert_reached_points_find_their_lights(grid: &LightGrid, view: &GridView, rng: &mut Rng) {
    let lights = grid.lights();
    let mut checked = 0;
    for _ in 0..40_000 {
        let i = (rng.next() * lights.len() as f32) as usize % lights.len();
        let light = &lights[i];
        let offset: [f32; 3] = std::array::from_fn(|_| rng.between(-1.0, 1.0) * light.range);
        let p: [f32; 3] = std::array::from_fn(|k| light.position[k] + offset[k]);
        if !in_view(view, p) || distance(p, light.position) >= light.range {
            continue;
        }
        let cluster = grid
            .cluster_at(p)
            .unwrap_or_else(|| panic!("{p:?} in view but past the last slice"));
        for (j, other) in lights.iter().enumerate() {
            if distance(p, other.position) < other.range {
                assert!(
                    grid.cluster_lights(cluster).contains(&(j as u32)),
                    "light {j} reaches {p:?} but cluster {cluster} does not list it"
                );
            }
        }
        checked += 1;
    }
    assert!(checked > 10_000, "only {checked} points in view");
}

#[test]
fn every_light_that_reaches_a_point_is_in_the_points_cluster() {
    for (lens, world) in [
        (PERSPECTIVE, AHEAD),
        (PERSPECTIVE, TURNED),
        (ORTHOGRAPHIC, AHEAD),
        (ORTHOGRAPHIC, TURNED),
    ] {
        let mut rng = Rng(7);
        let view = view(lens, &world);
        let lights = lights_in(&mut rng, &view, &world, 256, 120.0, 14.0);
        let mut grid = LightGrid::new(DEFAULT_GRID, LightLimits::default());
        grid.assign(&JobSystem::new(0), &view, &lights);
        assert_eq!(grid.lights(), &lights[..]);
        assert_reached_points_find_their_lights(&grid, &view, &mut rng);
    }
}

#[test]
fn the_clusters_list_what_a_search_of_every_cluster_and_light_finds() {
    let mut rng = Rng(11);
    let view = view(PERSPECTIVE, &TURNED);
    let lights = lights_in(&mut rng, &view, &TURNED, 300, 150.0, 20.0);
    let mut grid = LightGrid::new(DEFAULT_GRID, LightLimits::default());
    grid.assign(&JobSystem::new(0), &view, &lights);
    let mut listed = 0;
    for cluster in 0..DEFAULT_GRID.clusters() {
        let expected: Vec<u32> = (0..lights.len() as u32)
            .filter(|&light| grid.reaches(light, cluster))
            .collect();
        assert_eq!(grid.cluster_lights(cluster), &expected[..], "{cluster}");
        listed += expected.len();
    }
    assert_eq!(
        grid.words().len(),
        DEFAULT_GRID.clusters() as usize + listed
    );
    // Most lights miss most clusters, and every light reaches some.
    assert!(listed < lights.len() * DEFAULT_GRID.clusters() as usize / 20);
    for light in 0..lights.len() as u32 {
        assert!((0..DEFAULT_GRID.clusters()).any(|c| grid.reaches(light, c)));
    }
}

#[test]
fn job_workers_list_the_same_lights_as_one_thread() {
    let mut rng = Rng(3);
    let view = view(PERSPECTIVE, &AHEAD);
    // Enough lights over enough slices that the job workers take part.
    let lights = lights_in(&mut rng, &view, &AHEAD, 1000, 100.0, 16.0);
    let mut alone = LightGrid::new(DEFAULT_GRID, LightLimits::default());
    alone.assign(&JobSystem::new(0), &view, &lights);
    for workers in [1, 3, 7] {
        with_workers(workers, |jobs| {
            let mut grid = LightGrid::new(DEFAULT_GRID, LightLimits::default());
            for _ in 0..3 {
                jobs.prepare_frame();
                grid.assign(jobs, &view, &lights);
                assert!(jobs.workers_busy_this_frame(), "the job workers took part");
                assert_eq!(grid.words(), alone.words(), "{workers} workers");
                assert_eq!(grid.uniform(), alone.uniform());
            }
        });
    }
    // Workers that never start leave every chunk to the calling thread.
    let mut idle = LightGrid::new(DEFAULT_GRID, LightLimits::default());
    idle.assign(&JobSystem::new(4), &view, &lights);
    assert_eq!(idle.words(), alone.words());
}

#[test]
fn caps_keep_the_first_lights_of_a_cluster_and_the_nearest_lights_of_the_frame() {
    let view = view(PERSPECTIVE, &AHEAD);
    // Five lights on top of each other ahead of the camera, and one further away.
    let mut lights: Vec<_> = (0..5)
        .map(|i| light([0.0, 0.0, -10.0 - i as f32 * 0.01], 3.0, false, i + 1))
        .collect();
    lights.push(light([0.0, 0.0, -40.0], 3.0, false, 6));
    let shape = GridShape {
        tiles_x: 4,
        tiles_y: 4,
        slices: 8,
    };
    let jobs = JobSystem::new(0);

    let limits = LightLimits {
        per_cluster: 2,
        ..LightLimits::default()
    };
    let mut grid = LightGrid::new(shape, limits);
    grid.assign(&jobs, &view, &lights);
    let near = grid.cluster_at([0.0, 0.0, -10.0]).unwrap();
    assert_eq!(grid.cluster_lights(near), &[0, 1]);
    let far = grid.cluster_at([0.0, 0.0, -40.0]).unwrap();
    assert_eq!(grid.cluster_lights(far), &[5]);

    // A full index list leaves the far clusters without lights.
    let limits = LightLimits {
        indices: 20,
        ..LightLimits::default()
    };
    let mut grid = LightGrid::new(shape, limits);
    grid.assign(&jobs, &view, &lights);
    assert_eq!(grid.words().len(), shape.clusters() as usize + 20);
    assert!(grid.cluster_lights(far).is_empty());

    // Past the frame's cap, the nearest lights stay, in the order of the list.
    let limits = LightLimits {
        lights: 2,
        ..LightLimits::default()
    };
    let mut reversed = lights.clone();
    reversed.reverse();
    let mut grid = LightGrid::new(shape, limits);
    grid.assign(&jobs, &view, &reversed);
    let rows: Vec<u32> = grid.lights().iter().map(|l| l.light).collect();
    assert_eq!(rows, [2, 1]);
}

#[test]
fn a_grid_without_lights_in_its_depth_lists_none() {
    let view = view(PERSPECTIVE, &AHEAD);
    let mut grid = LightGrid::new(DEFAULT_GRID, LightLimits::default());
    let jobs = JobSystem::new(0);
    grid.assign(&jobs, &view, &[light([0.0, 0.0, -5.0], 2.0, true, 1)]);
    assert_eq!(grid.uniform().grid[2], DEFAULT_GRID.slices as f32);
    grid.assign(&jobs, &view, &[]);
    assert_eq!(grid.uniform().grid[2], 0.0);
    assert_eq!(grid.words().len(), DEFAULT_GRID.clusters() as usize);
    assert_eq!(grid.cluster_at([0.0, 0.0, -5.0]), None);
    // A light wholly behind the near plane reaches no slice.
    grid.assign(&jobs, &view, &[light([0.0, 0.0, 1.0], 0.5, false, 1)]);
    assert_eq!(grid.uniform().grid[2], 0.0);
}

#[test]
fn slices_end_where_the_farthest_light_ends() {
    let view = view(PERSPECTIVE, &AHEAD);
    let mut grid = LightGrid::new(DEFAULT_GRID, LightLimits::default());
    grid.assign(
        &JobSystem::new(0),
        &view,
        &[light([0.0, 0.0, -20.0], 4.0, false, 1)],
    );
    // Just short of the light's far end is the last slice; past it is no slice.
    let last = DEFAULT_GRID.slices - 1;
    let cluster = grid.cluster_at([0.0, 0.0, -23.9]).unwrap();
    assert_eq!(cluster / DEFAULT_GRID.tiles(), last);
    assert_eq!(grid.cluster_at([0.0, 0.0, -24.1]), None);
    // The word of that cluster names the light.
    let word = grid.words()[cluster as usize];
    assert_eq!(word >> START_BITS, 1);
}

/// The cases of the GPU's light clustering test page: a lens and a camera, the light count, the
/// seed of the lights, how far they spread and how far they reach, and the limits.
fn gpu_cases() -> [(Lens, Affine, usize, u64, f32, f32, LightLimits); 3] {
    let capped = LightLimits {
        lights: 200,
        per_cluster: 6,
        indices: 4000,
    };
    [
        // S3's many small lights, as one camera sees them.
        (
            PERSPECTIVE,
            AHEAD,
            256,
            5,
            120.0,
            8.0,
            LightLimits::default(),
        ),
        (
            ORTHOGRAPHIC,
            TURNED,
            100,
            9,
            150.0,
            20.0,
            LightLimits::default(),
        ),
        // Every cap at work: the frame's, each cluster's and the index list's.
        (PERSPECTIVE, TURNED, 300, 13, 150.0, 20.0, capped),
    ]
}

/// How far a decimal of the parameters may differ from the file, as a share of its size or of 1,
/// whichever is larger. The parameters' planes and slice bounds come from tangents, logarithms and
/// powers, which the math library of each system rounds in its own way, so the file that one
/// system writes differs from another's in the last bits of those decimals. The lights and grids
/// do not differ.
const PARAMS_TOLERANCE: f32 = 1e-6;

/// The file of the GPU's light clustering test page, as 32-bit words: the number of cases, then
/// for each case the parameters' words and their count before them, the light list's words and
/// the light count before them, and the grid's words that the job workers list and their count
/// before them. Also the ranges of words that are the parameters' decimals.
fn gpu_fixture() -> (Vec<u32>, Vec<Range<usize>>) {
    let cases = gpu_cases();
    let mut out = vec![cases.len() as u32];
    let mut decimals = Vec::new();
    for (lens, world, count, seed, depth, range, limits) in cases {
        let view = view(lens, &world);
        let lights = lights_in(&mut Rng(seed), &view, &world, count, depth, range);
        let mut grid = LightGrid::new(DEFAULT_GRID, limits);
        grid.assign(&JobSystem::new(0), &view, &lights);
        let mut params = ClusterParams::default();
        grid.gpu_params(&mut params);
        let listed = grid.lights();
        assert_eq!(params.shape[3] as usize, listed.len());
        out.push(params.as_words().len() as u32);
        let first_decimal = out.len() + offset_of!(ClusterParams, depth_row) / 4;
        out.extend_from_slice(params.as_words());
        decimals.push(first_decimal..out.len());
        out.push(listed.len() as u32);
        for light in listed {
            // SAFETY: a light record is `repr(C)` and made of 32-bit values only.
            let words: [u32; 16] = unsafe { std::mem::transmute(*light) };
            out.extend_from_slice(&words);
        }
        out.push(grid.words().len() as u32);
        out.extend_from_slice(grid.words());
    }
    (out, decimals)
}

#[test]
fn the_gpu_test_page_reads_what_the_job_workers_list() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/light-clusters.bin"
    );
    let (expected, decimals) = gpu_fixture();
    if std::env::var_os("NULL3D_UPDATE_GENERATED").is_some() {
        let bytes: Vec<u8> = expected.iter().flat_map(|w| w.to_le_bytes()).collect();
        std::fs::write(path, bytes).unwrap();
    }
    let bytes = std::fs::read(path).unwrap_or_default();
    let actual: Vec<u32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&b| u32::from_le_bytes(b))
        .collect();
    let close = |at: usize, a: u32, b: u32| {
        let (x, y) = (f32::from_bits(a), f32::from_bits(b));
        a == b
            || (decimals.iter().any(|range| range.contains(&at))
                && (x - y).abs() <= PARAMS_TOLERANCE * x.abs().max(y.abs()).max(1.0))
    };
    assert!(
        actual.len() == expected.len()
            && (actual.iter().zip(&expected).enumerate()).all(|(at, (&a, &b))| close(at, a, b)),
        "{path} is out of date: run `NULL3D_UPDATE_GENERATED=1 cargo test -p null3d-render --test light_grid`"
    );
}

#[test]
fn the_gpu_reads_the_slicing_that_the_job_workers_assign_with() {
    for (lens, world, count, seed, depth, range, limits) in gpu_cases() {
        let view = view(lens, &world);
        let lights = lights_in(&mut Rng(seed), &view, &world, count, depth, range);
        let mut assigned = LightGrid::new(DEFAULT_GRID, limits);
        assigned.assign(&JobSystem::new(0), &view, &lights);
        let mut prepared = LightGrid::new(DEFAULT_GRID, limits);
        assert!(prepared.prepare(&view, &lights).is_some());
        assert_eq!(prepared.uniform(), assigned.uniform());
        assert_eq!(prepared.lights(), assigned.lights());
        let (mut a, mut b) = (ClusterParams::default(), ClusterParams::default());
        assigned.gpu_params(&mut a);
        prepared.gpu_params(&mut b);
        assert_eq!(a, b);
        // The planes between the 16 columns and 9 rows of tiles, and the bounds of 24 slices.
        assert_eq!(a.planes[26], assigned_plane(&a, 26));
        assert_eq!(a.planes[27], [0.0; 4]);
        assert_eq!(a.bounds[12], [0.0; 4]);
        assert_eq!(prepared.gpu_workgroups(), [2, 24, 1]);
    }
}

/// A plane of the parameters, which the grid set: a normalized plane.
fn assigned_plane(params: &ClusterParams, index: usize) -> [f32; 4] {
    let p = params.planes[index];
    let length = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
    assert!(
        (length - 1.0).abs() < 1e-5,
        "plane {index} of length {length}"
    );
    p
}

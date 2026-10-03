//! Helpers shared by the integration tests: native threads that act as job workers, waits for
//! other threads that no machine load can fail, a small deterministic random number generator, and
//! reference math. The allocation counter is `null3d_core::testing::CountingAllocator`.
#![allow(dead_code)]

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use null3d_core::culling::Frustum;
use null3d_core::jobs::{JobConfig, JobSystem, WorkerId};

/// A job system with native threads running its worker loops. Dropping it shuts the system down
/// and joins the threads.
pub struct Workers {
    jobs: Arc<JobSystem>,
    threads: Vec<JoinHandle<()>>,
}

impl Workers {
    /// Starts `workers` job worker threads with the default settings.
    pub fn start(workers: u32) -> Self {
        Self::with_config(JobConfig {
            workers,
            ..JobConfig::default()
        })
    }

    /// Starts job worker threads with explicit settings. `before_loop` runs on each worker thread
    /// first, for example to mark the thread for allocation counting.
    pub fn with_config(config: JobConfig) -> Self {
        Self::with_setup(config, || {})
    }

    /// Like [`Workers::with_config`], running `setup` on each worker thread before its loop.
    #[allow(clippy::disallowed_methods)]
    pub fn with_setup(config: JobConfig, setup: fn()) -> Self {
        let jobs = Arc::new(JobSystem::with_config(config));
        let threads = (0..jobs.worker_count())
            .map(|i| {
                let jobs = Arc::clone(&jobs);
                std::thread::spawn(move || {
                    setup();
                    jobs.worker_loop(i);
                })
            })
            .collect();
        Self { jobs, threads }
    }

    /// The shared job system.
    pub fn jobs(&self) -> &JobSystem {
        &self.jobs
    }

    /// Shuts the system down and waits for every worker thread to return.
    pub fn stop(mut self) {
        self.join();
    }

    fn join(&mut self) {
        self.jobs.shutdown();
        for t in self.threads.drain(..) {
            t.join().expect("a job worker thread panicked");
        }
    }
}

impl Drop for Workers {
    fn drop(&mut self) {
        self.join();
    }
}

/// How long a test waits for another thread before it fails. A busy machine delays a thread by a
/// fraction of a second at worst, so only a thread that never runs takes this long. The limit turns
/// such a hang into a failure that names what the test waited for.
pub const THREAD_TIMEOUT: Duration = Duration::from_secs(60);

/// Yields the thread until `done` returns true. Panics, naming `what`, after [`THREAD_TIMEOUT`].
#[allow(clippy::disallowed_methods)]
pub fn wait_until(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + THREAD_TIMEOUT;
    while !done() {
        assert!(
            Instant::now() < deadline,
            "waited {THREAD_TIMEOUT:?} for {what}"
        );
        std::thread::yield_now();
    }
}

/// Marks the chunk's thread in `joined`, then holds the chunk until every one of the job system's
/// `threads` threads has marked itself. A thread runs one chunk at a time, so a loop whose chunks
/// call this, with at least one chunk per thread, cannot end before each job worker has woken and
/// claimed a chunk, however late the operating system runs it.
pub fn wait_for_every_thread(joined: &AtomicU64, worker: WorkerId, threads: u32) {
    let all = (1u64 << threads) - 1;
    joined.fetch_or(1 << worker.index(), Ordering::SeqCst);
    wait_until("every thread to claim a chunk", || {
        joined.load(Ordering::SeqCst) == all
    });
}

/// A small permuted congruential generator, so tests are repeatable without a dependency.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    pub fn next_u32(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let x = ((self.0 >> 18) ^ self.0) >> 27;
        (x as u32).rotate_right((self.0 >> 59) as u32)
    }

    /// A value in `0..n`.
    pub fn below(&mut self, n: u32) -> u32 {
        ((u64::from(self.next_u32()) * u64::from(n)) >> 32) as u32
    }

    /// A value in `lo..hi`.
    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }

    /// A random unit quaternion (x, y, z, w).
    pub fn quaternion(&mut self) -> [f32; 4] {
        loop {
            let q = [
                self.range(-1.0, 1.0),
                self.range(-1.0, 1.0),
                self.range(-1.0, 1.0),
                self.range(-1.0, 1.0),
            ];
            let len = q.iter().map(|v| v * v).sum::<f32>().sqrt();
            if len > 0.1 {
                return q.map(|v| v / len);
            }
        }
    }
}

/// A 3 × 4 row-major affine matrix in double precision, for reference results.
pub type Mat64 = [f64; 12];

/// The matrix of a translation, a rotation quaternion and a scale, in double precision: the
/// reference for the engine's single-precision compose.
pub fn compose64(p: [f32; 3], q: [f32; 4], s: [f32; 3]) -> Mat64 {
    let [x, y, z, w] = q.map(f64::from);
    let [sx, sy, sz] = s.map(f64::from);
    let (xx, yy, zz) = (2.0 * x * x, 2.0 * y * y, 2.0 * z * z);
    let (xy, xz, yz) = (2.0 * x * y, 2.0 * x * z, 2.0 * y * z);
    let (wx, wy, wz) = (2.0 * w * x, 2.0 * w * y, 2.0 * w * z);
    [
        (1.0 - yy - zz) * sx,
        (xy - wz) * sy,
        (xz + wy) * sz,
        f64::from(p[0]),
        (xy + wz) * sx,
        (1.0 - xx - zz) * sy,
        (yz - wx) * sz,
        f64::from(p[1]),
        (xz - wy) * sx,
        (yz + wx) * sy,
        (1.0 - xx - yy) * sz,
        f64::from(p[2]),
    ]
}

/// The product `a × b` of two affine matrices in double precision.
pub fn mul64(a: &Mat64, b: &Mat64) -> Mat64 {
    std::array::from_fn(|i| {
        let (r, c) = (i / 4, i % 4);
        let v: f64 = (0..3).map(|k| a[r * 4 + k] * b[k * 4 + c]).sum();
        if c == 3 { v + a[r * 4 + 3] } else { v }
    })
}

/// The length of the longest column of the 3 × 3 part, in double precision.
pub fn max_axis_scale64(m: &Mat64) -> f64 {
    (0..3)
        .map(|c| (0..3).map(|r| m[r * 4 + c] * m[r * 4 + c]).sum::<f64>())
        .fold(0.0, f64::max)
        .sqrt()
}

/// The column-major product `a × b` of two 4 × 4 matrices.
pub fn mul4(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    std::array::from_fn(|i| {
        let (col, row) = (i / 4, i % 4);
        (0..4).map(|k| a[k * 4 + row] * b[col * 4 + k]).sum()
    })
}

/// A column-major translation matrix.
pub fn translation(x: f32, y: f32, z: f32) -> [f32; 16] {
    let mut m = [0.0; 16];
    m[0] = 1.0;
    m[5] = 1.0;
    m[10] = 1.0;
    m[12] = x;
    m[13] = y;
    m[14] = z;
    m[15] = 1.0;
    m
}

/// A column-major perspective projection in WebGPU's clip space, looking down -Z: depth runs
/// from 0 at `near` to 1 at `far`.
pub fn perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> [f32; 16] {
    let f = 1.0 / (fov_y / 2.0).tan();
    let mut m = [0.0; 16];
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1.0;
    m[14] = near * far / (near - far);
    m
}

pub type Mat4 = [f32; 16];

/// A perspective projection with reversed depth (1 at near, 0 at far), or an infinite far plane
/// when `far` is `None`.
pub fn reversed_perspective(fov_y: f32, aspect: f32, near: f32, far: Option<f32>) -> Mat4 {
    let f = 1.0 / (fov_y / 2.0).tan();
    let mut m = [0.0; 16];
    m[0] = f / aspect;
    m[5] = f;
    m[11] = -1.0;
    match far {
        Some(far) => {
            m[10] = near / (far - near);
            m[14] = far * near / (far - near);
        }
        None => m[14] = near,
    }
    m
}

/// An orthographic projection in WebGPU's clip space.
pub fn orthographic(left: f32, right: f32, bottom: f32, top: f32, near: f32, far: f32) -> Mat4 {
    let mut m = [0.0; 16];
    m[0] = 2.0 / (right - left);
    m[5] = 2.0 / (top - bottom);
    m[10] = 1.0 / (near - far);
    m[12] = -(right + left) / (right - left);
    m[13] = -(top + bottom) / (top - bottom);
    m[14] = near / (near - far);
    m[15] = 1.0;
    m
}

/// A view matrix for a camera at `eye` turned by `yaw` about Y and `pitch` about X.
pub fn view(eye: [f32; 3], yaw: f32, pitch: f32) -> Mat4 {
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = pitch.sin_cos();
    // Rows of the inverse rotation are the camera axes.
    let right = [cy, 0.0, -sy];
    let up = [sy * sp, cp, cy * sp];
    let back = [sy * cp, -sp, cy * cp];
    let dot = |a: [f32; 3]| a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
    [
        right[0],
        up[0],
        back[0],
        0.0, //
        right[1],
        up[1],
        back[1],
        0.0, //
        right[2],
        up[2],
        back[2],
        0.0, //
        -dot(right),
        -dot(up),
        -dot(back),
        1.0,
    ]
}

pub fn frusta() -> Vec<Frustum> {
    let matrices = [
        perspective(1.0, 16.0 / 9.0, 0.1, 500.0),
        mul4(
            &perspective(0.6, 1.0, 1.0, 80.0),
            &view([3.0, 10.0, 40.0], 0.7, -0.3),
        ),
        mul4(
            &reversed_perspective(1.2, 1.5, 0.5, Some(200.0)),
            &view([-20.0, 0.0, 5.0], -1.9, 0.2),
        ),
        mul4(
            &reversed_perspective(1.4, 2.0, 0.25, None),
            &view([0.0, 50.0, 0.0], 3.0, -1.2),
        ),
        mul4(
            &orthographic(-60.0, 60.0, -30.0, 30.0, 1.0, 300.0),
            &view([0.0, 0.0, 100.0], 0.2, 0.1),
        ),
    ];
    matrices.iter().map(Frustum::from_view_projection).collect()
}

/// `count` random spheres in a 400-unit cube, some hidden, some huge, and a few degenerate.
pub fn random_spheres(count: usize, seed: u64) -> [Vec<f32>; 4] {
    let mut rng = Rng::new(seed);
    let mut arrays: [Vec<f32>; 4] = Default::default();
    for _ in 0..count {
        arrays[0].push(rng.range(-200.0, 200.0));
        arrays[1].push(rng.range(-200.0, 200.0));
        arrays[2].push(rng.range(-200.0, 200.0));
        arrays[3].push(match rng.below(100) {
            0 => f32::NEG_INFINITY,
            1 => f32::NAN,
            2 => rng.range(50.0, 400.0),
            3 => 0.0,
            _ => rng.range(0.0, 8.0),
        });
    }
    arrays
}

/// A height field of `n` × `n` quads on a unit grid, as indexed triangles.
pub fn terrain(rng: &mut Rng, n: u32) -> (Vec<f32>, Vec<u32>) {
    let mut positions = Vec::new();
    for z in 0..=n {
        for x in 0..=n {
            positions.extend([x as f32, rng.range(0.0, 2.0), z as f32]);
        }
    }
    let mut indices = Vec::new();
    for z in 0..n {
        for x in 0..n {
            let i = z * (n + 1) + x;
            indices.extend([i, i + n + 1, i + 1, i + 1, i + n + 1, i + n + 2]);
        }
    }
    (positions, indices)
}

/// A unit sphere of `rings` × `segments` quads, as indexed triangles with 16-bit indices.
pub fn sphere(rings: u16, segments: u16) -> (Vec<f32>, Vec<u16>) {
    let mut positions = Vec::new();
    for r in 0..=rings {
        let phi = std::f32::consts::PI * f32::from(r) / f32::from(rings);
        for s in 0..=segments {
            let theta = std::f32::consts::TAU * f32::from(s) / f32::from(segments);
            positions.extend([phi.sin() * theta.cos(), phi.cos(), phi.sin() * theta.sin()]);
        }
    }
    let mut indices = Vec::new();
    for r in 0..rings {
        for s in 0..segments {
            let i = r * (segments + 1) + s;
            let j = i + segments + 1;
            indices.extend([i, i + 1, j, i + 1, j + 1, j]);
        }
    }
    (positions, indices)
}

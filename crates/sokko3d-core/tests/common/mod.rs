//! Helpers shared by the integration tests: native threads that act as job workers, a small
//! deterministic random number generator, and an allocation counter.
#![allow(dead_code)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;

use sokko3d_core::jobs::{JobConfig, JobSystem};

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

/// A global allocator that counts allocations made by marked threads while counting is armed.
/// A test binary installs it with `#[global_allocator]`.
pub struct CountingAllocator;

static ARMED: AtomicBool = AtomicBool::new(false);
static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);
static EXCLUSIVE: Mutex<()> = Mutex::new(());

thread_local! {
    static TRACKED: Cell<bool> = const { Cell::new(false) };
}

impl CountingAllocator {
    /// Runs counting tests one at a time: they share one counter. Take it before tracking.
    pub fn exclusive() -> MutexGuard<'static, ()> {
        EXCLUSIVE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Counts allocations made from now on by the current thread.
    pub fn track_this_thread() {
        TRACKED.with(|t| t.set(true));
    }

    /// Starts counting from zero.
    pub fn arm() {
        ALLOCATIONS.store(0, Ordering::SeqCst);
        ARMED.store(true, Ordering::SeqCst);
    }

    /// Stops counting and returns the number of allocations counted.
    pub fn disarm() -> u64 {
        ARMED.store(false, Ordering::SeqCst);
        ALLOCATIONS.load(Ordering::SeqCst)
    }

    fn count() {
        if ARMED.load(Ordering::Relaxed) && TRACKED.with(Cell::get) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
    }
}

// SAFETY: every call forwards to the system allocator unchanged; counting touches only atomics
// and a thread-local flag, neither of which allocates.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.dealloc(ptr, layout) }
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

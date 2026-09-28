//! The engine core: scene storage, transforms, instance batches, culling, frame arenas, the frame
//! handoff to the render worker, and the job system. It compiles natively for tests, and to
//! WebAssembly twice: with threads (atomics and shared memory) and without.
//!
//! # Module map
//!
//! | Module | Contents |
//! | --- | --- |
//! | [`handle`] | 30-bit handles (20-bit slot, 10-bit generation) and the slot allocator |
//! | [`bitset`] | Fixed-length bitsets walked 64 bits at a time |
//! | [`error`] | [`CoreError`] and the numeric codes of the TypeScript error table |
//! | [`math`] | 3 × 4 affine matrices: compose, multiply, bounding spheres |
//! | [`world`] | Per-frame world output: matrices and bounding spheres, double-buffered |
//! | [`scene`] | Scene objects by slot, 16-byte commands, the hierarchy and the transform update |
//! | [`instances`] | Instance batches: per-row arrays, dirty ranges, the batch table, memory epoch |
//! | [`culling`] | Frustum planes and SIMD sphere culling, serial and parallel |
//! | [`arena`] | Per-thread bump allocators reset each frame |
//! | [`snapshot`] | The frame handoff between the sketch worker and the render worker |
//! | [`jobs`] | The job system: parallel loops, background tasks, worker loops |
//! | `testing` | With the `testing` feature: a global allocator that counts allocations, for tests |
//!
//! Frame code allocates nothing: every buffer a frame uses is allocated at creation with a fixed
//! capacity. Arrays that TypeScript views are allocated once and never move.
#![feature(portable_simd)]
#![cfg_attr(
    all(target_arch = "wasm32", target_feature = "atomics"),
    feature(stdarch_wasm_atomic_wait)
)]
#![warn(missing_docs)]

pub mod arena;
pub mod bitset;
pub mod culling;
pub mod error;
pub mod handle;
pub mod instances;
pub mod jobs;
pub mod math;
pub mod scene;
mod shared;
pub mod snapshot;
#[cfg(feature = "testing")]
pub mod testing;
mod wait;
pub mod world;

pub use error::CoreError;

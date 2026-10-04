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
//! | [`bvh`] | Bounding volume hierarchies for raycasts and overlap queries: mesh trees, the scene's top level, and the stored format |
//! | [`cells`] | Grid cells that keep world matrices small, and the camera-to-cell offsets |
//! | [`error`] | [`CoreError`] and the numeric codes of the TypeScript error table |
//! | [`math`] | 3 × 4 affine matrices: compose, multiply, bounding spheres |
//! | [`animation`] | Skeletons, clips at a fixed key rate, and skinning matrices sampled in parallel |
//! | [`world`] | Per-frame world output: matrices and bounding spheres, double-buffered |
//! | [`scene`] | Scene objects by slot, 16-byte commands, the hierarchy and the transform update |
//! | [`instances`] | Instance batches: per-row arrays, dirty ranges, the batch table, memory epoch |
//! | [`sprites`] | Sprites: how a sprite batch packs each sprite into its row's world matrix |
//! | [`lines`] | Lines: how a line batch packs each segment into its row's world matrix |
//! | [`layers`] | Render layers: the masks that choose which views draw which sources |
//! | [`lights`] | The light table, and the lights each frame finds for a view |
//! | [`culling`] | Frustum planes and SIMD sphere culling, serial and parallel |
//! | [`occlusion`] | Software occlusion culling: blockers drawn into a small masked depth buffer, and spheres tested against it |
//! | [`depth_sort`] | Culling and back-to-front sorting of blended rows, for the transparent pass |
//! | [`clusters`] | Groups of nearby rows that culling tests as one sphere each |
//! | [`arena`] | Per-thread bump allocators reset each frame |
//! | [`alloc`] | Allocation that reports running out of memory instead of aborting |
//! | [`snapshot`] | The frame handoff between the sketch worker and the render worker |
//! | [`jobs`] | The job system: parallel loops, background tasks, worker loops |
//! | [`shared`] | Writes to disjoint parts of one buffer from a parallel loop's chunks |
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

pub mod alloc;
pub mod animation;
pub mod arena;
pub mod bitset;
pub mod bvh;
pub mod cells;
pub mod clusters;
pub mod culling;
pub mod depth_sort;
pub mod error;
pub mod handle;
pub mod instances;
pub mod jobs;
pub mod layers;
pub mod lights;
pub mod lines;
pub mod math;
pub mod occlusion;
pub mod scene;
pub mod shared;
pub mod snapshot;
pub mod sprites;
#[cfg(feature = "testing")]
pub mod testing;
mod wait;
pub mod world;

pub use error::CoreError;

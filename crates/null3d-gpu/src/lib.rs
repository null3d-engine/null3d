//! The GPU layer: resource ids, capability flags, the portable limits budget, and the binary draw
//! lists that any thread records and the GPU-owning thread replays.
//!
//! - `caps`: capability flags, limits and the offset alignment
//! - `ids`: resource id allocation
//! - `drawlist`: the draw-list format, its encoder and decoder, and the generated TypeScript constants
//! - `mock`: a backend for tests that replays draw lists and checks them

pub mod caps;
pub mod drawlist;
pub mod ids;
#[cfg(any(test, feature = "mock"))]
pub mod mock;

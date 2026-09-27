//! Scene storage, transforms, culling, animation, spatial queries and the job scheduler.
#![cfg_attr(
    all(target_arch = "wasm32", target_feature = "atomics"),
    feature(stdarch_wasm_atomic_wait)
)]
#![warn(missing_docs)]

pub mod bitset;
pub mod error;
pub mod handle;
pub mod jobs;
mod wait;

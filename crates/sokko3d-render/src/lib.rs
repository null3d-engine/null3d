//! The render graph, passes, materials and the post-processing chain.
//!
//! - `camera`: perspective projection with reversed depth, and view matrices
//! - `frame_data`: the per-frame uniform block the shaders read
//! - `geometry`: generators with three.js's parameters and vertex order
//! - `gpu_driven`: the WebGPU frame builder, with GPU culling and one prerecorded bundle
//! - `materials`: the material table
//! - `meshes`: mesh storage for both GPU paths
//! - `parallel_record`: draw lists recorded in chunks on the job workers, joined in chunk order

pub mod camera;
pub mod frame_data;
pub mod geometry;
pub mod gpu_driven;
pub mod materials;
pub mod meshes;
pub mod parallel_record;

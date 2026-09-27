//! The render graph, passes, materials and the post-processing chain.
//!
//! - `camera`: perspective projection with reversed depth, and view matrices
//! - `frame_data`: the per-frame uniform block the shaders read
//! - `geometry`: generators with three.js's parameters and vertex order
//! - `materials`: the material table
//! - `meshes`: mesh storage for both GPU paths

pub mod camera;
pub mod frame_data;
pub mod geometry;
pub mod materials;
pub mod meshes;

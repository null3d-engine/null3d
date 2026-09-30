//! The render graph, passes, materials and the post-processing chain.
//!
//! - `arrays`: meshes from arrays, with normals and tangents computed as three.js computes them
//! - `camera`: perspective projection with reversed depth, and view matrices
//! - `cpu_culled`: the WebGL2 frame builder, with culling on the job workers and an index list per
//!   view
//! - `final_pass`: the pass that tone maps the HDR scene color into the canvas
//! - `frame`: what every frame builder shares: its input, the scene settings, the per-parity lists
//! - `frame_data`: the per-frame uniform block the shaders read
//! - `frame_graph`: the engine's passes on the render graph, and the recording of its plan
//! - `geometry`: generators with three.js's parameters and vertex order
//! - `gpu_driven`: the WebGPU frame builder, with GPU culling and a prerecorded bundle per view
//! - `graph`: the render graph, which orders declared passes and plans their render passes and
//!   textures
//! - `materials`: the material table
//! - `meshes`: mesh storage for both GPU paths
//! - `output`: the output transform: the scene color's target, exposure and tone mapping
//! - `parallel_record`: draw lists recorded in chunks on the job workers, joined in chunk order
//! - `view`: views, each a camera, a layer mask and a target, culled on its own

pub mod arrays;
pub mod camera;
pub mod cpu_culled;
mod final_pass;
pub mod frame;
pub mod frame_data;
pub mod frame_graph;
pub mod geometry;
pub mod gpu_driven;
pub mod graph;
pub mod materials;
pub mod meshes;
pub mod output;
pub mod parallel_record;
pub mod view;

//! The render graph, passes, materials and the post-processing chain.
//!
//! - `arrays`: meshes from arrays, with normals and tangents computed as three.js computes them
//! - `background`: a texture that the camera's view draws behind every object
//! - `camera`: perspective and orthographic lenses with reversed depth, and view matrices
//! - `cells`: grid-cell culling, which both frame builders share: still objects in cell order, a
//!   box per cell, and the cells each view can see
//! - `cpu_culled`: the WebGL2 frame builder, with culling on the job workers and an index list per
//!   view
//! - `debug_lines`: the lines that a sketch draws for one frame, and the pass that draws them
//! - `frame`: what every frame builder shares: its input, the scene settings, the per-parity lists
//! - `frame_data`: the per-frame uniform block the shaders read
//! - `frame_graph`: the engine's passes on the render graph, and the recording of its plan
//! - `geometry`: generators with three.js's parameters and vertex order
//! - `gpu_driven`: the WebGPU frame builder, with GPU culling and a prerecorded bundle per view
//! - `graph`: the render graph, which orders declared passes and plans their render passes and
//!   textures
//! - `light_grid`: the clusters of a view, and the point and spot lights that reach each one
//! - `materials`: the material table
//! - `meshes`: mesh storage for both GPU paths
//! - `parallel_record`: draw lists recorded in chunks on the job workers, joined in chunk order
//! - `pipelines`: the render pipeline cache, by the key of everything that sets a pipeline apart
//! - `shadows`: the cascades of a directional light's shadows, fitted to the camera's view
//! - `textures`: texture arrays, their samplers and bind groups, and uploads under a byte budget
//! - `view`: views, each a camera, a layer mask and a target, culled on its own

pub mod arrays;
mod background;
pub mod camera;
mod cells;
pub mod cpu_culled;
pub mod debug_lines;
pub mod dfg;
pub mod frame;
pub mod frame_data;
pub mod frame_graph;
pub mod geometry;
pub mod gpu_driven;
pub mod graph;
pub mod light_grid;
pub mod materials;
pub mod meshes;
pub mod parallel_record;
pub mod pipelines;
pub mod shadows;
pub mod textures;
pub mod view;

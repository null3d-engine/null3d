//! The render graph, passes, materials and the post-processing chain.
//!
//! - `ao`: ambient occlusion, as three.js's GTAOPass finds it, which darkens the ambient light of
//!   the camera's opaque pass
//! - `arrays`: meshes from arrays, with normals and tangents computed as three.js computes them
//! - `background`: what the camera's view draws behind every object: a texture, an environment, a
//!   cube map or three.js's sky
//! - `bloom`: light that spreads from the scene's brightest parts, as three.js's UnrealBloomPass
//!   spreads it: a bright pass and five blurred levels that the final pass adds
//! - `camera`: perspective and orthographic lenses with reversed depth, and view matrices
//! - `cells`: grid-cell culling, which both frame builders share: still objects in cell order, a
//!   box per cell, and the cells each view can see
//! - `cpu_culled`: the WebGL2 frame builder, with culling on the job workers and an index list per
//!   view
//! - `debug_lines`: the lines that a sketch draws for one frame, and the pass that draws them
//! - `debug_view`: the debug views, which draw every mesh with one debug shading in place of its
//!   material's
//! - `dof`: depth of field, a camera lens's blur by distance from the focus, with the near and far
//!   fields apart, as three.js's BokehPass draws it in intent
//! - `environment`: the scene's environment map, which standard materials reflect and take
//!   diffuse light from, and its part of each frame's uniform block
//! - `final_pass`: the pass that tone maps the HDR scene color into the canvas, and grades it
//! - `fog`: the scene's fog, by distance, height and sun glow, and its part of each frame's uniform
//!   block
//! - `frame`: what every frame builder shares: its input, the scene settings, the per-parity lists
//! - `frame_data`: the per-frame uniform block the shaders read
//! - `frame_graph`: the engine's passes on the render graph, and the recording of its plan
//! - `geometry`: generators with three.js's parameters and vertex order
//! - `grading`: color grading through a 3D lookup table, and the vignette, as three.js's LUTPass
//!   and VignetteShader draw them in the final pass
//! - `gpu_driven`: the WebGPU frame builder, with GPU culling and a prerecorded bundle per view
//! - `graph`: the render graph, which orders declared passes and plans their render passes and
//!   textures
//! - `light_grid`: the clusters of a view, and the point and spot lights that reach each one
//! - `materials`: the material table
//! - `meshes`: mesh storage for both GPU paths
//! - `occlusion`: the camera's blockers for software occlusion culling on the WebGL2 path
//! - `outline`: a crisp line around the objects that the sketch outlines: a mask of the outlined
//!   objects, from which the final pass draws the line
//! - `output`: the output transform: the scene color's target, exposure and tone mapping
//! - `parallel_record`: draw lists recorded in chunks on the job workers, joined in chunk order
//! - `pipelines`: the render pipeline cache, by the key of everything that sets a pipeline apart
//! - `shadow_tiles`: the tiles of the point and spot lights' shadow atlas, and when each draws
//! - `shadows`: the cascades of a directional light's shadows, fitted to the camera's view
//! - `skinning`: skinned objects' bounds from their poses, the joint matrix texture, and the
//!   vertex format of skinned vertices, which both frame builders share
//! - `sorted`: the blended objects of the transparent pass, culled and sorted back to front
//! - `textures`: texture arrays, their samplers and bind groups, and uploads under a byte budget
//! - `view`: views, each a camera, a layer mask and a target, culled on its own

pub mod ao;
pub mod arrays;
pub mod background;
pub mod bloom;
pub mod camera;
mod cells;
pub mod cpu_culled;
pub mod debug_lines;
pub mod debug_view;
pub mod dfg;
pub mod dof;
pub mod effects;
pub mod environment;
mod final_pass;
pub mod fog;
pub mod frame;
pub mod frame_data;
pub mod frame_graph;
pub mod geometry;
pub mod gpu_driven;
pub mod grading;
pub mod graph;
pub mod light_grid;
pub mod materials;
pub mod meshes;
pub mod morph;
pub mod occlusion;
pub mod outline;
pub mod output;
pub mod parallel_record;
pub mod pipelines;
pub mod queries;
pub mod shadow_tiles;
pub mod shadows;
pub mod skinning;
mod sky_light;
pub mod sky_maps;
pub mod sorted;
pub mod textures;
pub mod view;
mod view_copy;

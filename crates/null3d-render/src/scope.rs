//! The scope of a GPU pass: the step of the frame that a pass records, as a number that the draw
//! list carries and the page turns into a name. A pass's scope is its declared role, and the role's
//! index, where it has one, in the high 16 bits. The first seven scopes of a frame are in the
//! engine's frame figures, so the stats overlay can show what each step of the frame costs and a
//! feature can add up the passes that carry its own work.
//!
//! The numbers are a contract with TypeScript: `crates/null3d-wasm/src/constants.rs` writes them
//! into `packages/engine/src/generated/core.ts`, and the page names each scope by them.

/// A pass that no scope names, such as a step that holds passes of more than one role.
pub const NONE: u32 = 0;

/// Lists the lights of each cluster of the camera's light grid.
pub const LIGHT_CLUSTERS: u32 = 1;
/// Skins the skinned meshes that some view draws.
pub const SKIN: u32 = 2;
/// Culls a view on the GPU.
pub const CULL: u32 = 3;
/// Draws the depth of a view's opaque objects.
pub const PREPASS: u32 = 4;
/// Draws a view's opaque objects.
pub const OPAQUE: u32 = 5;
/// Draws the occluders of a camera view for occlusion culling.
pub const OCCLUDERS: u32 = 6;
/// Builds a camera view's depth pyramid.
pub const PYRAMID: u32 = 7;
/// Culls a camera view against its depth pyramid.
pub const LATE_CULL: u32 = 8;
/// Draws the casters of a shadow cascade or tile.
pub const SHADOW: u32 = 9;
/// Draws the frame's debug lines.
pub const DEBUG_LINES: u32 = 10;
/// Draws a view's blended objects.
pub const TRANSPARENT: u32 = 11;
/// Draws the decals.
pub const DECALS: u32 = 12;
/// Draws the opaque objects again over the decals.
pub const DECAL_REDRAW: u32 = 13;
/// Draws the pickable objects into the id target.
pub const PICK: u32 = 14;
/// Copies the pick's id target.
pub const PICK_RESOLVE: u32 = 15;
/// Resolves the scene color into the canvas.
pub const RESOLVE: u32 = 16;
/// A step of bloom's chain.
pub const BLOOM: u32 = 17;
/// Draws the outline mask, and the objects that keep their display color.
pub const OUTLINE_MASK: u32 = 18;
/// Draws the objects of the skin pass.
pub const SKIN_LIGHT: u32 = 19;
/// A step of the subsurface blur.
pub const SUBSURFACE: u32 = 20;
/// A step of ambient occlusion.
pub const AO: u32 = 21;
/// A step of screen-space reflections.
pub const SSR: u32 = 22;
/// A pass of the custom effects.
pub const EFFECT: u32 = 23;
/// A step of depth of field.
pub const DOF: u32 = 24;
/// The volumetric fog's light step.
pub const FOG_LIGHT: u32 = 25;
/// The volumetric fog's block step.
pub const FOG_BLOCK: u32 = 26;
/// The volumetric fog's sum.
pub const FOG_SUM: u32 = 27;
/// The volumetric fog's apply step.
pub const FOG_APPLY: u32 = 28;
/// A step of temporal anti-aliasing.
pub const TAA: u32 = 29;
/// Copies a view's image into its target.
pub const VIEW_COPY: u32 = 30;
/// Draws a sketch's full-screen pass.
pub const FULLSCREEN: u32 = 31;
/// Runs a sketch's compute pass.
pub const COMPUTE: u32 = 32;
/// Copies the camera's opaque color for transmission.
pub const TRANSMISSION_COPY: u32 = 33;
/// Draws the moving objects into the motion target.
pub const MOTION: u32 = 34;
/// Draws motion as a color over the scene.
pub const MOTION_VIEW: u32 = 35;
/// Draws the camera's weighted surfaces.
pub const WEIGHTED: u32 = 36;
/// Blends the weighted layer over the scene color.
pub const WEIGHTED_COMPOSITE: u32 = 37;
/// Copies the camera's opaque depth for soft particles.
pub const PARTICLE_DEPTH_COPY: u32 = 38;
/// The still-camera accumulation's blend.
pub const ACCUMULATE: u32 = 39;
/// Tone maps the HDR scene color into the canvas.
pub const FINAL: u32 = 40;
/// Tone maps a still view's accumulated color.
pub const FINAL_STILL: u32 = 41;
/// Tone maps the HDR scene color with bloom's levels.
pub const FINAL_BLOOM: u32 = 42;
/// Draws the first step of the two-step pass.
pub const OUTPUT: u32 = 43;
/// Draws the first step of the two-step pass with bloom.
pub const OUTPUT_BLOOM: u32 = 44;
/// Reduces the camera view's depth, for the next frame's fitted light clusters.
pub const LIGHT_DEPTH: u32 = 45;
/// Draws the camera's blended surfaces into the moment layer's moment store.
pub const MOMENT: u32 = 46;
/// Draws the same surfaces again into the moment layer's color sum.
pub const MOMENT_COLOUR: u32 = 47;
/// Blends the moment layer over the scene color.
pub const MOMENT_COMPOSITE: u32 = 48;
/// Marks the moment layer's edges for SMAA.
pub const MOMENT_SMAA_EDGES: u32 = 49;
/// Finds the ends and areas of those edges.
pub const MOMENT_SMAA_BLEND: u32 = 50;
/// Mixes each pixel with the neighbour that its weights name.
pub const MOMENT_SMAA_RESOLVE: u32 = 51;

/// A scope of `kind` for a step by its place, such as the fourth step of bloom's chain.
pub fn of(kind: u32, index: u32) -> u32 {
    kind | (index << 16)
}

/// The kind of scope `id`: [`NONE`] or one of the constants above.
pub fn kind(id: u32) -> u32 {
    id & 0xffff
}

/// The place of `id` among the steps of its kind, or 0 for a kind with one step.
pub fn index(id: u32) -> u32 {
    id >> 16
}

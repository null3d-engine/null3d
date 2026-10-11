//! Volumetric fog: the light of the sun and the point and spot lights that the scene's fog scatters
//! toward the camera, through their shadows. Sun rays fall through gaps in the trees, and lamps
//! glow in cones. The engine lights a grid of cells that follow the camera's view (froxels), as
//! Frostbite and Unreal Engine do, in three steps of the render graph (see [`crate::frame_graph`]):
//!
//! 1. The light step draws one triangle over the grid's texture, whose texels are the cells. Each
//!    cell takes a point, moved by the frame's offset, and the fog's density there. It adds the
//!    sun's light where the shadow cascades see the point, and that of each point and spot light
//!    of its cluster, through its shadow tile, by Henyey-Greenstein's phase function. It blends the
//!    result with the last frame's grid at the same place in the world. The step binds the
//!    camera's frame group, which the frame builder records, so it reads the scene's shadows and
//!    clustered lights with no binding of its own for them.
//! 2. The sum step sums the cells in front of each cell, front to back, with the exact integral
//!    over each slice, into a second texture of the grid's size.
//! 3. The apply step adds the summed light at each pixel's depth to the scene's color, at the
//!    render size, and past the grid's reach the sun's light that the fog scatters there without
//!    shadows. It runs after the transparent passes and before the custom effects.
//!
//! The grid's slices lie side by side in one 2D texture, eight to a row of tiles, and each tile
//! has the canvas's shape with a fixed count of cells on its short side, so the grid's cost does
//! not follow the screen's pixels. Two textures hold the light step's result and take turns, so
//! each frame reads the last frame's grid from one and writes the other. The fog of
//! [`crate::fog`] stays: it dims each surface and mixes in the fog's color. The grid only adds the
//! light of the sun and the lamps, and replaces the sun glow of the camera's view.
//!
//! The steps' settings live in one uniform block, which every step reads and each frame uploads:
//! the cells' offsets change every frame.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    resource_kind, state_flags, template,
};

use crate::bloom::{CornerMap, bytes_of, rows_before};
use crate::camera::{Mat4, invert, multiply};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// Slices in each row of tiles of the grid's texture.
pub const SLICES_PER_ROW: u32 = 8;

/// The slice counts that the quality setting takes above 0, from the lightest.
pub const SLICE_COUNTS: [u32; 3] = [32, 64, 96];

/// The format of the grid's textures: light in `rgb` and density or the share of light that
/// passes in `a`.
pub(crate) const GRID_FORMAT: u32 = format::RGBA16_FLOAT;

/// The format of the apply step's target: HDR color, as the scene color holds it.
pub(crate) const FORMAT: u32 = format::RGBA16_FLOAT;

/// The weight of the last frame's grid in each cell's light: as Unreal Engine's default. The
/// frames' offsets then average over about ten frames.
const HISTORY_WEIGHT: f32 = 0.9;

/// The shortest distance from a lamp at which the light step counts its light, in world units.
/// Nearer, a point light's light grows without bound, which no cell can hold.
const NEAREST_LAMP: f32 = 0.25;

/// The frames of the cells' offsets before they repeat.
const OFFSETS: u32 = 16;

/// The steps: the light step, the sum and the apply step.
pub(crate) const STEPS: usize = 3;

/// The bind groups: the light step's and the sum's for each of the two light textures, then the
/// apply step's.
pub const GROUPS: u32 = 5;

/// Bytes of the uniform buffer, a multiple of the offset alignment that bind groups need.
const BUFFER_BYTES: usize = 512;

/// How volumetric fog looks.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Volumetric {
    /// How much of the lights' light the fog scatters, on top of what its density gives.
    pub intensity: f32,
    /// Henyey-Greenstein's g, from -1 to 1: how much of the light the fog scatters forward.
    pub anisotropy: f32,
    /// How far along the view the grid reaches, in world units.
    pub distance: f32,
    /// The fog's density at its own height, as exponential fog has it: the fog's `density` with
    /// every curve.
    pub density: f32,
}

impl Default for Volumetric {
    fn default() -> Self {
        Self {
            intensity: 1.0,
            anisotropy: 0.6,
            distance: 100.0,
            density: 0.01,
        }
    }
}

/// The cells on the short side of each slice of a grid of `slices` slices.
pub fn short_side(slices: u32) -> u16 {
    match slices {
        0..=32 => 64,
        33..=64 => 96,
        _ => 128,
    }
}

/// The size of the grid's textures for a grid of `slices` slices.
pub(crate) fn grid_size(slices: u32) -> Size {
    Size::Tiles {
        short: short_side(slices),
        columns: SLICES_PER_ROW as u8,
        rows: slices.div_ceil(SLICES_PER_ROW).max(1) as u8,
    }
}

/// What a frame's volumetric fog draws with, for the camera's view.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FogVolumeFrame {
    pub volumetric: Volumetric,
    /// The slices of the grid's textures, and the slices that the frame draws, at most as many.
    pub slices: u32,
    pub drawn_slices: u32,
    /// The fog's density at the camera's height, and how fast it thins with height.
    pub density: f32,
    pub falloff: f32,
    /// The camera's view-projection matrix for positions relative to it.
    pub view_proj: Mat4,
    /// The inverse of the camera's projection, whose terms turn a depth value into a distance.
    pub inverse_projection: Mat4,
    /// The row whose dot product with `(position, 1)`, relative to the camera, gives its distance
    /// along the view.
    pub depth_row: [f32; 4],
    /// True for a perspective camera.
    pub perspective: bool,
    /// The camera's position in the world.
    pub camera: [f64; 3],
    /// The direction that the sun's light travels, and its exposed color.
    pub sun_direction: [f32; 3],
    pub sun_color: [f32; 3],
}

/// The steps' block, as `null3d::fog_volume` lays out its `FogStep` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Block {
    cells: [f32; 4],
    texel: [f32; 4],
    corner: [f32; 4],
    depth: [f32; 4],
    forward: [f32; 4],
    right: [f32; 4],
    up: [f32; 4],
    sun_direction: [f32; 4],
    sun_color: [f32; 4],
    medium: [f32; 4],
    jitter: [f32; 4],
    history_view_proj: Mat4,
    history_row: [f32; 4],
}

const _: () = assert!(std::mem::size_of::<Block>() <= BUFFER_BYTES);

/// The GPU objects of volumetric fog, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FogVolumeIds {
    /// The uniform buffer of the steps' block.
    pub(crate) buffer: u32,
    /// The linear sampler of every step.
    pub(crate) sampler: u32,
    /// The bind groups, from this id on: [`GROUPS`] of them.
    pub(crate) first_group: u32,
}

/// The textures that the steps read: the two light textures, the summed grid, and the scene's
/// color and depth.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct FogVolumeSources {
    pub(crate) lit: [u32; 2],
    pub(crate) summed: u32,
    pub(crate) color: u32,
    pub(crate) depth: u32,
}

/// The pipeline of step `step`: one triangle into its target.
const fn pipeline(step: usize, multisampled: bool) -> PipelineKey {
    let template = match step {
        0 => template::FOG_LIGHT,
        1 => template::FOG_SUM,
        _ if multisampled => template::FOG_APPLY_MS,
        _ => template::FOG_APPLY,
    };
    PipelineKey {
        template,
        permutation: 0,
        vertex_format: 0,
        color_format: if step == STEPS - 1 {
            FORMAT
        } else {
            GRID_FORMAT
        },
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// The camera of a frame that drew the grid, which the next frame's light step reads its grid
/// from.
#[derive(Clone, Copy, Debug, PartialEq)]
struct History {
    view_proj: Mat4,
    depth_row: [f32; 4],
    camera: [f64; 3],
    /// What the grid's layout depended on: a frame with another layout reads no history.
    canvas: (u32, u32),
    slices: u32,
    drawn_slices: u32,
    distance: f32,
}

/// The `index`th number of the van der Corput sequence in base `base`, from 0 to 1.
fn radical_inverse(mut index: u32, base: u32) -> f32 {
    let mut result = 0.0;
    let mut fraction = 1.0 / base as f32;
    while index > 0 {
        result += (index % base) as f32 * fraction;
        index /= base;
        fraction /= base as f32;
    }
    result
}

/// The offset of each cell's point from its center in frame `frame`, in cells each way: the
/// Halton sequence in bases 2, 3 and 5, which covers a cell evenly over [`OFFSETS`] frames.
pub(crate) fn offset(frame: u32) -> [f32; 3] {
    let index = frame % OFFSETS + 1;
    [2, 3, 5].map(|base| radical_inverse(index, base) - 0.5)
}

/// The position relative to the camera, divided by its distance along the view for a perspective
/// camera, of the point at normalized device coordinates `x` and `y` on the near plane of the
/// camera whose view-projection matrix has the inverse `inverse`.
fn unproject(inverse: &Mat4, x: f32, y: f32) -> [f32; 3] {
    let column = |k: usize| inverse[k * 4..k * 4 + 4].try_into().unwrap_or([0.0; 4]);
    let [c0, c1, c2, c3]: [[f32; 4]; 4] = [column(0), column(1), column(2), column(3)];
    // The near plane holds depth 1 in reversed depth.
    let p: [f32; 4] = std::array::from_fn(|k| c0[k] * x + c1[k] * y + c2[k] + c3[k]);
    let w = if p[3].abs() > 1e-12 { p[3] } else { 1e-12 };
    [p[0] / w, p[1] / w, p[2] / w]
}

/// The camera's rays for the steps: the ray through the view's center, then its change toward the
/// right and the top edges. For a perspective camera each ray's part along the view is 1, so a
/// point at distance d along the view lies at d times the ray. For an orthographic camera the
/// first is the view's direction, and the others reach the view's edges.
fn rays(frame: &FogVolumeFrame) -> [[f32; 3]; 3] {
    let Some(inverse) = invert(&frame.view_proj) else {
        return [[0.0, 0.0, -1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
    };
    let row = frame.depth_row;
    let along = |p: [f32; 3]| row[0] * p[0] + row[1] * p[1] + row[2] * p[2];
    let center = unproject(&inverse, 0.0, 0.0);
    let right = unproject(&inverse, 1.0, 0.0);
    let top = unproject(&inverse, 0.0, 1.0);
    if frame.perspective {
        let ray = |p: [f32; 3]| {
            let d = along(p).max(1e-12);
            p.map(|v| v / d)
        };
        let (c, r, t) = (ray(center), ray(right), ray(top));
        [
            c,
            std::array::from_fn(|k| r[k] - c[k]),
            std::array::from_fn(|k| t[k] - c[k]),
        ]
    } else {
        let length = (row[0] * row[0] + row[1] * row[1] + row[2] * row[2]).sqrt();
        let forward = [row[0], row[1], row[2]].map(|v| v / length.max(1e-12));
        [
            forward,
            std::array::from_fn(|k| right[k] - center[k]),
            std::array::from_fn(|k| top[k] - center[k]),
        ]
    }
}

/// The terms of an inverse projection that give a depth value's view-space z.
fn depth_terms(inverse: &Mat4) -> [f32; 4] {
    [inverse[10], inverse[14], inverse[11], inverse[15]]
}

/// Volumetric fog's GPU objects, its last frame's camera and what the GPU holds.
#[derive(Debug)]
pub(crate) struct FogVolumePass {
    ids: FogVolumeIds,
    /// True when the scene's depth target is multisampled, so the apply step reads sample 0.
    multisampled: bool,
    /// True on WebGL2, which counts rows from the bottom.
    rows_from_bottom: bool,
    pipelines: [Option<u32>; STEPS],
    created: bool,
    /// The textures that the bind groups read, before the first group exists the default.
    bound: Option<FogVolumeSources>,
    /// The frames that drew the grid, which pick each frame's offset and light texture.
    frames: u32,
    /// The camera of the last frame that drew the grid, while the next frame may read its grid.
    history: Option<History>,
}

impl FogVolumePass {
    /// Volumetric fog's steps, with GPU objects from `ids`, for a scene depth of `samples`, on
    /// WebGL2 with `rows_from_bottom`.
    pub(crate) fn new(ids: FogVolumeIds, samples: u32, rows_from_bottom: bool) -> Self {
        Self {
            ids,
            multisampled: samples > 1,
            rows_from_bottom,
            pipelines: [None; STEPS],
            created: false,
            bound: None,
            frames: 0,
            history: None,
        }
    }

    /// Bytes a frame may copy into its arena: the block.
    pub(crate) const UPLOAD_BYTES: usize = std::mem::size_of::<Block>();

    /// Asks `pipelines` for the steps' pipelines, once.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        for (step, slot) in self.pipelines.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(pipelines.id(pipeline(step, self.multisampled)));
            }
        }
    }

    /// The ids of the steps' pipelines that the pass asked for.
    pub(crate) fn pipeline_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.pipelines.iter().flatten().copied()
    }

    /// The light texture that the frame being recorded writes: 0 or 1. The other holds the last
    /// frame's grid.
    pub(crate) fn parity(&self) -> usize {
        (self.frames & 1) as usize
    }

    /// Makes the buffer and the sampler when the GPU lacks them, writes and uploads the block for
    /// `frame`, and binds the steps to `sources` when they changed or the frame made the plan's
    /// textures again. A frame after one that made the textures again, or changed the grid's
    /// layout, reads no last grid.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (canvas, scale): ((u32, u32), RenderScale),
        frame: &FogVolumeFrame,
        sources: FogVolumeSources,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.buffer,
                    BUFFER_BYTES as u32,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            list.push(
                Op::CreateSampler,
                &[
                    ids.sampler,
                    address::CLAMP_TO_EDGE,
                    address::CLAMP_TO_EDGE,
                    address::CLAMP_TO_EDGE,
                    filter::LINEAR,
                    filter::LINEAR,
                    filter::NEAREST,
                    0f32.to_bits(),
                    0f32.to_bits(),
                    compare::NONE,
                    1,
                ],
            )?;
            self.created = true;
        }
        if textures_made || self.bound != Some(sources) {
            self.bind(list, sources)?;
            self.bound = Some(sources);
            self.history = None;
        }
        self.frames = self.frames.wrapping_add(1);
        let block = self.block(canvas, scale, frame);
        let (at, bytes) = arena.push(bytes_of(&block))?;
        list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
        self.history = Some(History {
            view_proj: frame.view_proj,
            depth_row: frame.depth_row,
            camera: frame.camera,
            canvas,
            slices: frame.slices,
            drawn_slices: frame.drawn_slices,
            distance: frame.volumetric.distance,
        });
        Ok(())
    }

    /// The step's block for `frame`, for a canvas of `canvas` pixels at render scale `scale`.
    fn block(&self, canvas: (u32, u32), scale: RenderScale, frame: &FogVolumeFrame) -> Block {
        let tile = Size::tile(short_side(frame.slices), canvas);
        let extent = grid_size(frame.slices).extent(canvas);
        let scene = CornerMap::area(Size::Full, canvas, scale);
        let first_row = rows_before(scene.extent.1, scene.corner.1, self.rows_from_bottom);
        let [forward, right, up] = rays(frame);
        let flag = |on: bool| if on { 1.0 } else { 0.0 };
        let vector = |v: [f32; 3], w: f32| [v[0], v[1], v[2], w];
        let distance = frame.volumetric.distance.max(1e-3);
        // The last frame's grid, where it had the same layout.
        let history = self.history.filter(|last| {
            last.canvas == canvas
                && last.slices == frame.slices
                && last.drawn_slices == frame.drawn_slices
                && last.distance == frame.volumetric.distance
        });
        let (weight, history_view_proj, history_row) = match history {
            Some(last) => {
                // The last frame's positions relative to its camera are this frame's plus the
                // camera's move, computed in 64-bit floats so a camera far from the origin keeps
                // its digits.
                let moved: [f32; 3] =
                    std::array::from_fn(|k| (frame.camera[k] - last.camera[k]) as f32);
                let mut translate: Mat4 = [0.0; 16];
                for k in 0..4 {
                    translate[k * 5] = 1.0;
                }
                translate[12..15].copy_from_slice(&moved);
                let row = last.depth_row;
                let shifted = row[3] + row[0] * moved[0] + row[1] * moved[1] + row[2] * moved[2];
                (
                    HISTORY_WEIGHT,
                    multiply(&last.view_proj, &translate),
                    [row[0], row[1], row[2], shifted],
                )
            }
            None => (0.0, [0.0; 16], [0.0; 4]),
        };
        let intensity = frame.volumetric.intensity.max(0.0);
        // A frame that reads no last grid samples each cell's center, so a still image, such as
        // hold mode's single frame, does not depend on the frame's number.
        let [x, y, z] = if weight > 0.0 {
            offset(self.frames)
        } else {
            [0.0; 3]
        };
        Block {
            cells: [
                tile.0 as f32,
                tile.1 as f32,
                frame.drawn_slices.clamp(1, frame.slices.max(1)) as f32,
                distance,
            ],
            texel: [
                1.0 / extent.0 as f32,
                1.0 / extent.1 as f32,
                flag(self.rows_from_bottom),
                flag(frame.perspective),
            ],
            corner: [
                0.0,
                first_row as f32,
                1.0 / scene.corner.0.max(1) as f32,
                1.0 / scene.corner.1.max(1) as f32,
            ],
            depth: depth_terms(&frame.inverse_projection),
            forward: vector(forward, 0.0),
            right: vector(right, 0.0),
            up: vector(up, 0.0),
            sun_direction: vector(
                frame.sun_direction,
                frame.volumetric.anisotropy.clamp(-0.95, 0.95),
            ),
            sun_color: vector(frame.sun_color.map(|c| c * intensity), intensity),
            medium: [frame.density.max(0.0), frame.falloff, weight, NEAREST_LAMP],
            jitter: [x, y, z, 0.0],
            history_view_proj,
            history_row,
        }
    }

    /// Records the bind groups: the light step's of each light texture, which reads the other one,
    /// the sum's of each light texture, and the apply step's.
    fn bind(&self, list: &mut DrawList, sources: FogVolumeSources) -> Result<(), RecordError> {
        let ids = self.ids;
        let block = [
            0,
            resource_kind::BUFFER,
            ids.buffer,
            0,
            std::mem::size_of::<Block>() as u32,
        ];
        let texture = |binding: u32, id: u32| [binding, resource_kind::TEXTURE, id, 0, 0];
        let sampler = [2, resource_kind::SAMPLER, ids.sampler, 0, 0];
        let mut words = [0u32; 3 + 5 * 5];
        let apply_layout = if self.multisampled {
            bind_layout::DOF_COMPOSITE_MS
        } else {
            bind_layout::DOF_COMPOSITE
        };
        for group in 0..GROUPS {
            let (layout, entries): (u32, &[[u32; 5]]) = match group {
                0 | 1 => (
                    bind_layout::BLOOM,
                    &[block, texture(1, sources.lit[1 - group as usize]), sampler],
                ),
                2 | 3 => (
                    bind_layout::BLOOM,
                    &[block, texture(1, sources.lit[group as usize - 2]), sampler],
                ),
                _ => (
                    apply_layout,
                    &[
                        block,
                        texture(1, sources.color),
                        sampler,
                        texture(3, sources.depth),
                        texture(4, sources.summed),
                    ],
                ),
            };
            words[..3].copy_from_slice(&[ids.first_group + group, layout, entries.len() as u32]);
            for (place, entry) in entries.iter().enumerate() {
                words[3 + 5 * place..][..5].copy_from_slice(entry);
            }
            list.push(Op::CreateBindGroup, &words[..3 + 5 * entries.len()])?;
        }
        Ok(())
    }

    /// Sets the light step's pipeline and binds its own group at index 1, for the light texture
    /// that the frame writes. The frame builder then binds the camera's frame group at index 0,
    /// and [`FogVolumePass::draw`] draws.
    pub(crate) fn begin_light(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let pipeline = self.pipelines[0].expect("the steps ask for their pipelines first");
        list.push(Op::SetPipeline, &[pipeline])?;
        let group = self.ids.first_group + self.parity() as u32;
        list.push(Op::SetBindGroup, &[1, group, 0])?;
        Ok(())
    }

    /// Draws one triangle with the pipeline and groups that are set.
    pub(crate) fn draw(&self, list: &mut DrawList) -> Result<(), RecordError> {
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Records the sum (`step` 1) or the apply step (`step` 2) inside the render pass that the
    /// render graph began into its target.
    pub(crate) fn record(&self, list: &mut DrawList, step: usize) -> Result<(), RecordError> {
        let pipeline = self.pipelines[step].expect("the steps ask for their pipelines first");
        list.push(Op::SetPipeline, &[pipeline])?;
        let group = match step {
            1 => 2 + self.parity() as u32,
            _ => 4,
        };
        list.push(Op::SetBindGroup, &[0, self.ids.first_group + group, 0])?;
        self.draw(list)
    }

    /// Forgets the GPU objects and the last grid, so the next frame makes them again, after the
    /// thread that draws replaced the GPU. The pipelines keep their ids, which the cache creates
    /// again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.bound = None;
        self.history = None;
    }

    /// Forgets the last grid, so the next frame that draws the grid reads none: after frames that
    /// drew without it.
    pub(crate) fn forget_history(&mut self) {
        self.history = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::perspective_reversed;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() <= 1e-4 * a.abs().max(b.abs()).max(1.0)
    }

    /// A frame of a camera at the origin that looks down -z with a field of view of 90 degrees
    /// on a square canvas.
    fn frame() -> FogVolumeFrame {
        let projection = perspective_reversed(std::f32::consts::FRAC_PI_2, 1.0, 0.1, 500.0);
        FogVolumeFrame {
            volumetric: Volumetric::default(),
            slices: 64,
            drawn_slices: 64,
            density: 0.02,
            falloff: 0.0,
            view_proj: projection,
            inverse_projection: invert(&projection).unwrap(),
            depth_row: [0.0, 0.0, -1.0, 0.0],
            perspective: true,
            camera: [0.0; 3],
            sun_direction: [0.0, -1.0, 0.0],
            sun_color: [1.0; 3],
        }
    }

    #[test]
    fn the_shader_lays_out_the_block_as_the_core_writes_it() {
        let library = include_str!("../../null3d-shaders/wgsl/lib/fog_volume.wgsl");
        let fields = [
            "grid: FogGrid,",
            "corner: vec4f,",
            "depth: vec4f,",
            "forward: vec4f,",
            "right: vec4f,",
            "up: vec4f,",
            "sun_direction: vec4f,",
            "sun_color: vec4f,",
            "medium: vec4f,",
            "jitter: vec4f,",
            "history_view_proj: mat4x4f,",
            "history_row: vec4f,",
        ];
        let mut at = 0;
        for field in fields {
            let found = library[at..].find(field);
            assert!(found.is_some(), "FogStep lacks {field} in this order");
            at += found.unwrap_or(0);
        }
        assert_eq!(std::mem::size_of::<Block>(), 13 * 16 + 64);
        assert!(library.contains(&format!("SLICES_PER_ROW: u32 = {SLICES_PER_ROW}u;")));
    }

    #[test]
    fn the_grid_follows_the_canvas_shape_with_its_slices_in_rows_of_eight() {
        // A wide canvas has the short side's cells down, and more across.
        assert_eq!(Size::tile(96, (1920, 1080)), (171, 96));
        assert_eq!(grid_size(64).extent((1920, 1080)), (171 * 8, 96 * 8));
        assert_eq!(grid_size(32).extent((1080, 1920)), (64 * 8, 114 * 4));
        // The render scale leaves the grid whole.
        let size = grid_size(96);
        assert_eq!(
            size.viewport((1920, 1080), RenderScale::from_thousandths(500)),
            size.extent((1920, 1080))
        );
    }

    #[test]
    fn the_offsets_cover_a_cell_evenly() {
        let mut sums = [0.0f32; 3];
        for frame in 0..OFFSETS {
            let o = offset(frame);
            for k in 0..3 {
                assert!(o[k] > -0.5 && o[k] < 0.5, "{o:?}");
                sums[k] += o[k];
            }
        }
        for sum in sums {
            assert!((sum / OFFSETS as f32).abs() < 0.07, "{sums:?}");
        }
        assert_eq!(offset(3), offset(3 + OFFSETS));
    }

    #[test]
    fn the_rays_reach_the_view_edges_with_one_unit_along_the_view() {
        let [forward, right, up] = rays(&frame());
        // A field of view of 90 degrees reaches as far sideways as along the view.
        assert!(
            close(forward[2], -1.0) && close(forward[0], 0.0),
            "{forward:?}"
        );
        assert!(close(right[0], 1.0) && close(right[2], 0.0), "{right:?}");
        assert!(close(up[1], 1.0) && close(up[2], 0.0), "{up:?}");
    }

    #[test]
    fn the_history_follows_the_camera_and_drops_on_a_new_layout() {
        let ids = FogVolumeIds {
            buffer: 1,
            sampler: 2,
            first_group: 3,
        };
        let mut pass = FogVolumePass::new(ids, 4, false);
        let mut pipelines = PipelineCache::default();
        pass.request_pipelines(&mut pipelines);
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = FogVolumeSources {
            lit: [10, 11],
            summed: 12,
            color: 13,
            depth: 14,
        };
        let mut run = |pass: &mut FogVolumePass, frame: &FogVolumeFrame| -> Vec<Op> {
            list.clear();
            arena.reset(FogVolumePass::UPLOAD_BYTES);
            pass.prepare(
                &mut list,
                &mut arena,
                ((1920, 1080), RenderScale::FULL),
                frame,
                sources,
                false,
            )
            .unwrap();
            null3d_gpu::drawlist::decode(list.words())
                .map(|c| c.unwrap().op)
                .collect()
        };
        let mut f = frame();
        let first = run(&mut pass, &f);
        assert_eq!(
            first
                .iter()
                .filter(|&&op| op == Op::CreateBindGroup)
                .count(),
            GROUPS as usize
        );
        assert_eq!(pass.parity(), 1);
        let block = pass.block((1920, 1080), RenderScale::FULL, &f);
        assert_eq!(
            block.medium[2], HISTORY_WEIGHT,
            "the second frame reads the first"
        );
        // The camera moved 2 units along x: a point relative to this camera lies 2 units further
        // along x relative to the last.
        f.camera = [2.0, 0.0, 0.0];
        let moved = pass.block((1920, 1080), RenderScale::FULL, &f);
        assert_eq!(
            run(&mut pass, &f),
            [Op::WriteBuffer],
            "a frame only uploads"
        );
        assert_eq!(pass.parity(), 0);
        let projection = frame().view_proj;
        let point = [0.0f32, 0.0, -10.0, 1.0];
        let clip = |m: &Mat4, p: [f32; 4]| -> [f32; 4] {
            std::array::from_fn(|r| (0..4).map(|k| m[k * 4 + r] * p[k]).sum())
        };
        let reprojected = clip(&moved.history_view_proj, point);
        let expected = clip(&projection, [2.0, 0.0, -10.0, 1.0]);
        for k in 0..4 {
            assert!(
                close(reprojected[k], expected[k]),
                "{reprojected:?} {expected:?}"
            );
        }
        // A new slice count changes the grid, so the next frame reads no history.
        f.drawn_slices = 32;
        assert_eq!(
            pass.block((1920, 1080), RenderScale::FULL, &f).medium[2],
            0.0
        );
        pass.forget_history();
        assert_eq!(
            pass.block((1920, 1080), RenderScale::FULL, &frame()).medium[2],
            0.0
        );
    }
}

//! Automatic exposure: the picture adapts to the scene's brightness, as an eye or a camera does
//! (decision record D-148). The scene color keeps the camera's exposure, which the core puts into
//! every light (see [`crate::output`]). A meter on the GPU reads the color that the final pass
//! reads, in the same frame, and writes the exposure into one texel. The final pass multiplies the
//! HDR color by it before FXAA, the vignette and the tone mapping (see [`crate::final_pass`]).
//!
//! The meter reads the scene's brightness in stops over middle gray, weights the image's center,
//! and takes the weighted mean of every sample or of the samples between two shares of the total
//! weight. The adapted stops move toward the metered ones, within the eye's range, at one speed
//! while the scene grows brighter and another while it grows darker. The factor is
//! `2^(compensation - adapted)`. The first frame that the meter reads after it starts takes the
//! metered stops at once. Hold mode draws one frame, so its image is the adapted image.
//!
//! The meter has two paths, by the quality setting and the device:
//!
//! - The histogram, on WebGPU: a compute step bins a grid of the color's samples, 128 on the
//!   render size's short side, and a second meters the bins, writes the state buffer and stores
//!   the exposure's texel.
//! - The downsample, on WebGL2 and wherever the quality setting asks for it: a full-screen step
//!   draws 16 x 16 cells of mean stops and center weights, a second draws the exposure's texel
//!   from them and the stored texel, and a copy then stores it for the next frame.
//!
//! The meter owns its few small GPU objects, which keep the state from frame to frame, so the
//! render graph has no target of its own for them. The frame graph records the meter's steps
//! before the final pass's render pass (see [`crate::frame_graph`]). While automatic exposure is
//! off, nothing of it is made or recorded.

use null3d_gpu::drawlist::{
    DrawList, NO_TARGET, Op, address, buffer_usage as usage, compare, format,
    layout as bind_layout, pass_flags, resource_kind, state_flags, template, texture_usage, view,
};
use null3d_gpu::pass_role::{self, PassRole};

use crate::bloom::{Area, CornerMap, bytes_of};
use crate::frame::{LINEAR_LEVEL, RecordError, UploadArena, clamp_sampler};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey, built_by_or_first};

/// How the meter averages the scene's brightness.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Metering {
    /// The weighted mean of every sample's stops.
    Mean,
    /// The weighted mean of the samples between two shares of the total weight, which leaves out
    /// the darkest and the brightest parts of the image.
    #[default]
    Percentile,
}

impl Metering {
    /// The metering of its code: 0 the mean, 1 the percentile mean.
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Mean),
            1 => Some(Self::Percentile),
            _ => None,
        }
    }
}

/// How automatic exposure adapts.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AutoExposure {
    /// How the meter averages the scene's brightness.
    pub metering: Metering,
    /// The shares of the total weight, from 0 to 1, between which the percentile mean averages.
    pub percentiles: [f32; 2],
    /// How much more the image's center counts, from 0, even, to 1.
    pub center_weight: f32,
    /// Stops per second while the scene grows brighter.
    pub speed_up: f32,
    /// Stops per second while the scene grows darker.
    pub speed_down: f32,
    /// The darkest scene that the eye adapts to, in stops from the camera's exposure.
    pub min_ev: f32,
    /// The brightest scene that the eye adapts to, in stops from the camera's exposure.
    pub max_ev: f32,
    /// Stops added to the adapted exposure: above 0 brightens the picture.
    pub compensation: f32,
}

impl Default for AutoExposure {
    fn default() -> Self {
        Self {
            metering: Metering::Percentile,
            percentiles: [0.1, 0.9],
            center_weight: 0.5,
            speed_up: 3.0,
            speed_down: 1.0,
            min_ev: -4.0,
            max_ev: 4.0,
            compensation: 0.0,
        }
    }
}

impl AutoExposure {
    /// The shares of the total weight that the meter averages between: 0 and 1 for the mean, the
    /// percentiles in order for the percentile mean.
    fn shares(&self) -> [f32; 2] {
        match self.metering {
            Metering::Mean => [0.0, 1.0],
            Metering::Percentile => {
                let low = finite_or(self.percentiles[0], 0.1).clamp(0.0, 1.0);
                let high = finite_or(self.percentiles[1], 0.9).clamp(low, 1.0);
                [low, high]
            }
        }
    }
}

/// `value`, or `fallback` for a value that is not finite.
fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

/// The meter that the quality setting picks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Meter {
    /// The downsample: two full-screen steps of a fixed small size, on every GPU path.
    Downsample,
    /// The compute histogram, on WebGPU; WebGL2 takes the downsample.
    #[default]
    Histogram,
}

impl Meter {
    /// The meter of its code: 0 the downsample, 1 the histogram.
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Downsample),
            1 => Some(Self::Histogram),
            _ => None,
        }
    }
}

/// The downsample's cells each way.
pub const CELLS: u32 = 16;

/// The histogram's samples on the render size's short side.
pub const HISTOGRAM_SIDE: u32 = 128;

/// The invocations of a histogram workgroup each way, as `exposure_histogram.wgsl` sets them.
const WORKGROUP: u32 = 8;

/// The format of the downsample's cells: the mean stops and the center weight.
pub(crate) const CELL_FORMAT: u32 = format::RGBA16_FLOAT;

/// The format of the exposure's texel and of the stored texel: the factor, the adapted stops, the
/// metered stops and 1, in 32-bit floats, so a frame's small step of adaptation is not lost.
pub(crate) const TEXEL_FORMAT: u32 = format::RGBA32_FLOAT;

/// Bytes of the histogram buffer: one word per bin, as `null3d::exposure` counts them.
const HISTOGRAM_BYTES: u32 = 128 * 4;

/// Bytes of the state buffer: the last exposure's texel.
const STATE_BYTES: u32 = 16;

/// The meter's settings, as `null3d::exposure` lays out its `Settings` struct. Every step reads
/// the same block.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Block {
    map: [f32; 4],
    bounds: [f32; 4],
    grid: [f32; 4],
    shares: [f32; 4],
    limits: [f32; 4],
    adapt: [f32; 4],
}

/// Bytes of the uniform buffer: one block.
const BLOCK_BYTES: u32 = std::mem::size_of::<Block>() as u32;

/// The meter's compute objects, which only WebGPU's frame builder has.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ComputeIds {
    /// The histogram's bins.
    pub(crate) histogram: u32,
    /// The stored exposure.
    pub(crate) state: u32,
    /// The compute pipelines of the histogram and of the adaptation.
    pub(crate) pipelines: [u32; 2],
}

/// The GPU objects of the meter, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ExposureIds {
    /// The uniform buffer of the meter's block.
    pub(crate) buffer: u32,
    /// The linear sampler that the meter reads the color with.
    pub(crate) sampler: u32,
    /// The downsample's cells.
    pub(crate) cells: u32,
    /// The exposure's texel, which the final pass reads.
    pub(crate) texel: u32,
    /// The downsample's stored texel, which its next frame reads.
    pub(crate) stored: u32,
    /// The bind groups of the downsample's two steps, then of the histogram's steps.
    pub(crate) first_group: u32,
    /// The histogram's objects, on WebGPU.
    pub(crate) compute: Option<ComputeIds>,
}

/// The bind groups that the meter makes.
pub(crate) const GROUPS: u32 = 3;

/// What a frame's meter draws with: the settings, the meter, and the seconds since the frame
/// before.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ExposureFrame {
    pub(crate) settings: AutoExposure,
    pub(crate) meter: Meter,
    pub(crate) seconds: f32,
}

/// The pipeline of a downsample step: one triangle into the cells or into the texel.
const fn pipeline(adapt: bool) -> PipelineKey {
    PipelineKey {
        template: if adapt {
            template::EXPOSURE_ADAPT
        } else {
            template::EXPOSURE_LUMINANCE
        },
        permutation: 0,
        vertex_format: 0,
        color_format: if adapt { TEXEL_FORMAT } else { CELL_FORMAT },
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// The meter's GPU objects and what they hold.
#[derive(Debug)]
pub(crate) struct ExposurePass {
    ids: ExposureIds,
    /// True on WebGL2, which counts rows from the bottom.
    rows_from_bottom: bool,
    /// The downsample's pipelines, once asked for.
    pipelines: Option<[u32; 2]>,
    /// The frame whose list created the histogram's compute pipelines, once it did.
    compute_frame: Option<u32>,
    created: bool,
    /// The texture that the groups read, or `None` before they exist.
    bound: Option<u32>,
    /// The meter of the last frame that metered, or `None` when the frame before did not meter,
    /// so the next frame takes the metered stops at once. A frame notes its meter as it prepares.
    metered: Option<Meter>,
    /// The meter that the frame being recorded uses and its grid, once it is prepared, or `None` in
    /// a frame that does not meter.
    current: Option<(Meter, (u32, u32))>,
}

impl ExposurePass {
    /// The meter, with GPU objects from `ids`, on WebGL2 with `rows_from_bottom`.
    pub(crate) fn new(ids: ExposureIds, rows_from_bottom: bool) -> Self {
        Self {
            ids,
            rows_from_bottom,
            pipelines: None,
            compute_frame: None,
            created: false,
            bound: None,
            metered: None,
            current: None,
        }
    }

    /// Bytes a frame may copy into its arena: the block.
    pub(crate) const UPLOAD_BYTES: usize = BLOCK_BYTES as usize;

    /// The meter that `meter` asks for runs as: the histogram only where the builder has compute.
    pub(crate) fn path(&self, meter: Meter) -> Meter {
        match (meter, self.ids.compute) {
            (Meter::Histogram, Some(_)) => Meter::Histogram,
            _ => Meter::Downsample,
        }
    }

    /// Asks `pipelines` for the downsample's pipelines, once, and returns whether the pipelines of
    /// the path of `meter` are built, by `pipelines_built`.
    pub(crate) fn request_pipelines(
        &mut self,
        pipelines: &mut PipelineCache,
        meter: Meter,
        pipelines_built: u32,
    ) -> bool {
        if self.path(meter) == Meter::Histogram {
            return self
                .compute_frame
                .is_some_and(|frame| built_by_or_first(frame, pipelines_built));
        }
        let ids = *self
            .pipelines
            .get_or_insert_with(|| [pipelines.id(pipeline(false)), pipelines.id(pipeline(true))]);
        pipelines.all_built(ids.into_iter(), pipelines_built)
    }

    /// Records the creation of the histogram's compute pipelines in the list of `frame`, unless
    /// they exist or the builder has no compute. Returns true when it recorded them.
    pub(crate) fn create_compute_pipelines(
        &mut self,
        list: &mut DrawList,
        frame: u32,
    ) -> Result<bool, RecordError> {
        let Some(compute) = self.ids.compute else {
            return Ok(false);
        };
        if self.compute_frame.is_some() {
            return Ok(false);
        }
        for (id, template) in compute.pipelines.into_iter().zip([
            template::EXPOSURE_HISTOGRAM,
            template::EXPOSURE_ADAPT_HISTOGRAM,
        ]) {
            list.push(Op::CreateComputePipeline, &[id, template, 0])?;
        }
        self.compute_frame = Some(frame);
        Ok(true)
    }

    /// Makes the meter's objects when the GPU lacks them, uploads the frame's block, and binds the
    /// steps to `source`, the color that the final pass reads, when it changed or the frame made
    /// the plan's textures again.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (canvas, scale): ((u32, u32), RenderScale),
        frame: ExposureFrame,
        source: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !self.created {
            self.create_objects(list)?;
            self.created = true;
        }
        let meter = self.path(frame.meter);
        let scene = CornerMap::area(Size::Full, canvas, scale);
        let grid = grid_of(meter, scene.corner);
        let block = self.block(frame, meter, scene, grid);
        let (at, bytes) = arena.push(bytes_of(&block))?;
        list.push(Op::WriteBuffer, &[self.ids.buffer, 0, at, bytes])?;
        if textures_made || self.bound != Some(source) {
            self.bind(list, source)?;
            self.bound = Some(source);
        }
        self.current = Some((meter, grid));
        self.metered = Some(meter);
        Ok(())
    }

    /// The block of a frame of `frame` that meters with `meter` over a `grid` of the color whose
    /// area is `scene`.
    fn block(&self, frame: ExposureFrame, meter: Meter, scene: Area, grid: (u32, u32)) -> Block {
        let settings = frame.settings;
        let cells = Area {
            extent: grid,
            corner: grid,
        };
        let map = CornerMap::new(scene, cells, self.rows_from_bottom);
        let (width, height) = scene.corner;
        let [low, high] = settings.shares();
        let min_ev = finite_or(settings.min_ev, -4.0);
        let snap = self.metered != Some(meter);
        Block {
            map: map.map,
            bounds: map.bounds,
            grid: [
                grid.0 as f32,
                grid.1 as f32,
                width.max(1) as f32 / height.max(1) as f32,
                0.0,
            ],
            shares: [
                low,
                high,
                finite_or(settings.center_weight, 0.5).clamp(0.0, 1.0),
                0.0,
            ],
            limits: [
                min_ev,
                finite_or(settings.max_ev, 4.0).max(min_ev),
                finite_or(settings.compensation, 0.0),
                0.0,
            ],
            adapt: [
                finite_or(settings.speed_up, 3.0).max(0.0),
                finite_or(settings.speed_down, 1.0).max(0.0),
                finite_or(frame.seconds, 0.0).clamp(0.0, 1.0),
                if snap { 1.0 } else { 0.0 },
            ],
        }
    }

    /// Records the creation of the uniform buffer, the sampler, the cells and the two texels, and
    /// on WebGPU the histogram and the state buffer.
    fn create_objects(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let ids = self.ids;
        list.push(
            Op::CreateBuffer,
            &[ids.buffer, BLOCK_BYTES, usage::UNIFORM | usage::COPY_DST],
        )?;
        clamp_sampler(
            list,
            ids.sampler,
            address::CLAMP_TO_EDGE,
            LINEAR_LEVEL,
            0.0,
            compare::NONE,
        )?;
        let drawn = texture_usage::RENDER_ATTACHMENT | texture_usage::TEXTURE_BINDING;
        let storage = if ids.compute.is_some() {
            texture_usage::STORAGE_BINDING
        } else {
            0
        };
        for (id, size, format, usage) in [
            (ids.cells, CELLS, CELL_FORMAT, drawn),
            (
                ids.texel,
                1,
                TEXEL_FORMAT,
                drawn | texture_usage::COPY_SRC | storage,
            ),
            (
                ids.stored,
                1,
                TEXEL_FORMAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
            ),
        ] {
            list.push(
                Op::CreateTexture,
                &[id, size, size, 1, format, usage, 1, 1, view::D2],
            )?;
        }
        if let Some(compute) = ids.compute {
            list.push(
                Op::CreateBuffer,
                &[compute.histogram, HISTOGRAM_BYTES, usage::STORAGE],
            )?;
            list.push(
                Op::CreateBuffer,
                &[compute.state, STATE_BYTES, usage::STORAGE],
            )?;
        }
        Ok(())
    }

    /// Records the steps' bind groups: the downsample reads `source`, its adaptation the cells and
    /// the stored texel, and the histogram's steps `source`, the buffers and the texel.
    fn bind(&self, list: &mut DrawList, source: u32) -> Result<(), RecordError> {
        let ids = self.ids;
        let block = [0, resource_kind::BUFFER, ids.buffer, 0, BLOCK_BYTES];
        let texture = |binding: u32, id: u32| [binding, resource_kind::TEXTURE, id, 0, 0];
        let sampler = [2, resource_kind::SAMPLER, ids.sampler, 0, 0];
        let mut groups: [(u32, [[u32; 5]; 6], usize); 3] = [
            (
                bind_layout::EFFECT,
                [
                    block,
                    texture(1, source),
                    sampler,
                    texture(3, ids.stored),
                    [0; 5],
                    [0; 5],
                ],
                4,
            ),
            (
                bind_layout::EFFECT,
                [
                    block,
                    texture(1, ids.cells),
                    sampler,
                    texture(3, ids.stored),
                    [0; 5],
                    [0; 5],
                ],
                4,
            ),
            (bind_layout::EXPOSURE, [[0; 5]; 6], 0),
        ];
        if let Some(compute) = ids.compute {
            groups[2].1 = [
                block,
                texture(1, source),
                sampler,
                [
                    3,
                    resource_kind::BUFFER,
                    compute.histogram,
                    0,
                    HISTOGRAM_BYTES,
                ],
                [4, resource_kind::BUFFER, compute.state, 0, STATE_BYTES],
                texture(5, ids.texel),
            ];
            groups[2].2 = 6;
        }
        let mut words = [0u32; 3 + 5 * 6];
        for (index, (layout, entries, count)) in groups.iter().enumerate() {
            if *count == 0 {
                continue;
            }
            words[..3].copy_from_slice(&[ids.first_group + index as u32, *layout, *count as u32]);
            for (place, entry) in entries.iter().take(*count).enumerate() {
                words[3 + 5 * place..][..5].copy_from_slice(entry);
            }
            list.push(Op::CreateBindGroup, &words[..3 + 5 * count])?;
        }
        Ok(())
    }

    /// Records the meter's steps for the frame that [`Self::prepare`] prepared, outside any render
    /// pass: the histogram's compute pass, or the downsample's two render passes and the copy of
    /// the new texel into the stored one.
    pub(crate) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let Some((meter, grid)) = self.current else {
            return Ok(());
        };
        let ids = self.ids;
        match (meter, ids.compute) {
            (Meter::Histogram, Some(compute)) => {
                list.push(
                    Op::BeginComputePass,
                    &[pass_role::label(PassRole::ExposureHistogram, 0)],
                )?;
                list.push(Op::SetComputePipeline, &[compute.pipelines[0]])?;
                list.push(Op::SetBindGroup, &[0, ids.first_group + 2, 0])?;
                list.push(
                    Op::Dispatch,
                    &[grid.0.div_ceil(WORKGROUP), grid.1.div_ceil(WORKGROUP), 1],
                )?;
                list.push(Op::SetComputePipeline, &[compute.pipelines[1]])?;
                list.push(Op::Dispatch, &[1, 1, 1])?;
                list.push(Op::EndComputePass, &[])?;
            }
            _ => {
                let [downsample, adapt] = self
                    .pipelines
                    .expect("the downsample asks for its pipelines before it records");
                for (role, (target, pipeline, group)) in [
                    (
                        PassRole::ExposureDownsample,
                        (ids.cells, downsample, ids.first_group),
                    ),
                    (
                        PassRole::ExposureAdapt,
                        (ids.texel, adapt, ids.first_group + 1),
                    ),
                ] {
                    list.push(
                        Op::BeginRenderPass,
                        &[
                            target,
                            NO_TARGET,
                            NO_TARGET,
                            0,
                            0,
                            0,
                            0,
                            0f32.to_bits(),
                            pass_flags::STORE_COLOR,
                            pass_role::label(role, 0),
                        ],
                    )?;
                    list.push(Op::SetPipeline, &[pipeline])?;
                    list.push(Op::SetBindGroup, &[0, group, 0])?;
                    list.push(Op::Draw, &[3, 1, 0, 0])?;
                    list.push(Op::EndRenderPass, &[])?;
                }
                list.push(
                    Op::CopyTextureToTexture,
                    &[ids.texel, 0, 0, 0, 0, ids.stored, 0, 0, 0, 0, 1, 1, 1],
                )?;
            }
        }
        Ok(())
    }

    /// Notes a frame that did not meter, so the next frame that meters takes its stops at once.
    pub(crate) fn skip(&mut self) {
        self.metered = None;
        self.current = None;
    }

    /// The exposure's texel, which the final pass reads.
    pub(crate) fn texel(&self) -> u32 {
        self.ids.texel
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The render pipelines keep their ids, which the cache creates again; the
    /// compute pipelines are made again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.bound = None;
        self.metered = None;
        self.current = None;
        self.compute_frame = None;
    }
}

/// The grid that `meter` reads over a drawn corner of `corner` pixels: the downsample's cells, or
/// the histogram's samples, [`HISTOGRAM_SIDE`] on the short side, or fewer on a smaller corner.
pub(crate) fn grid_of(meter: Meter, corner: (u32, u32)) -> (u32, u32) {
    if meter == Meter::Downsample {
        return (CELLS, CELLS);
    }
    let (width, height) = (corner.0.max(1), corner.1.max(1));
    let side = HISTOGRAM_SIDE.min(width.min(height));
    let long = |long: u32, short: u32| {
        (u64::from(side) * u64::from(long)).div_ceil(u64::from(short)) as u32
    };
    if width >= height {
        (long(width, height), side)
    } else {
        (side, long(height, width))
    }
}

#[cfg(test)]
mod tests {
    use null3d_gpu::drawlist::decode;

    use super::*;

    const COMPUTE: ComputeIds = ComputeIds {
        histogram: 21,
        state: 22,
        pipelines: [31, 32],
    };

    fn ids(compute: bool) -> ExposureIds {
        ExposureIds {
            buffer: 20,
            sampler: 5,
            cells: 40,
            texel: 41,
            stored: 42,
            first_group: 60,
            compute: compute.then_some(COMPUTE),
        }
    }

    fn frame(meter: Meter) -> ExposureFrame {
        ExposureFrame {
            settings: AutoExposure::default(),
            meter,
            seconds: 1.0 / 60.0,
        }
    }

    /// The commands of a list, each its op and its operands.
    fn commands(list: &DrawList) -> Vec<(Op, Vec<u32>)> {
        decode(list.words())
            .map(|command| command.unwrap())
            .map(|command| (command.op, command.operands.to_vec()))
            .collect()
    }

    /// The block that a frame of `meter` would upload next from `pass`, on a canvas of 1920 x 1080.
    fn next_block(pass: &ExposurePass, meter: Meter) -> Block {
        let scene = CornerMap::area(Size::Full, (1920, 1080), RenderScale::FULL);
        let path = pass.path(meter);
        pass.block(frame(meter), path, scene, grid_of(path, scene.corner))
    }

    /// Prepares and records one frame of `pass` with `meter`, and returns its commands.
    fn metered(pass: &mut ExposurePass, meter: Meter) -> Vec<(Op, Vec<u32>)> {
        let mut list = DrawList::with_capacity(512);
        let mut arena = UploadArena::default();
        arena
            .reset(ExposurePass::UPLOAD_BYTES)
            .expect("room for the test's uploads");
        let mut pipelines = PipelineCache::default();
        pass.request_pipelines(&mut pipelines, meter, 0);
        pass.prepare(
            &mut list,
            &mut arena,
            ((1920, 1080), RenderScale::FULL),
            frame(meter),
            7,
            false,
        )
        .unwrap();
        pass.record(&mut list).unwrap();
        commands(&list)
    }

    /// The operands of each command of `op` in `list`.
    fn operands(list: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
        list.iter()
            .filter(|(o, _)| *o == op)
            .map(|(_, operands)| operands.clone())
            .collect()
    }

    #[test]
    fn the_histogram_reads_128_samples_on_the_short_side_and_the_downsample_16_cells() {
        assert_eq!(grid_of(Meter::Downsample, (1920, 1080)), (16, 16));
        assert_eq!(grid_of(Meter::Histogram, (1920, 1080)), (228, 128));
        assert_eq!(grid_of(Meter::Histogram, (1080, 1920)), (128, 228));
        // A corner smaller than the grid reads each pixel once.
        assert_eq!(grid_of(Meter::Histogram, (50, 40)), (50, 40));
    }

    #[test]
    fn the_mean_averages_every_share_and_the_percentiles_keep_their_order() {
        let mean = AutoExposure {
            metering: Metering::Mean,
            ..AutoExposure::default()
        };
        assert_eq!(mean.shares(), [0.0, 1.0]);
        assert_eq!(AutoExposure::default().shares(), [0.1, 0.9]);
        let crossed = AutoExposure {
            percentiles: [0.8, 0.2],
            ..AutoExposure::default()
        };
        assert_eq!(crossed.shares(), [0.8, 0.8]);
        let wild = AutoExposure {
            percentiles: [f32::NAN, 2.0],
            ..AutoExposure::default()
        };
        assert_eq!(wild.shares(), [0.1, 1.0]);
    }

    #[test]
    fn webgl2_meters_with_the_downsample_and_copies_its_texel_for_the_next_frame() {
        let mut pass = ExposurePass::new(ids(false), true);
        assert_eq!(pass.path(Meter::Histogram), Meter::Downsample);
        let list = metered(&mut pass, Meter::Histogram);
        let targets: Vec<u32> = operands(&list, Op::BeginRenderPass)
            .iter()
            .map(|operands| operands[0])
            .collect();
        assert_eq!(targets, [40, 41], "the cells, then the texel");
        assert_eq!(
            operands(&list, Op::CopyTextureToTexture),
            [vec![41, 0, 0, 0, 0, 42, 0, 0, 0, 0, 1, 1, 1]]
        );
        assert!(operands(&list, Op::BeginComputePass).is_empty());
        for texture in operands(&list, Op::CreateTexture) {
            assert_eq!(texture[5] & texture_usage::STORAGE_BINDING, 0);
        }
    }

    #[test]
    fn webgpu_bins_the_grid_in_one_compute_pass() {
        let mut pass = ExposurePass::new(ids(true), false);
        let mut list = DrawList::with_capacity(64);
        assert!(pass.create_compute_pipelines(&mut list, 3).unwrap());
        assert!(!pass.create_compute_pipelines(&mut list, 4).unwrap());
        let mut pipelines = PipelineCache::default();
        // The pipelines that frame 3 created are built once the thread that draws has drawn it.
        assert!(!pass.request_pipelines(&mut pipelines, Meter::Histogram, 2));
        assert!(pass.request_pipelines(&mut pipelines, Meter::Histogram, 3));
        assert!(
            pipelines.keys().is_empty(),
            "the histogram asks for no render pipeline"
        );
        let list = metered(&mut pass, Meter::Histogram);
        assert_eq!(
            operands(&list, Op::Dispatch),
            [vec![29, 16, 1], vec![1, 1, 1]]
        );
        assert!(operands(&list, Op::BeginRenderPass).is_empty());
        let groups = operands(&list, Op::CreateBindGroup);
        let histogram = groups
            .iter()
            .find(|group| group[0] == 62)
            .expect("the histogram's group");
        assert_eq!(histogram[1], bind_layout::EXPOSURE);
        // The Low preset's downsample runs on WebGPU too.
        let list = metered(&mut pass, Meter::Downsample);
        assert_eq!(operands(&list, Op::BeginRenderPass).len(), 2);
    }

    #[test]
    fn the_first_frame_that_meters_takes_its_stops_at_once() {
        let mut pass = ExposurePass::new(ids(false), true);
        assert_eq!(next_block(&pass, Meter::Downsample).adapt[3], 1.0);
        metered(&mut pass, Meter::Downsample);
        assert_eq!(next_block(&pass, Meter::Downsample).adapt[3], 0.0);
        // A frame without the meter snaps the next one again, as a new GPU does.
        pass.skip();
        assert_eq!(next_block(&pass, Meter::Downsample).adapt[3], 1.0);
        metered(&mut pass, Meter::Downsample);
        pass.reset_gpu();
        assert_eq!(next_block(&pass, Meter::Downsample).adapt[3], 1.0);
        // So does a change of meter, whose state lives elsewhere.
        let mut webgpu = ExposurePass::new(ids(true), false);
        metered(&mut webgpu, Meter::Downsample);
        assert_eq!(next_block(&webgpu, Meter::Histogram).adapt[3], 1.0);
    }

    #[test]
    fn the_block_keeps_the_range_in_order_and_the_shader_library_agrees() {
        let pass = ExposurePass::new(ids(false), false);
        let settings = AutoExposure {
            min_ev: 2.0,
            max_ev: -3.0,
            speed_up: -1.0,
            compensation: f32::INFINITY,
            ..AutoExposure::default()
        };
        let scene = CornerMap::area(Size::Full, (200, 100), RenderScale::FULL);
        let frame = ExposureFrame {
            settings,
            meter: Meter::Downsample,
            seconds: 5.0,
        };
        let block = pass.block(frame, Meter::Downsample, scene, (16, 16));
        assert_eq!(block.limits, [2.0, 2.0, 0.0, 0.0]);
        assert_eq!(
            block.adapt[..3],
            [0.0, 1.0, 1.0],
            "a long pause adapts at most a second"
        );
        assert_eq!(block.grid, [16.0, 16.0, 2.0, 0.0]);
        let library = include_str!("../../null3d-shaders/wgsl/lib/exposure.wgsl");
        for field in ["map", "bounds", "grid", "shares", "limits", "adapt"] {
            assert!(
                library.contains(&format!("    {field}: vec4f,")),
                "null3d::exposure's Settings lacks {field}"
            );
        }
        assert_eq!(BLOCK_BYTES, 6 * 16);
        assert!(library.contains(&format!("const BINS: u32 = {}u;", HISTOGRAM_BYTES / 4)));
        let histogram = include_str!("../../null3d-shaders/wgsl/exposure_histogram.wgsl");
        assert!(histogram.contains(&format!("@workgroup_size({WORKGROUP}, {WORKGROUP})")));
        let downsample = include_str!("../../null3d-shaders/wgsl/exposure.wgsl");
        assert!(downsample.contains(&format!("{CELLS} x {CELLS} cells")));
    }
}

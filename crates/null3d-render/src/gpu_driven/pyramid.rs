//! The depth pyramids of two-phase occlusion culling: one per camera view that culls in two
//! phases. A pyramid holds, level after level in one storage buffer, the farthest depth of each
//! square of the view's occluders' depth. Its first word counts the frame's occluders: each frame
//! resets it, the first culling phase counts, and in a frame with none the pyramid's dispatches
//! and the occlusion test do nothing. Level 0 halves the render size
//! each way, rounding up, and each later level halves the one before it, down to one texel. The
//! late culling pass reads the levels' table from its parameters (see [`super::cull`]).
//!
//! A compute pass builds the levels in batches of up to four, one dispatch each, from the occluder
//! depth and then from the last level of the batch before. Each workgroup keeps a tile of the
//! batch's levels in workgroup memory, so a 1280 x 720 render size takes 3 dispatches instead of
//! 10. Each dispatch binds the view's pyramid group at the dynamic offset of its batch's
//! parameters. The pyramid's buffer has room for the whole canvas, the largest render size, so a
//! new render scale only uploads new parameters.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, template,
};

use super::ids;
use crate::frame::{RecordError, UploadArena, words_as_bytes};
use crate::pipelines::built_by;
use crate::view::{MAX_VIEWS, ViewId};

/// The most levels of a pyramid: enough for a render size of 65,536 pixels each way.
pub(super) const MAX_LEVELS: usize = 16;
/// Levels that one dispatch builds at most, and the texels of its first level that one workgroup
/// builds, each way, one per thread.
const LEVELS_PER_BATCH: usize = 4;
const TILE: u32 = 8;
/// Batches of a pyramid at most.
const MAX_BATCHES: usize = MAX_LEVELS.div_ceil(LEVELS_PER_BATCH);
/// Bytes between the parameters of two batches: the dynamic offset alignment of every WebGPU
/// device.
const BATCH_STRIDE: u32 = 256;
/// Words of one batch's parameters: the level below its first, then each level it builds.
const BATCH_WORDS: usize = 4 * (1 + LEVELS_PER_BATCH);
const BATCH_BYTES: u32 = BATCH_WORDS as u32 * 4;
/// Bytes of a view's parameters of every batch.
pub(super) const PARAMS_BYTES: u32 = MAX_BATCHES as u32 * BATCH_STRIDE;

/// A pyramid's levels for one render size: each level's width and height in texels and where it
/// starts in the pyramid, in the 32-bit floats that the pyramid holds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Levels {
    /// The render size that the levels cover.
    pub(super) render: (u32, u32),
    pub(super) count: u32,
    pub(super) shapes: [[u32; 4]; MAX_LEVELS],
    /// The floats of every level.
    pub(super) floats: u32,
}

impl Levels {
    /// The levels of a pyramid over a render size of `width` x `height` pixels.
    pub(super) fn of(width: u32, height: u32) -> Self {
        // The first word counts the frame's occluders.
        let mut levels = Self {
            render: (width.max(1), height.max(1)),
            floats: 1,
            ..Self::default()
        };
        let (mut w, mut h) = levels.render;
        while (w, h) != (1, 1) && (levels.count as usize) < MAX_LEVELS {
            (w, h) = (w.div_ceil(2), h.div_ceil(2));
            levels.shapes[levels.count as usize] = [w, h, levels.floats, 0];
            levels.floats += w * h;
            levels.count += 1;
        }
        levels
    }

    /// The levels in use.
    pub(super) fn shapes(&self) -> &[[u32; 4]] {
        &self.shapes[..self.count as usize]
    }

    /// The batches that build the levels, each the levels it builds, from the first.
    fn batches(&self) -> impl Iterator<Item = &[[u32; 4]]> {
        self.shapes().chunks(LEVELS_PER_BATCH)
    }
}

/// A view's pyramid: the bytes of its buffer, its levels in the last recorded frame, and what its
/// bind group names.
#[derive(Clone, Copy, Debug, Default)]
struct ViewPyramid {
    bytes: u32,
    levels: Levels,
    /// The depth target that the view's group binds, or 0 before it has one.
    bound_depth: u32,
    /// The levels whose parameters the view's parameter buffer holds.
    uploaded: Option<(u32, u32)>,
}

/// Occlusion culling's pipelines and each camera view's pyramid.
#[derive(Debug)]
pub(super) struct Pyramids {
    views: [Option<ViewPyramid>; MAX_VIEWS],
    /// The frame whose list created the pipelines, once it did.
    pipelines_frame: Option<u32>,
}

impl Default for Pyramids {
    fn default() -> Self {
        Self {
            views: [None; MAX_VIEWS],
            pipelines_frame: None,
        }
    }
}

impl Pyramids {
    /// Records the creation of occlusion culling's pipelines, the depth pyramid's and the two
    /// culling phases', in the list of `frame`, unless they exist. Returns true when it recorded
    /// them.
    pub(super) fn create_pipelines(
        &mut self,
        list: &mut DrawList,
        frame: u32,
    ) -> Result<bool, RecordError> {
        if self.pipelines_frame.is_some() {
            return Ok(false);
        }
        for (id, template) in [
            (ids::PYRAMID, template::DEPTH_PYRAMID),
            (ids::OCCLUSION_EARLY, template::OCCLUSION_EARLY),
            (ids::OCCLUSION_LATE, template::OCCLUSION_LATE),
        ] {
            list.push(Op::CreateComputePipeline, &[id, template, 0])?;
        }
        self.pipelines_frame = Some(frame);
        Ok(true)
    }

    /// True once occlusion culling's pipelines are built: the thread that draws last drew every
    /// pipeline built in frame `pipelines_built`, or no frame was drawn yet, which waits for every
    /// pipeline.
    pub(super) fn built(&self, pipelines_built: u32) -> bool {
        self.pipelines_frame
            .is_some_and(|frame| pipelines_built == 0 || built_by(frame, pipelines_built))
    }

    /// Makes a view's pyramid for a canvas of `canvas` pixels, unless its buffers hold it, and
    /// binds its group when the group would name another depth target or buffer. `depth` is the
    /// view's depth target. Returns true when it made the pyramid's buffer, which the view's
    /// occlusion group names too.
    pub(super) fn prepare(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        canvas: (u32, u32),
        depth: u32,
    ) -> Result<bool, RecordError> {
        let pyramid = self.views[view.index()].get_or_insert_with(ViewPyramid::default);
        let made = pyramid.bytes != 0;
        if !made {
            list.push(
                Op::CreateBuffer,
                &[
                    ids::pyramid_params(view),
                    PARAMS_BYTES,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
        }
        let bytes = Levels::of(canvas.0, canvas.1).floats.max(1) * 4;
        let grown = pyramid.bytes < bytes;
        if grown {
            list.push(
                Op::CreateBuffer,
                &[ids::pyramid(view), bytes, usage::STORAGE | usage::COPY_DST],
            )?;
            pyramid.bytes = bytes;
        }
        if grown || pyramid.bound_depth != depth {
            let entry = |binding: u32, kind: u32, id: u32, size: u32| [binding, kind, id, 0, size];
            let entries = [
                entry(
                    0,
                    resource_kind::BUFFER,
                    ids::pyramid_params(view),
                    BATCH_BYTES,
                ),
                entry(1, resource_kind::BUFFER, ids::pyramid(view), 0),
                entry(2, resource_kind::TEXTURE, depth, 0),
            ];
            let mut words = [0u32; 3 + 5 * 3];
            words[..3].copy_from_slice(&[ids::pyramid_group(view), bind_layout::DEPTH_PYRAMID, 3]);
            words[3..].copy_from_slice(entries.as_flattened());
            list.push(Op::CreateBindGroup, &words)?;
            pyramid.bound_depth = depth;
        }
        Ok(grown)
    }

    /// Notes a view's levels for a render size of `render` pixels, and uploads their parameters
    /// when they changed. Resets the count of the view's occluders. Returns the levels, which the
    /// view's culling passes read.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        render: (u32, u32),
    ) -> Result<&Levels, RecordError> {
        let pyramid = self.views[view.index()]
            .as_mut()
            .expect("a view's pyramid exists before it uploads");
        let (at, bytes) = arena.push(words_as_bytes(&[0]))?;
        list.push(Op::WriteBuffer, &[ids::pyramid(view), 0, at, bytes])?;
        if pyramid.uploaded != Some(render) {
            pyramid.levels = Levels::of(render.0, render.1);
            let levels = &pyramid.levels;
            // The first batch reads the depth target; each later one the last level before it.
            let mut below = [render.0, render.1, 0, 1];
            for (batch, shapes) in levels.batches().enumerate() {
                let mut words = [0u32; BATCH_WORDS];
                words[..4].copy_from_slice(&below);
                words[4..4 + 4 * shapes.len()].copy_from_slice(shapes.as_flattened());
                let (at, _) = arena.push(words_as_bytes(&words))?;
                let offset = batch as u32 * BATCH_STRIDE;
                list.push(
                    Op::WriteBuffer,
                    &[ids::pyramid_params(view), offset, at, BATCH_BYTES],
                )?;
                let last = shapes[shapes.len() - 1];
                below = [last[0], last[1], last[2], 0];
            }
            pyramid.uploaded = Some(render);
        }
        Ok(&pyramid.levels)
    }

    /// Records the dispatches that build a view's pyramid, one per batch of levels, in order.
    pub(super) fn record(&self, list: &mut DrawList, view: ViewId) -> Result<(), RecordError> {
        let Some(pyramid) = self.views[view.index()].as_ref() else {
            return Ok(());
        };
        list.push(Op::SetComputePipeline, &[ids::PYRAMID])?;
        for (batch, shapes) in pyramid.levels.batches().enumerate() {
            let offset = batch as u32 * BATCH_STRIDE;
            list.push(Op::SetBindGroup, &[0, ids::pyramid_group(view), 1, offset])?;
            let first = shapes[0];
            list.push(
                Op::Dispatch,
                &[first[0].div_ceil(TILE), first[1].div_ceil(TILE), 1],
            )?;
        }
        Ok(())
    }

    /// Bytes that one frame may copy into its arena for a view's batches and its count of
    /// occluders.
    pub(super) const UPLOAD_BYTES: usize = MAX_BATCHES * BATCH_BYTES as usize + 4;

    /// Forgets every pyramid and the pipelines, so the next frames make them again, after the
    /// thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The culling shader works out each level's shape from the render size alone: level L is the
    /// render size over 2^(L + 1), rounded up, and starts after the count word and the levels
    /// before it. Its tests read the levels at those places.
    #[test]
    fn each_levels_shape_follows_from_the_render_size_as_the_culling_shader_works_it_out() {
        for (width, height) in [
            (1, 1),
            (2, 1),
            (320, 180),
            (1280, 720),
            (1919, 1081),
            (4097, 3),
        ] {
            let levels = Levels::of(width, height);
            let mut start = 1;
            for (level, shape) in levels.shapes().iter().enumerate() {
                let at = |side: u32| (side + (2u32 << level) - 1) >> (level + 1);
                assert_eq!(
                    shape[..3],
                    [at(width), at(height), start],
                    "level {level} of {width} x {height}"
                );
                start += at(width) * at(height);
            }
            assert_eq!(start, levels.floats);
        }
    }

    #[test]
    fn levels_halve_rounding_up_down_to_one_texel() {
        let levels = Levels::of(1920, 1080);
        let sizes: Vec<_> = levels.shapes().iter().map(|s| (s[0], s[1])).collect();
        assert_eq!(
            sizes,
            [
                (960, 540),
                (480, 270),
                (240, 135),
                (120, 68),
                (60, 34),
                (30, 17),
                (15, 9),
                (8, 5),
                (4, 3),
                (2, 2),
                (1, 1)
            ]
        );
        let mut start = 1;
        for shape in levels.shapes() {
            assert_eq!(shape[2], start);
            start += shape[0] * shape[1];
        }
        assert_eq!(levels.floats, start);
        assert_eq!(Levels::of(1, 1).count, 0);
        assert_eq!(Levels::of(65_536, 3).count as usize, MAX_LEVELS);
    }

    #[test]
    fn a_smaller_render_size_fits_the_canvas_pyramid() {
        let canvas = Levels::of(2560, 1440);
        for (w, h) in [(1280, 720), (2559, 1439), (1, 1440), (2000, 3)] {
            assert!(Levels::of(w, h).floats <= canvas.floats, "{w} x {h}");
        }
    }
}

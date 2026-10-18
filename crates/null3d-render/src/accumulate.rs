//! The still-camera accumulation's blend: one triangle over the render size that blends a frame's
//! scene color into a still view's kept history (see [`crate::still`]).
//!
//! The pass reads the scene color with `textureLoad`, so the texture has the same size as the
//! target: it draws at the render size, into the corner of a target of the canvas's size. Its
//! pipeline blends over the history, `src + dst * (1 - src alpha)`, and the shader writes the color
//! times the frame's weight with the weight as alpha, so the history becomes the mix of itself and
//! the color by the weight: no pass reads and writes the history at once, and no second target
//! holds the mix.
//!
//! The weight is one over the frames the view has accumulated, so the history holds their mean.
//! The first frame that blends has weight 1, which replaces whatever the history held, and a
//! resting view's frames have weight 0, which leaves it as it is. Each frame uploads the weight as
//! volatile bytes, which the still comparison leaves out.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, state_flags,
    template,
};

use crate::frame::{RecordError, UploadArena};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// Bytes of the blend's values, as `accumulate.wgsl`'s `Settings` block lays them out.
const BLOCK: u32 = 16;
/// Bytes a frame may copy into its arena: the blend's values.
pub(crate) const UPLOAD_BYTES: usize = BLOCK as usize;
/// The format of the history, which the blend draws into.
pub(crate) const FORMAT: u32 = format::RGBA16_FLOAT;

/// The GPU objects of the accumulation, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct AccumulateIds {
    /// The buffer of the blend's values.
    pub(crate) buffer: u32,
    /// The blend's bind group.
    pub(crate) group: u32,
}

/// The values of the blend, as `accumulate.wgsl` lays them out.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Settings {
    /// The weight of the frame's color: one over the frames accumulated, or 0 while the view rests.
    weight: f32,
    spare: [f32; 3],
}

impl Settings {
    /// The block as bytes, for an upload.
    fn as_bytes(&self) -> &[u8] {
        // SAFETY: the struct is `repr(C)` and made only of 4-byte fields, so it has no padding,
        // and every byte of it is initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u8>(),
                std::mem::size_of::<Self>(),
            )
        }
    }
}

/// The accumulation's GPU objects, and what they hold.
#[derive(Debug)]
pub(crate) struct AccumulatePass {
    ids: AccumulateIds,
    /// The pipeline's id in the builder's cache, once asked for.
    pipeline: Option<u32>,
    created: bool,
    /// The scene color that the bind group reads, or `None` before the group exists.
    bound: Option<u32>,
}

impl AccumulatePass {
    /// The accumulation, with GPU objects from `ids`.
    pub(crate) fn new(ids: AccumulateIds) -> Self {
        Self {
            ids,
            pipeline: None,
            created: false,
            bound: None,
        }
    }

    /// Asks `pipelines` for the blend's pipeline, once, and returns its id.
    pub(crate) fn request_pipeline(&mut self, pipelines: &mut PipelineCache) -> u32 {
        *self.pipeline.get_or_insert_with(|| {
            pipelines.id(PipelineKey {
                template: template::ACCUMULATE,
                permutation: 0,
                vertex_format: 0,
                color_format: FORMAT,
                depth_format: format::NONE,
                samples: 1,
                state: state_flags::CULL_NONE | state_flags::BLEND_NORMAL,
                bias: DepthBias::NONE,
            })
        })
    }

    /// Makes the blend's buffer when the GPU lacks it, uploads the values for a frame whose weight
    /// in the average is `weight`, and binds the scene color `color` when the group is new or the
    /// frame made the plan's textures again (`textures_made`). Returns the arena's offset of the
    /// weight, so a frame that turns out to have changed can take the whole weight.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        color: u32,
        weight: f32,
        textures_made: bool,
    ) -> Result<usize, RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[ids.buffer, BLOCK, usage::UNIFORM | usage::COPY_DST],
            )?;
            self.created = true;
        }
        let settings = Settings {
            weight,
            spare: [0.0; 3],
        };
        let weight_at = arena.bytes().len();
        let block = settings.as_bytes();
        let (at, bytes) = arena.push_masked(block, std::slice::from_ref(&(0..block.len())))?;
        list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
        if textures_made || self.bound != Some(color) {
            list.push(
                Op::CreateBindGroup,
                &[
                    ids.group,
                    bind_layout::ACCUMULATE,
                    2,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    0,
                    BLOCK,
                    1,
                    resource_kind::TEXTURE,
                    color,
                    0,
                    0,
                ],
            )?;
            self.bound = Some(color);
        }
        Ok(weight_at)
    }

    /// Records the blend inside the render pass that the render graph began into the history.
    pub(crate) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let pipeline = self
            .pipeline
            .expect("the accumulation asks for its pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.ids.group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipeline keeps its id, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.bound = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDS: AccumulateIds = AccumulateIds {
        buffer: 1,
        group: 2,
    };

    #[test]
    fn the_blend_uploads_its_weight_as_volatile_bytes_and_binds_once() {
        let mut pass = AccumulatePass::new(IDS);
        let mut pipelines = PipelineCache::default();
        let id = pass.request_pipeline(&mut pipelines);
        assert_eq!(pass.request_pipeline(&mut pipelines), id);
        assert_eq!(pipelines.keys().len(), 1);
        assert_ne!(pipelines.keys()[0].state & state_flags::BLEND_NORMAL, 0);

        let mut list = DrawList::with_capacity(256);
        let mut arena = UploadArena::default();
        arena.reset(UPLOAD_BYTES);
        let at = pass.prepare(&mut list, &mut arena, 10, 0.25, true).unwrap();
        // The weight's bytes are all volatile: the still comparison leaves them out.
        assert_eq!(at, 0);
        let weight = f32::from_le_bytes(arena.bytes()[at..at + 4].try_into().unwrap());
        assert_eq!(weight, 0.25);
        assert_eq!(arena.volatile(), std::slice::from_ref(&(0..BLOCK as usize)));
        assert_eq!(pass.bound, Some(10));
        // Each later frame uploads the weight alone, as the same command whatever its value, and
        // binds nothing again while the color holds.
        let before = list.len();
        arena.reset(UPLOAD_BYTES);
        pass.prepare(&mut list, &mut arena, 10, 0.5, false).unwrap();
        let one_frame = list.len() - before;
        arena.reset(UPLOAD_BYTES);
        pass.prepare(&mut list, &mut arena, 10, 0.0, false).unwrap();
        assert_eq!(list.len() - before, 2 * one_frame);
        // A color that moved binds again.
        arena.reset(UPLOAD_BYTES);
        pass.prepare(&mut list, &mut arena, 20, 0.5, false).unwrap();
        assert_eq!(pass.bound, Some(20));
    }
}

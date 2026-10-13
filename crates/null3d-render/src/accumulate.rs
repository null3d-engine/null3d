//! The still-camera accumulation's steps: the blend that averages a frame's scene color into a
//! still view's history, and the store that copies the average into the kept history, which the
//! next frame blends into (see [`crate::still`]).
//!
//! Both steps are one triangle over the whole target, one texel per pixel, and read their textures
//! with `textureLoad`, so the textures have the same size as the target: the passes draw at the
//! render size, into the corner of a target of the canvas's size. The store step is a separate
//! pass, because one pass may not both read and write the history: it binds a blank texel in place
//! of the history and copies what it reads.
//!
//! The blend step's weight is one over the frames the view has accumulated, so the history holds
//! their mean. The first frame of a still view has weight 1, which takes its own color and ignores
//! whatever the history held. Both steps share one pipeline: the shader is the same, and the flags
//! in the values pick what a step does.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, state_flags,
    template,
};

use crate::effects::create_texel;
use crate::frame::{RecordError, UploadArena};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// Bytes of one step's values, as `accumulate.wgsl`'s `Settings` block lays them out.
const BLOCK: u32 = 16;
/// Bytes a frame may copy into its arena: the values of both steps.
pub(crate) const UPLOAD_BYTES: usize = (2 * BLOCK) as usize;
/// The flag that makes a step the store step, which copies the color it reads.
const STORE: u32 = 1;
/// The steps, in the order the graph runs them.
pub(crate) const STEPS: usize = 2;
/// The blend step's place in [`STEPS`], and the store step's.
pub(crate) const BLEND: usize = 0;
pub(crate) const STORE_STEP: usize = 1;

/// The GPU objects of the accumulation, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct AccumulateIds {
    /// The buffer of the blend step's values.
    pub(crate) blend: u32,
    /// The buffer of the store step's values.
    pub(crate) store: u32,
    /// The bind group of each step, from this id: the blend step's, then the store step's.
    pub(crate) first_group: u32,
    /// The blank texel, of one texel, that the store step binds in place of the history.
    pub(crate) blank: u32,
}

/// One step's values, as `accumulate.wgsl`'s `Settings` block lays them out.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Settings {
    /// The weight of the frame's color: one over the frames accumulated, from 1.
    weight: f32,
    /// `STORE` for the store step, else 0.
    flags: u32,
    spare: [f32; 2],
}

impl Settings {
    /// The block as bytes, for an upload.
    fn as_bytes(&self) -> &[u8] {
        // SAFETY: the struct is `repr(C)` and made only of 4-byte fields, so it has no padding, and
        // any bytes of it are initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u8>(),
                std::mem::size_of::<Self>(),
            )
        }
    }
}

/// What the steps read and write this frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AccumulateInputs {
    /// The texture the blend step reads: the scene color as the effects and depth of field leave it.
    pub(crate) color: u32,
    /// The kept history that the blend step reads.
    pub(crate) history: u32,
    /// The target that the blend step writes and the store step reads.
    pub(crate) blended: u32,
}

/// The accumulation's GPU objects, and what they hold.
#[derive(Debug)]
pub(crate) struct AccumulatePass {
    ids: AccumulateIds,
    /// The target format the pipeline was asked for, or 0 before it was.
    format: u32,
    /// The pipeline's id in the builder's cache, once asked for.
    pipeline: Option<u32>,
    created: bool,
    /// The values the buffers hold, or `None` before the first upload.
    uploaded: Option<[Settings; 2]>,
    /// What each step's bind group reads, or `None` before the group exists.
    bound: [Option<(u32, u32)>; STEPS],
}

impl AccumulatePass {
    /// The accumulation, with GPU objects from `ids`.
    pub(crate) fn new(ids: AccumulateIds) -> Self {
        Self {
            ids,
            format: 0,
            pipeline: None,
            created: false,
            uploaded: None,
            bound: [None; STEPS],
        }
    }

    /// Asks `pipelines` for the step's pipeline into targets of `color_format`, and returns its id.
    /// Both steps share it.
    pub(crate) fn request_pipeline(
        &mut self,
        pipelines: &mut PipelineCache,
        color_format: u32,
    ) -> u32 {
        match self.pipeline {
            Some(id) if self.format == color_format => id,
            _ => {
                let id = pipelines.id(PipelineKey {
                    template: template::ACCUMULATE,
                    permutation: 0,
                    vertex_format: 0,
                    color_format,
                    depth_format: format::NONE,
                    samples: 1,
                    state: state_flags::CULL_NONE,
                    bias: DepthBias::NONE,
                });
                self.format = color_format;
                self.pipeline = Some(id);
                id
            }
        }
    }

    /// Makes the steps' buffers and the blank texel when the GPU lacks them, uploads the values for
    /// a frame whose weight in the average is `weight` when they changed, and binds each step to
    /// `inputs` when its group is new or the frame made the plan's textures again (`textures_made`).
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        inputs: AccumulateInputs,
        weight: f32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            for buffer in [ids.blend, ids.store] {
                list.push(
                    Op::CreateBuffer,
                    &[buffer, BLOCK, usage::UNIFORM | usage::COPY_DST],
                )?;
            }
            create_texel(list, ids.blank, format::RGBA16_FLOAT)?;
            self.created = true;
        }
        let blocks = [
            Settings {
                weight,
                flags: 0,
                spare: [0.0; 2],
            },
            Settings {
                weight: 1.0,
                flags: STORE,
                spare: [0.0; 2],
            },
        ];
        if self.uploaded != Some(blocks) {
            for (buffer, block) in [(ids.blend, &blocks[0]), (ids.store, &blocks[1])] {
                let (at, bytes) = arena.push(block.as_bytes())?;
                list.push(Op::WriteBuffer, &[buffer, 0, at, bytes])?;
            }
            self.uploaded = Some(blocks);
        }
        let reads = [(inputs.color, inputs.history), (inputs.blended, ids.blank)];
        for (step, &(first, second)) in reads.iter().enumerate() {
            if !textures_made && self.bound[step] == Some((first, second)) {
                continue;
            }
            let buffer = if step == BLEND { ids.blend } else { ids.store };
            let mut words = [0u32; 3 + 3 * 5];
            let mut entry = |binding: u32, kind: u32, id: u32, size: u32| {
                let at = 3 + binding as usize * 5;
                words[at..at + 5].copy_from_slice(&[binding, kind, id, 0, size]);
            };
            entry(0, resource_kind::BUFFER, buffer, BLOCK);
            entry(1, resource_kind::TEXTURE, first, 0);
            entry(2, resource_kind::TEXTURE, second, 0);
            words[0] = ids.first_group + step as u32;
            words[1] = bind_layout::ACCUMULATE;
            words[2] = 3;
            list.push(Op::CreateBindGroup, &words)?;
            self.bound[step] = Some((first, second));
        }
        Ok(())
    }

    /// Records step `step` inside the render pass that the render graph began into its target.
    pub(crate) fn record(&self, list: &mut DrawList, step: usize) -> Result<(), RecordError> {
        let pipeline = self
            .pipeline
            .expect("the accumulation asks for its pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + step as u32, 0],
        )?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipeline keeps its id, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = None;
        self.bound = [None; STEPS];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDS: AccumulateIds = AccumulateIds {
        blend: 1,
        store: 2,
        first_group: 3,
        blank: 4,
    };

    #[test]
    fn the_steps_share_one_pipeline_and_upload_their_weights() {
        let mut pass = AccumulatePass::new(IDS);
        let mut pipelines = PipelineCache::default();
        let id = pass.request_pipeline(&mut pipelines, format::RGBA16_FLOAT);
        assert_eq!(
            pass.request_pipeline(&mut pipelines, format::RGBA16_FLOAT),
            id
        );
        assert_eq!(pipelines.keys().len(), 1, "one pipeline for both steps");

        let mut list = DrawList::with_capacity(256);
        let mut arena = UploadArena::default();
        arena.reset(UPLOAD_BYTES);
        let inputs = AccumulateInputs {
            color: 10,
            history: 11,
            blended: 12,
        };
        pass.prepare(&mut list, &mut arena, inputs, 0.25, true)
            .unwrap();
        assert_eq!(pass.uploaded.unwrap()[0].weight, 0.25);
        assert_eq!(pass.uploaded.unwrap()[0].flags, 0);
        assert_eq!(pass.uploaded.unwrap()[1].flags, STORE);
        // The groups bind the blend's color and history, and the store's target and blank texel.
        assert_eq!(pass.bound, [Some((10, 11)), Some((12, IDS.blank))]);
        // Nothing is created again while the values and the reads hold.
        let before = list.len();
        pass.prepare(&mut list, &mut arena, inputs, 0.25, false)
            .unwrap();
        assert_eq!(list.len(), before);
        // A new weight, or a read that moved, uploads and binds again.
        pass.prepare(&mut list, &mut arena, inputs, 0.5, false)
            .unwrap();
        assert!(list.len() > before);
        let moved = AccumulateInputs {
            color: 20,
            ..inputs
        };
        pass.prepare(&mut list, &mut arena, moved, 0.5, false)
            .unwrap();
        assert_eq!(pass.bound[0], Some((20, 11)));
    }
}

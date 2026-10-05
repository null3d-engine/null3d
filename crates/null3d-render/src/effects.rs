//! Custom effects: full-screen passes of the sketch's own WGSL, between the scene passes and
//! bloom (see [`crate::frame_graph`]). Each effect draws one triangle over a target of its own,
//! which holds HDR color, after the exposure and before the tone curve. It reads the color that
//! the pass before it left: the scene color, or the target of the effect before it. Bloom and the
//! final pass then read the last effect's target. Effects run only on the HDR path.
//!
//! The effects run in the order the sketch gives them, one pass each. The render graph lets their
//! targets share memory: an effect's target lives until the next effect has read it, so two
//! textures serve any number of effects.
//!
//! An effect that reads the scene's depth binds the depth target after its color: as plain floats
//! on one sample, or a multisampled texture whose sample 0 it reads, on WebGPU with MSAA. WebGL2
//! reads a copy of one sample that the backend keeps. An effect that reads no depth binds a blank
//! texture there, so the scene's render pass need not store its depth.
//!
//! Each effect's block of the uniform buffer holds the render size, the targets' size, the clock,
//! the inverse of the camera's projection and the effect's uniforms. A frame uploads the blocks only
//! when one changed, so effects whose uniforms stay still upload nothing. On WebGL2 the buffer holds
//! a ring of slots, each with every effect's block: a frame that changes a block writes all of them
//! into the next slot, in one write, and binds that slot's groups. A write into a range that the
//! GPU may still read from an earlier frame makes some phones' drivers wait for the GPU, which cost
//! about 0.7 ms of CPU per effect on a Pixel 10 (D-71). WebGPU orders a write after the draws before
//! it, so its ring has one slot.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    permutation, resource_kind, state_flags, texture_usage, view,
};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The most effects that run at once.
pub const MAX_EFFECTS: usize = 8;

/// The floats of an effect's uniforms: eight `vec4f`s, as the shader build packs them.
pub const EFFECT_FLOATS: usize = 32;

/// The format of the effects' targets: HDR color, as the scene color holds it.
pub(crate) const FORMAT: u32 = format::RGBA16_FLOAT;

/// Bytes between two effects' blocks in the uniform buffer: the offset alignment that bind groups
/// need for a buffer range.
const BLOCK: usize = 256;

/// The identity matrix, the inverse projection of a frame without a camera.
const IDENTITY: Mat4 = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// One effect, as the sketch sets it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Effect {
    /// The render pipeline template of the effect's compiled WGSL.
    pub template: u32,
    /// True when the effect reads the scene's depth.
    pub depth: bool,
    /// The effect's uniforms, where the shader build placed each.
    pub values: [f32; EFFECT_FLOATS],
}

/// An effect's block, as `effect.wgsl` lays out its `EffectBlock` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct Block {
    size: [f32; 4],
    clock: [f32; 4],
    inverse_projection: Mat4,
    values: [f32; EFFECT_FLOATS],
}

const BLOCK_BYTES: usize = std::mem::size_of::<Block>();
const _: () = assert!(BLOCK_BYTES <= BLOCK);

/// Bytes of one slot of the uniform buffer: a block for each effect that can run.
const SLOT_BYTES: usize = MAX_EFFECTS * BLOCK;

/// The most slots of the uniform buffer's ring: the frame being recorded and the two that the GPU
/// may still draw.
pub(crate) const MAX_SLOTS: usize = 3;

/// The GPU objects of the effects, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct EffectIds {
    /// The uniform buffer of every effect's block.
    pub(crate) buffer: u32,
    /// The linear sampler that effects read their color with.
    pub(crate) sampler: u32,
    /// The bind group of each effect in each slot of the ring, from this id on: `slots` times
    /// [`MAX_EFFECTS`] groups.
    pub(crate) first_group: u32,
    /// The texture of one texel that effects which read no depth bind in its place.
    pub(crate) blank_depth: u32,
    /// The slots of the uniform buffer's ring, at most [`MAX_SLOTS`].
    pub(crate) slots: u32,
}

/// What an effect reads: its color's texture, and the depth texture or the blank one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Sources {
    pub(crate) color: u32,
    pub(crate) depth: u32,
}

/// The pipeline of an effect: one triangle into its target.
const fn pipeline(template: u32, multisampled: bool) -> PipelineKey {
    PipelineKey {
        template,
        permutation: if multisampled {
            permutation::DEPTH_MULTISAMPLED
        } else {
            0
        },
        vertex_format: 0,
        color_format: FORMAT,
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// The effects' GPU objects and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct EffectPass {
    ids: EffectIds,
    /// True when the scene's depth is multisampled and the shaders read it as such: on WebGPU
    /// with MSAA.
    multisampled_depth: bool,
    /// Each effect's pipeline, with the template and depth read it was asked for.
    pipelines: [Option<(u32, bool, u32)>; MAX_EFFECTS],
    created: bool,
    /// The ring slot that the frames draw from.
    slot: usize,
    /// The block of each effect that the slot holds, or `None` before its upload.
    uploaded: [Option<Block>; MAX_EFFECTS],
    /// What each effect's bind group reads in each slot, with its layout, or `None` before the
    /// group exists.
    bound: [[Option<(Sources, u32)>; MAX_EFFECTS]; MAX_SLOTS],
}

impl EffectPass {
    /// The effects' passes, with GPU objects from `ids`, whose depth reads are multisampled when
    /// `multisampled_depth` says.
    pub(crate) fn new(ids: EffectIds, multisampled_depth: bool) -> Self {
        assert!(
            (1..=MAX_SLOTS as u32).contains(&ids.slots),
            "the effects' ring has 1 to {MAX_SLOTS} slots"
        );
        Self {
            ids,
            multisampled_depth,
            pipelines: [None; MAX_EFFECTS],
            created: false,
            slot: 0,
            uploaded: [None; MAX_EFFECTS],
            bound: [[None; MAX_EFFECTS]; MAX_SLOTS],
        }
    }

    /// Bytes a frame may copy into its arena: a slot of the ring.
    pub(crate) const UPLOAD_BYTES: usize = SLOT_BYTES;

    /// True when an effect that reads depth reads a multisampled texture.
    fn reads_multisampled(&self, effect: &Effect) -> bool {
        effect.depth && self.multisampled_depth
    }

    /// Asks `pipelines` for each effect's pipeline, when its template or its depth read changed.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache, effects: &[Effect]) {
        for (slot, effect) in self.pipelines.iter_mut().zip(effects) {
            let multisampled = effect.depth && self.multisampled_depth;
            if matches!(*slot, Some((template, ms, _)) if template == effect.template && ms == multisampled)
            {
                continue;
            }
            let id = pipelines.id(pipeline(effect.template, multisampled));
            *slot = Some((effect.template, multisampled, id));
        }
    }

    /// Makes the buffer, the sampler and the blank depth when the GPU lacks them, uploads every
    /// effect's block into the next slot of the ring when one changed, and binds each effect of the
    /// slot to its `sources` when its group is new or the frame made the plan's textures again.
    /// `render` is the render size in pixels, `canvas` the targets' size, `clock` the sketch time
    /// and the seconds since the frame before, and `inverse_projection` the inverse of the camera's
    /// projection.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        effects: &[Effect],
        sources: &[Sources],
        (canvas, scale): ((u32, u32), RenderScale),
        clock: [f32; 2],
        inverse_projection: Option<Mat4>,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            create_objects(list, ids)?;
            self.created = true;
        }
        let render = Size::Full.viewport(canvas, scale);
        let block = |effect: &Effect| Block {
            size: [
                render.0 as f32,
                render.1 as f32,
                canvas.0.max(1) as f32,
                canvas.1.max(1) as f32,
            ],
            clock: [clock[0], clock[1], 0.0, 0.0],
            inverse_projection: inverse_projection.unwrap_or(IDENTITY),
            values: effect.values,
        };
        let changed = effects
            .iter()
            .zip(&self.uploaded)
            .any(|(effect, &uploaded)| uploaded != Some(block(effect)));
        if changed && !effects.is_empty() {
            self.slot = (self.slot + 1) % ids.slots as usize;
            let bytes = (effects.len() - 1) * BLOCK + BLOCK_BYTES;
            let (at, data) = arena.push_zeroed(bytes)?;
            for (index, uploaded) in self.uploaded.iter_mut().enumerate() {
                *uploaded = effects.get(index).map(|effect| {
                    let written = block(effect);
                    data[index * BLOCK..index * BLOCK + BLOCK_BYTES]
                        .copy_from_slice(bytes_of(&written));
                    written
                });
            }
            let offset = (self.slot * SLOT_BYTES) as u32;
            list.push(Op::WriteBuffer, &[ids.buffer, offset, at, bytes as u32])?;
        }
        if textures_made {
            self.bound = [[None; MAX_EFFECTS]; MAX_SLOTS];
        }
        let slot = self.slot;
        for (index, (effect, &found)) in effects.iter().zip(sources).enumerate() {
            let sources = Sources {
                color: found.color,
                depth: if effect.depth {
                    found.depth
                } else {
                    ids.blank_depth
                },
            };
            let layout = if self.reads_multisampled(effect) {
                bind_layout::EFFECT_DEPTH_MS
            } else {
                bind_layout::EFFECT
            };
            if self.bound[slot][index] == Some((sources, layout)) {
                continue;
            }
            let offset = (slot * SLOT_BYTES + index * BLOCK) as u32;
            list.push(
                Op::CreateBindGroup,
                &[
                    self.group(index),
                    layout,
                    4,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    offset,
                    BLOCK_BYTES as u32,
                    1,
                    resource_kind::TEXTURE,
                    sources.color,
                    0,
                    0,
                    2,
                    resource_kind::SAMPLER,
                    ids.sampler,
                    0,
                    0,
                    3,
                    resource_kind::TEXTURE,
                    sources.depth,
                    0,
                    0,
                ],
            )?;
            self.bound[slot][index] = Some((sources, layout));
        }
        Ok(())
    }

    /// The bind group of effect `index` in the slot that the frames draw from.
    fn group(&self, index: usize) -> u32 {
        self.ids.first_group + (self.slot * MAX_EFFECTS + index) as u32
    }

    /// Records effect `index` inside the render pass that the render graph began into its target.
    pub(crate) fn record(&self, list: &mut DrawList, index: usize) -> Result<(), RecordError> {
        let (_, _, pipeline) =
            self.pipelines[index].expect("each effect asks for its pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.group(index), 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = [None; MAX_EFFECTS];
        self.bound = [[None; MAX_EFFECTS]; MAX_SLOTS];
    }
}

/// Records the creation of the uniform buffer, the linear sampler, which clamps at the edges, and
/// the blank depth texture of one texel.
fn create_objects(list: &mut DrawList, ids: EffectIds) -> Result<(), RecordError> {
    list.push(
        Op::CreateBuffer,
        &[
            ids.buffer,
            ids.slots * SLOT_BYTES as u32,
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
    list.push(
        Op::CreateTexture,
        &[
            ids.blank_depth,
            1,
            1,
            1,
            format::R32_FLOAT,
            texture_usage::TEXTURE_BINDING,
            1,
            1,
            view::D2,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDS: EffectIds = EffectIds {
        buffer: 1,
        sampler: 2,
        first_group: 10,
        blank_depth: 3,
        slots: 3,
    };

    fn effect(template: u32, depth: bool, first: f32) -> Effect {
        let mut values = [0.0; EFFECT_FLOATS];
        values[0] = first;
        Effect {
            template,
            depth,
            values,
        }
    }

    /// The operands of each command `op` in `list`.
    fn operands(list: &DrawList, op: Op) -> Vec<Vec<u32>> {
        null3d_gpu::drawlist::decode(list.words())
            .map(|command| command.unwrap())
            .filter(|command| command.op == op)
            .map(|command| command.operands.to_vec())
            .collect()
    }

    fn prepare(pass: &mut EffectPass, effects: &[Effect], made: bool) -> DrawList {
        let mut list = DrawList::with_capacity(512);
        let mut arena = UploadArena::default();
        arena.reset(EffectPass::UPLOAD_BYTES);
        let sources = [
            Sources {
                color: 40,
                depth: 41,
            },
            Sources {
                color: 42,
                depth: 41,
            },
        ];
        pass.prepare(
            &mut list,
            &mut arena,
            effects,
            &sources[..effects.len()],
            ((640, 360), RenderScale::FULL),
            [1.5, 0.016],
            None,
            made,
        )
        .unwrap();
        list
    }

    #[test]
    fn each_effect_uploads_its_block_and_binds_its_sources_once() {
        let mut pass = EffectPass::new(IDS, false);
        let effects = [effect(64, false, 0.5), effect(65, true, 2.0)];
        let list = prepare(&mut pass, &effects, true);
        // One write holds both blocks, in the next slot of the ring.
        let writes = operands(&list, Op::WriteBuffer);
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0][1], SLOT_BYTES as u32);
        assert_eq!(writes[0][3], (BLOCK + BLOCK_BYTES) as u32);
        let groups = operands(&list, Op::CreateBindGroup);
        assert_eq!(groups.len(), 2);
        // The first effect reads no depth and binds the blank texture; the second binds the depth.
        let first = 10 + MAX_EFFECTS as u32;
        assert_eq!((groups[0][0], groups[0][1]), (first, bind_layout::EFFECT));
        assert_eq!(groups[0][3 + 3], SLOT_BYTES as u32);
        assert_eq!(groups[1][3 + 3], (SLOT_BYTES + BLOCK) as u32);
        assert_eq!(groups[0][3 + 5 * 3 + 2], IDS.blank_depth);
        assert_eq!(groups[1][3 + 5 * 3 + 2], 41);
        assert_eq!(groups[1][3 + 5 + 2], 42);

        let again = prepare(&mut pass, &effects, false);
        assert!(operands(&again, Op::WriteBuffer).is_empty());
        assert!(operands(&again, Op::CreateBindGroup).is_empty());
    }

    #[test]
    fn a_change_writes_every_block_into_the_next_slot_of_the_ring() {
        let mut pass = EffectPass::new(IDS, false);
        let mut effects = [effect(64, false, 0.5), effect(65, true, 2.0)];
        pass.request_pipelines(&mut PipelineCache::default(), &effects);
        prepare(&mut pass, &effects, true);
        // Each change moves to the next slot, which binds its own groups once, so no frame writes
        // where the two frames before it read.
        for (step, slot) in [2, 0, 1, 2].into_iter().enumerate() {
            effects[1].values[0] = step as f32;
            let list = prepare(&mut pass, &effects, false);
            let writes = operands(&list, Op::WriteBuffer);
            assert_eq!(writes.len(), 1);
            assert_eq!(writes[0][1], (slot * SLOT_BYTES) as u32);
            let groups = operands(&list, Op::CreateBindGroup);
            assert_eq!(groups.len(), if step < 2 { 2 } else { 0 }, "step {step}");
            let bound = operands(&pass_record(&pass, 1), Op::SetBindGroup);
            assert_eq!(bound[0][1], 10 + (slot * MAX_EFFECTS) as u32 + 1);
        }
        // New textures bind every slot again, as each slot's next frame draws.
        let list = prepare(&mut pass, &effects, true);
        assert_eq!(operands(&list, Op::CreateBindGroup).len(), 2);
    }

    #[test]
    fn one_slot_writes_in_place() {
        let mut pass = EffectPass::new(EffectIds { slots: 1, ..IDS }, false);
        let mut effects = [effect(64, false, 0.5)];
        prepare(&mut pass, &effects, true);
        effects[0].values[0] = 1.0;
        let list = prepare(&mut pass, &effects, false);
        assert_eq!(operands(&list, Op::WriteBuffer)[0][1], 0);
        assert!(operands(&list, Op::CreateBindGroup).is_empty());
    }

    /// The commands that record effect `index`.
    fn pass_record(pass: &EffectPass, index: usize) -> DrawList {
        let mut list = DrawList::with_capacity(64);
        pass.record(&mut list, index).unwrap();
        list
    }

    #[test]
    fn a_multisampled_depth_takes_its_layout_and_its_build() {
        let mut pass = EffectPass::new(IDS, true);
        let effects = [effect(64, true, 0.0), effect(65, false, 0.0)];
        let mut cache = PipelineCache::default();
        pass.request_pipelines(&mut cache, &effects);
        let keys = cache.keys();
        assert_eq!(keys[0].permutation, permutation::DEPTH_MULTISAMPLED);
        assert_eq!(keys[1].permutation, 0);
        let list = prepare(&mut pass, &effects, true);
        let groups = operands(&list, Op::CreateBindGroup);
        assert_eq!(groups[0][1], bind_layout::EFFECT_DEPTH_MS);
        assert_eq!(groups[1][1], bind_layout::EFFECT);
    }

    #[test]
    fn the_block_matches_the_shaders_layout() {
        assert_eq!(BLOCK_BYTES, 224);
        let shader = include_str!("../../null3d-shaders/wgsl/effect.wgsl");
        for field in [
            "size: vec4f",
            "clock: vec4f",
            "inverse_projection: mat4x4f",
            "u7: vec4f",
        ] {
            assert!(shader.contains(field), "effect.wgsl lacks {field}");
        }
    }
}

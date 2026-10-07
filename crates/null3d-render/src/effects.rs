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
//! the inverse of the camera's projection and the effect's uniforms. A frame uploads a block only
//! when it changed, so effects whose uniforms stay still upload nothing.
//!
//! Effects can also join: a group of them draws in one pass, with a shader that the engine joins
//! from the effects' pieces at run time (`effect_group.wgsl`), which the sketch's thread gives a
//! template of its own ([`EffectJoins`]). A group binds the whole uniform buffer, and each of its
//! effects reads the block at its own place. A group draws once its pipeline is built; until then
//! its effects draw one pass each, so no frame waits for it. A pass of the frame, a lone effect or
//! a group, is a [`Unit`].

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

/// Bytes of the uniform buffer: a block for each effect that can run.
pub(crate) const BUFFER_BYTES: usize = MAX_EFFECTS * BLOCK;

/// How the sketch joins its effects: the group that starts at each place, and the effects that
/// fold into the final pass. The sketch's thread decides both, and makes their shaders' templates.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EffectJoins {
    /// The group that starts at each place: how many effects it holds and the template of its
    /// joined shader. A place where no group starts holds `(0, 0)`.
    pub groups: [(u8, u32); MAX_EFFECTS],
    /// The place of the first effect that folds into the final pass, with the template of the
    /// final pass's fold build, or `None`. Every effect from that place on folds.
    pub fold: Option<(u8, u32)>,
}

impl EffectJoins {
    /// The group that starts at `place` among `count` effects, as its length and template: one
    /// that holds at least two effects and ends by the last one, or `None`.
    pub(crate) fn group_at(&self, place: usize, count: usize) -> Option<(usize, u32)> {
        let (len, template) = *self.groups.get(place)?;
        let len = usize::from(len);
        (template != 0 && len >= 2 && place + len <= count).then_some((len, template))
    }

    /// The fold among `count` effects: its first place and template, when it starts at a place
    /// that holds an effect.
    pub(crate) fn fold_of(&self, count: usize) -> Option<(usize, u32)> {
        self.fold
            .map(|(first, template)| (usize::from(first), template))
            .filter(|&(first, template)| template != 0 && first < count)
    }
}

/// A pass of the effects in a frame: one effect, or a group that draws as one, from the place of
/// its first effect.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Unit {
    pub(crate) first: u8,
    pub(crate) len: u8,
}

impl Unit {
    /// The places of the unit's effects.
    pub(crate) fn places(self) -> std::ops::Range<usize> {
        usize::from(self.first)..usize::from(self.first) + usize::from(self.len)
    }
}

/// The GPU objects of the effects, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct EffectIds {
    /// The uniform buffer of every effect's block.
    pub(crate) buffer: u32,
    /// The linear sampler that effects read their color with.
    pub(crate) sampler: u32,
    /// The bind group of each effect, from this id on, then of the group that starts at each
    /// place: [`EffectPass::GROUPS`] in all.
    pub(crate) first_group: u32,
    /// The texture of one texel that effects which read no depth bind in its place.
    pub(crate) blank_depth: u32,
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
    /// The pipeline of the group that starts at each place, with its template and depth read.
    group_pipelines: [Option<(u32, bool, u32)>; MAX_EFFECTS],
    created: bool,
    /// The block that each effect's part of the buffer holds, or `None` before its upload.
    uploaded: [Option<Block>; MAX_EFFECTS],
    /// What the bind group of each lone effect, then of each group, reads, with its layout, or
    /// `None` before the group exists.
    bound: [Option<(Sources, u32)>; 2 * MAX_EFFECTS],
}

impl EffectPass {
    /// The bind groups that the effects take from [`EffectIds::first_group`] on: one for each
    /// effect alone, and one for a group at each place.
    pub(crate) const GROUPS: u32 = 2 * MAX_EFFECTS as u32;

    /// The effects' passes, with GPU objects from `ids`, whose depth reads are multisampled when
    /// `multisampled_depth` says.
    pub(crate) fn new(ids: EffectIds, multisampled_depth: bool) -> Self {
        Self {
            ids,
            multisampled_depth,
            pipelines: [None; MAX_EFFECTS],
            group_pipelines: [None; MAX_EFFECTS],
            created: false,
            uploaded: [None; MAX_EFFECTS],
            bound: [None; 2 * MAX_EFFECTS],
        }
    }

    /// Bytes a frame may copy into its arena: every effect's block.
    pub(crate) const UPLOAD_BYTES: usize = MAX_EFFECTS * BLOCK_BYTES;

    /// True when one of `effects` reads depth from a multisampled texture.
    fn reads_multisampled(&self, effects: &[Effect]) -> bool {
        self.multisampled_depth && effects.iter().any(|effect| effect.depth)
    }

    /// Asks `pipelines` for each effect's pipeline, and for each group's once every effect of the
    /// group draws alone, by `pipelines_built`, when its template or its depth read changed. A
    /// frame that adds an effect during play waits for every pipeline that builds, so a group that
    /// asked in that frame would hold it for the group's build too. Asked later, the group builds
    /// while its effects draw alone. Before the first frame, which waits for every pipeline anyway,
    /// a group asks at once, so the first frame draws it.
    pub(crate) fn request_pipelines(
        &mut self,
        pipelines: &mut PipelineCache,
        effects: &[Effect],
        joins: &EffectJoins,
        pipelines_built: u32,
    ) {
        let ask = |slot: &mut Option<(u32, bool, u32)>,
                   pipelines: &mut PipelineCache,
                   template: u32,
                   multisampled: bool| {
            if !matches!(*slot, Some((t, ms, _)) if t == template && ms == multisampled) {
                let id = pipelines.id(pipeline(template, multisampled));
                *slot = Some((template, multisampled, id));
            }
        };
        for (place, effect) in effects.iter().enumerate() {
            let multisampled = self.reads_multisampled(std::slice::from_ref(effect));
            ask(
                &mut self.pipelines[place],
                pipelines,
                effect.template,
                multisampled,
            );
        }
        for place in 0..effects.len() {
            let Some((len, template)) = joins.group_at(place, effects.len()) else {
                continue;
            };
            if self.alone_built(place..place + len, pipelines, pipelines_built) {
                let multisampled = self.reads_multisampled(&effects[place..place + len]);
                ask(
                    &mut self.group_pipelines[place],
                    pipelines,
                    template,
                    multisampled,
                );
            }
        }
    }

    /// True when the effects at `places` draw alone, each with its own pipeline built, as every
    /// pipeline counts before the first frame.
    pub(crate) fn alone_built(
        &self,
        places: std::ops::Range<usize>,
        pipelines: &PipelineCache,
        pipelines_built: u32,
    ) -> bool {
        self.pipelines[places]
            .iter()
            .all(|slot| slot.is_some_and(|(_, _, id)| pipelines.built(id, pipelines_built)))
    }

    /// The pipeline of the group that starts at `place`, once a frame asked for it.
    pub(crate) fn group_pipeline(&self, place: usize) -> Option<u32> {
        self.group_pipelines[place].map(|(_, _, id)| id)
    }

    /// Makes the buffer, the sampler and the blank depth when the GPU lacks them, uploads each
    /// effect's block when it changed, and binds each unit to the color it reads, `colors[k]` for
    /// `units[k]`, and to `depth` when one of its effects reads depth, when its bind group is new
    /// or the frame made the plan's textures again. `render` is the render size in pixels,
    /// `canvas` the targets' size, `clock` the sketch time and the seconds since the frame before,
    /// and `inverse_projection` the inverse of the camera's projection.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        effects: &[Effect],
        (units, colors, depth): (&[Unit], &[u32], u32),
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
        for (index, effect) in effects.iter().enumerate() {
            let block = Block {
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
            if self.uploaded[index] != Some(block) {
                let (at, bytes) = arena.push(bytes_of(&block))?;
                let offset = (index * BLOCK) as u32;
                list.push(Op::WriteBuffer, &[ids.buffer, offset, at, bytes])?;
                self.uploaded[index] = Some(block);
            }
        }
        for (&unit, &color) in units.iter().zip(colors) {
            let members = &effects[unit.places()];
            let sources = Sources {
                color,
                depth: if members.iter().any(|effect| effect.depth) {
                    depth
                } else {
                    ids.blank_depth
                },
            };
            let layout = if self.reads_multisampled(members) {
                bind_layout::EFFECT_DEPTH_MS
            } else {
                bind_layout::EFFECT
            };
            let slot = Self::bind_slot(unit);
            if !textures_made && self.bound[slot] == Some((sources, layout)) {
                continue;
            }
            // A lone effect binds its own block; a group binds every block, which its effects
            // read by place.
            let (offset, size) = if unit.len == 1 {
                ((usize::from(unit.first) * BLOCK) as u32, BLOCK_BYTES as u32)
            } else {
                (0, BUFFER_BYTES as u32)
            };
            list.push(
                Op::CreateBindGroup,
                &[
                    ids.first_group + slot as u32,
                    layout,
                    4,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    offset,
                    size,
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
            self.bound[slot] = Some((sources, layout));
        }
        Ok(())
    }

    /// The bind group of a unit among the effects' groups: a lone effect's own, or the one of the
    /// group at its first place.
    fn bind_slot(unit: Unit) -> usize {
        let first = usize::from(unit.first);
        if unit.len == 1 {
            first
        } else {
            MAX_EFFECTS + first
        }
    }

    /// Records a unit inside the render pass that the render graph began into its target: a lone
    /// effect with its own pipeline, or a group with its joined one.
    pub(crate) fn record(&self, list: &mut DrawList, unit: Unit) -> Result<(), RecordError> {
        let first = usize::from(unit.first);
        let slot = if unit.len == 1 {
            self.pipelines[first]
        } else {
            self.group_pipelines[first]
        };
        let (_, _, pipeline) = slot.expect("each unit asks for its pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + Self::bind_slot(unit) as u32, 0],
        )?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = [None; MAX_EFFECTS];
        self.bound = [None; 2 * MAX_EFFECTS];
    }
}

/// The units of `count` effects joined by `joins`: each group whose pipeline `built` says is
/// built draws as one, and each other effect alone. Effects from `fold` on fold into the final
/// pass and take no unit. Returns how many units it wrote into `units`.
pub(crate) fn plan_units(
    count: usize,
    joins: &EffectJoins,
    built: impl Fn(usize) -> bool,
    fold: Option<usize>,
    units: &mut [Unit; MAX_EFFECTS],
) -> usize {
    let end = fold.unwrap_or(count).min(count);
    let mut place = 0;
    let mut written = 0;
    while place < end {
        let len = match joins.group_at(place, count) {
            Some((len, _)) if place + len <= end && built(place) => len,
            _ => 1,
        };
        units[written] = Unit {
            first: place as u8,
            len: len as u8,
        };
        written += 1;
        place += len;
    }
    written
}

/// Records the creation of the uniform buffer, the linear sampler, which clamps at the edges, and
/// the blank depth texture of one texel.
fn create_objects(list: &mut DrawList, ids: EffectIds) -> Result<(), RecordError> {
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

    /// Prepares `units` of `effects`, with each unit reading color 40 + its index and the depth 41.
    fn prepare_units(
        pass: &mut EffectPass,
        effects: &[Effect],
        units: &[Unit],
        made: bool,
    ) -> DrawList {
        let mut list = DrawList::with_capacity(512);
        let mut arena = UploadArena::default();
        arena.reset(EffectPass::UPLOAD_BYTES);
        let colors: Vec<u32> = (0..units.len() as u32).map(|k| 40 + 2 * k).collect();
        pass.prepare(
            &mut list,
            &mut arena,
            effects,
            (units, &colors, 41),
            ((640, 360), RenderScale::FULL),
            [1.5, 0.016],
            None,
            made,
        )
        .unwrap();
        list
    }

    /// Each effect alone.
    fn alone(count: usize) -> Vec<Unit> {
        (0..count as u8)
            .map(|first| Unit { first, len: 1 })
            .collect()
    }

    fn prepare(pass: &mut EffectPass, effects: &[Effect], made: bool) -> DrawList {
        prepare_units(pass, effects, &alone(effects.len()), made)
    }

    #[test]
    fn each_effect_uploads_its_block_and_binds_its_sources_once() {
        let mut pass = EffectPass::new(IDS, false);
        let effects = [effect(64, false, 0.5), effect(65, true, 2.0)];
        let list = prepare(&mut pass, &effects, true);
        let writes = operands(&list, Op::WriteBuffer);
        assert_eq!(writes.len(), 2);
        assert_eq!((writes[0][1], writes[1][1]), (0, BLOCK as u32));
        let groups = operands(&list, Op::CreateBindGroup);
        assert_eq!(groups.len(), 2);
        // The first effect reads no depth and binds the blank texture; the second binds the depth.
        assert_eq!((groups[0][0], groups[0][1]), (10, bind_layout::EFFECT));
        assert_eq!(groups[0][3 + 5 * 3 + 2], IDS.blank_depth);
        assert_eq!(groups[1][3 + 5 * 3 + 2], 41);
        assert_eq!(groups[1][3 + 5 + 2], 42);

        let again = prepare(&mut pass, &effects, false);
        assert!(operands(&again, Op::WriteBuffer).is_empty());
        assert!(operands(&again, Op::CreateBindGroup).is_empty());

        let changed = [effect(64, false, 0.75), effects[1]];
        let list = prepare(&mut pass, &changed, false);
        assert_eq!(operands(&list, Op::WriteBuffer).len(), 1);
    }

    #[test]
    fn a_multisampled_depth_takes_its_layout_and_its_build() {
        let mut pass = EffectPass::new(IDS, true);
        let effects = [effect(64, true, 0.0), effect(65, false, 0.0)];
        let mut cache = PipelineCache::default();
        pass.request_pipelines(&mut cache, &effects, &EffectJoins::default(), 0);
        let keys = cache.keys();
        assert_eq!(keys[0].permutation, permutation::DEPTH_MULTISAMPLED);
        assert_eq!(keys[1].permutation, 0);
        let list = prepare(&mut pass, &effects, true);
        let groups = operands(&list, Op::CreateBindGroup);
        assert_eq!(groups[0][1], bind_layout::EFFECT_DEPTH_MS);
        assert_eq!(groups[1][1], bind_layout::EFFECT);
    }

    /// Joins with a group of `len` effects at `place`, whose shader has template `template`.
    fn joined(place: usize, len: u8, template: u32) -> EffectJoins {
        let mut joins = EffectJoins::default();
        joins.groups[place] = (len, template);
        joins
    }

    #[test]
    fn a_group_binds_every_block_and_reads_depth_when_one_of_its_effects_does() {
        let mut pass = EffectPass::new(IDS, true);
        let effects = [
            effect(64, false, 0.0),
            effect(65, false, 0.0),
            effect(66, true, 0.0),
        ];
        let mut cache = PipelineCache::default();
        let joins = joined(1, 2, 90);
        // Before the first frame, which waits for every pipeline, the group asks at once.
        let mut first = EffectPass::new(IDS, true);
        first.request_pipelines(&mut PipelineCache::default(), &effects, &joins, 0);
        assert!(first.group_pipeline(1).is_some());
        // During play, it waits until its effects draw alone, and asks for its pipeline then.
        pass.request_pipelines(&mut cache, &effects, &joins, 1);
        assert!(pass.group_pipeline(1).is_none(), "the effects are new");
        cache
            .create_new(&mut DrawList::with_capacity(256), 3)
            .unwrap();
        pass.request_pipelines(&mut cache, &effects, &joins, 2);
        assert!(pass.group_pipeline(1).is_none(), "the effects still build");
        pass.request_pipelines(&mut cache, &effects, &joins, 3);
        // The group's pipeline reads the multisampled depth, as one of its effects does.
        let group = pass
            .group_pipeline(1)
            .expect("the group asked for its pipeline");
        let key = cache.keys()[group as usize - 1];
        assert_eq!(
            (key.template, key.permutation),
            (90, permutation::DEPTH_MULTISAMPLED)
        );
        assert!(pass.group_pipeline(0).is_none());

        let units = [Unit { first: 0, len: 1 }, Unit { first: 1, len: 2 }];
        let list = prepare_units(&mut pass, &effects, &units, true);
        // Every effect's block uploads, the group's members too.
        assert_eq!(operands(&list, Op::WriteBuffer).len(), 3);
        let groups = operands(&list, Op::CreateBindGroup);
        assert_eq!(groups.len(), 2);
        let group = &groups[1];
        assert_eq!(group[0], IDS.first_group + MAX_EFFECTS as u32 + 1);
        assert_eq!(group[1], bind_layout::EFFECT_DEPTH_MS);
        // The whole buffer, from its start, and the second unit's color.
        assert_eq!((group[3 + 3], group[3 + 4]), (0, BUFFER_BYTES as u32));
        assert_eq!(group[3 + 5 + 2], 42);
        assert_eq!(group[3 + 5 * 3 + 2], 41);

        let mut list = DrawList::with_capacity(64);
        pass.record(&mut list, units[1]).unwrap();
        let bound = operands(&list, Op::SetBindGroup);
        assert_eq!(bound[0][1], IDS.first_group + MAX_EFFECTS as u32 + 1);
        assert_eq!(
            operands(&list, Op::SetPipeline)[0][0],
            pass.group_pipeline(1).unwrap()
        );
    }

    #[test]
    fn units_join_a_group_once_its_pipeline_is_built_and_leave_the_fold_out() {
        let mut units = [Unit::default(); MAX_EFFECTS];
        let joins = joined(1, 3, 90);
        let plan = |built: bool, fold: Option<usize>, units: &mut [Unit; MAX_EFFECTS]| {
            let count = plan_units(5, &joins, |place| built && place == 1, fold, units);
            units[..count]
                .iter()
                .map(|unit| (unit.first, unit.len))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            plan(false, None, &mut units),
            [(0, 1), (1, 1), (2, 1), (3, 1), (4, 1)]
        );
        assert_eq!(plan(true, None, &mut units), [(0, 1), (1, 3), (4, 1)]);
        // Effects from the fold on take no unit, and a group that crosses into it draws alone.
        assert_eq!(plan(true, Some(4), &mut units), [(0, 1), (1, 3)]);
        assert_eq!(plan(true, Some(3), &mut units), [(0, 1), (1, 1), (2, 1)]);
        // A group past the effects that run, or of one effect, joins nothing.
        let past = joined(3, 3, 90);
        assert_eq!(past.group_at(3, 5), None);
        assert_eq!(joined(1, 1, 90).group_at(1, 5), None);
        assert_eq!(
            EffectJoins {
                fold: Some((5, 91)),
                ..EffectJoins::default()
            }
            .fold_of(5),
            None
        );
    }

    #[test]
    fn the_block_matches_the_shaders_layout() {
        assert_eq!(BLOCK_BYTES, 224);
        // The hosts of joined effects pad each block to the distance between blocks, so their
        // array of every block matches the buffer.
        for host in [
            include_str!("../../null3d-shaders/wgsl/effect_group.wgsl"),
            include_str!("../../null3d-shaders/wgsl/final.wgsl"),
        ] {
            assert!(host.contains("spare1: vec4f"));
            assert!(host.contains(&format!("blocks: array<EffectBlock, {MAX_EFFECTS}>")));
        }
        assert_eq!(BLOCK, 224 + 2 * 16);
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

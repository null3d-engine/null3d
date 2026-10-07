//! Skinning and morphing in the vertex shader, as decision record D-10 chose for WebGL2: every
//! pass that draws a skinned or morphed object, its shadow passes too, draws it with the
//! [`permutation::SKIN`] or [`permutation::MORPH`] variant of its pipeline, or both. The SKIN
//! variants blend each vertex's joints from the joint texture (see [`crate::skinning`]), and the
//! MORPH variants add each vertex's morph target deltas times their weights from the morph texture
//! (see [`crate::morph`]).
//!
//! Skinned and morphed objects stay in the buckets of their mesh and material, so a crowd of one
//! mesh draws in one instanced draw per part. Each instance finds its own joints and weights
//! through a data texture of indices, laid out as the index list is, in two halves of equal rows.
//! The first half holds the first joint of the animated instance that skins each source row, and
//! the second half the first texel of the morph weights of each source row in the morph texture.
//! Only scene objects are skinned or morphed, and a scene slot's row is its slot, so the texture
//! covers the scene's rows up to the last such one. It changes only with the scene's structure and
//! when the morph texture grows, while the joint texture and the weights are written every frame.
//!
//! [`permutation::SKIN`]: null3d_gpu::drawlist::permutation::SKIN
//! [`permutation::MORPH`]: null3d_gpu::drawlist::permutation::MORPH

use std::collections::TryReserveError;

use null3d_core::animation::Animations;
use null3d_core::morph::MorphWeights;
use null3d_core::scene::SceneStorage;
use null3d_gpu::drawlist::{
    DrawList, Op, format, permutation, sizes, template, texture_usage, view,
};

use super::data::{TextureRows, grown_rows, write_rows};
use super::ids;
use crate::frame::{RecordError, UploadArena, words_as_bytes};
use crate::meshes::MeshStorage;
use crate::morph::{MorphTexture, NOT_MORPHED};
use crate::pipelines::{DrawKey, PipelineCache};
use crate::skinning::{JointTexture, SkinnedGate, skin_of};
use crate::sorted::SkinnedPipeline;

/// The first joint of a scene slot that no animated instance skins.
const NOT_SKINNED: u32 = u32::MAX;

/// The templates with MORPH builds.
const MORPH_TEMPLATES: [u32; 8] = [
    template::INSTANCED_LIT,
    template::INSTANCED_STANDARD_MAPS,
    template::INSTANCED_UNLIT,
    template::INSTANCED_UNLIT_MAP,
    template::DEBUG_VIEW,
    template::SHADOW_DEPTH,
    template::SHADOW_CUTOUT,
    template::SHADOW_CUTOUT_MAP,
];

/// The joint texture, the morph texture and the texture of first joints and weights, with what the
/// next frame uploads.
#[derive(Debug)]
pub(super) struct Skins {
    joints: JointTexture,
    morph: MorphTexture,
    /// The first joint of each scene slot's animated instance, or [`NOT_SKINNED`].
    firsts: Vec<u32>,
    /// The first weight texel of each scene slot in the morph texture, or [`NOT_MORPHED`], as
    /// the next upload of the span writes them.
    bases: Vec<u32>,
    /// The first and the last skinned or morphed slot, or `None` while there is none.
    span: Option<(u32, u32)>,
    /// True when the next frame uploads the span's first joints and weights texels.
    pending: bool,
    /// Rows of the texture of first joints and weights, both halves, 0 before it exists.
    rows: u32,
    /// Whether the passes draw the skinned objects yet.
    gate: SkinnedGate,
}

impl Default for Skins {
    fn default() -> Self {
        Self {
            joints: JointTexture::new(ids::JOINTS),
            morph: MorphTexture::new(ids::MORPHS, ids::MORPH_WEIGHTS),
            firsts: Vec::new(),
            bases: Vec::new(),
            span: None,
            pending: false,
            rows: 0,
            gate: SkinnedGate::default(),
        }
    }
}

impl Skins {
    /// Finds the animated instance that skins each scene slot and the slots that blocks of morph
    /// weights shape, after the scene's structure changed.
    pub(super) fn rebuild(
        &mut self,
        scene: &SceneStorage,
        animations: Option<&Animations>,
        morphs: &MorphWeights,
        meshes: &MeshStorage,
    ) -> Result<(), TryReserveError> {
        let rows = scene.capacity() as usize + 1;
        self.morph.rebuild(scene, morphs, meshes);
        self.firsts.clear();
        self.firsts.try_reserve(rows)?;
        self.bases.clear();
        self.bases.try_reserve(rows)?;
        self.bases.resize(rows, NOT_MORPHED);
        self.span = None;
        for slot in 0..rows {
            let first = skin_of(scene, animations, meshes, slot).map_or(NOT_SKINNED, |(f, _)| f);
            self.firsts.push(first);
        }
        let skinned = (0..rows as u32).filter(|&s| self.firsts[s as usize] != NOT_SKINNED);
        let morphed = self.morph.objects().iter().map(|o| o.slot);
        for s in skinned.chain(morphed) {
            self.span = Some(
                self.span
                    .map_or((s, s), |(low, high)| (low.min(s), high.max(s))),
            );
        }
        self.pending = self.span.is_some();
        Ok(())
    }

    /// The key of the pipeline that draws the object at scene slot `slot`, whose pair's pipeline
    /// has `key`, or `None` for an object that is neither skinned nor morphed: the SKIN variant
    /// for a skinned object, the MORPH variant for a morphed one, or both. Templates without
    /// MORPH builds, such as custom materials', draw morphed meshes at rest.
    pub(super) fn key(&self, slot: usize, key: DrawKey) -> Option<DrawKey> {
        let skin = self
            .firsts
            .get(slot)
            .is_some_and(|&first| first != NOT_SKINNED);
        let morph =
            self.morph.base(slot as u32) != NOT_MORPHED && MORPH_TEMPLATES.contains(&key.template);
        let bits = (u32::from(skin) * permutation::SKIN) | (u32::from(morph) * permutation::MORPH);
        (bits != 0).then_some(DrawKey {
            permutation: key.permutation | bits,
            ..key
        })
    }

    /// True when the layouts leave out the object at scene slot `slot`: a skinned or morphed
    /// object, while the pipelines that draw such objects are not built yet.
    pub(super) fn hides(&self, slot: usize) -> bool {
        !self.gate.drawn()
            && (self
                .firsts
                .get(slot)
                .is_some_and(|&first| first != NOT_SKINNED)
                || self.morph.base(slot as u32) != NOT_MORPHED)
    }

    /// How the object at scene slot `slot`, whose pair's pipeline has `key`, draws in the
    /// transparent pass by its skinning and morph targets.
    pub(super) fn sorted_pipeline(&self, slot: usize, key: DrawKey) -> SkinnedPipeline {
        match self.key(slot, key) {
            None => SkinnedPipeline::NotSkinned,
            Some(skinned) if self.gate.drawn() => SkinnedPipeline::Drawn(skinned),
            Some(skinned) => SkinnedPipeline::Waiting(skinned),
        }
    }

    /// Lets the passes draw the skinned objects once every pipeline in `waiting` is built, by
    /// `pipelines_built` (see [`SkinnedGate`]). Returns true when they start to draw, so the layouts
    /// take them in.
    pub(super) fn open_when_built(
        &mut self,
        pipelines: &PipelineCache,
        waiting: impl Iterator<Item = u32>,
        pipelines_built: u32,
    ) -> bool {
        let skinned = self.span.is_some();
        self.gate.open_when_built(skinned, pipelines_built, || {
            pipelines.all_built(waiting, pipelines_built)
        })
    }

    /// Lets the passes draw the skinned objects at once while the thread that draws has drawn no
    /// frame yet, since the first frame waits for every pipeline.
    pub(super) fn open_before_first_frame(&mut self, pipelines_built: u32) {
        let skinned = self.span.is_some();
        self.gate
            .open_when_built(skinned, pipelines_built, || false);
    }

    /// Records that the layouts left the skinned objects out and asked for their pipelines.
    pub(super) fn asked(&mut self) {
        if self.span.is_some() {
            self.gate.asked();
        }
    }

    /// The bytes that the next frame copies into its arena.
    pub(super) fn upload_bound(&self, meshes: &MeshStorage) -> usize {
        let indices = match self.span {
            Some((low, high)) if self.pending => (high - low + 1) as usize * 8,
            _ => 0,
        };
        indices + self.morph.upload_bound(meshes)
    }

    /// Makes the joint texture, the morph texture and the texture of first joints and weights when
    /// skinned or morphed objects need them, the last with room for every such slot, at most
    /// `limit` rows. Returns true when it made one, which the views' instance groups bind.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        animations: Option<&Animations>,
        meshes: &MeshStorage,
        limit: u32,
    ) -> Result<bool, RecordError> {
        let Some((_, high)) = self.span else {
            return Ok(false);
        };
        let joints = self.joints.create(list, animations)?;
        let morph = self.morph.size(list, meshes, true)?;
        let half = (high + 1).div_ceil(sizes::INDICES_PER_TEXTURE_ROW);
        let grown = self.rows / 2 < half;
        if grown {
            self.rows = 2 * grown_rows(half, limit / 2);
            list.push(
                Op::CreateTexture,
                &[
                    ids::FIRST_JOINTS,
                    sizes::INDICES_PER_TEXTURE_ROW,
                    self.rows,
                    1,
                    format::R32_UINT,
                    texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                    1,
                    1,
                    view::D2,
                ],
            )?;
        }
        // A new morph texture moves every object's weights.
        self.pending |= grown || morph;
        Ok(joints || morph || grown)
    }

    /// Uploads the first joints and weights texels after a change, and every frame, the joint
    /// matrices of the animation table's last step and the morph weights.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        animations: Option<&Animations>,
        morphs: &MorphWeights,
        meshes: &MeshStorage,
    ) -> Result<(), RecordError> {
        let Some((low, high)) = self.span else {
            return Ok(());
        };
        if std::mem::take(&mut self.pending) {
            let (low, high) = (low as usize, high as usize);
            for slot in low..=high {
                self.bases[slot] = self.morph.base(slot as u32);
            }
            let count = high as u32 - low as u32 + 1;
            let half = self.rows / 2 * sizes::INDICES_PER_TEXTURE_ROW;
            for (first, values) in [(0, &self.firsts), (half, &self.bases)] {
                let (at, _) = arena.push(words_as_bytes(&values[low..=high]))?;
                let rows = TextureRows::indices(first + low as u32, count);
                write_rows(list, ids::FIRST_JOINTS, rows, at)?;
            }
        }
        if let Some(animations) = animations {
            self.joints.upload(list, animations)?;
        }
        self.morph.upload(list, arena, morphs, animations, meshes)
    }

    /// Keeps at most `cap` morph weights of each object, the largest.
    pub(super) fn set_morph_cap(&mut self, cap: u32) {
        self.morph.set_cap(cap);
    }

    /// The joint texture, the texture of first joints and weights, and the morph textures of
    /// deltas and of weights, once they exist, for the views' instance groups.
    pub(super) fn textures(&self) -> Option<[u32; 4]> {
        let [deltas, weights] = self.morph.ids();
        (self.joints.exists() && self.morph.exists() && self.rows > 0).then_some([
            ids::JOINTS,
            ids::FIRST_JOINTS,
            deltas,
            weights,
        ])
    }

    /// The morph texture, which a removal of meshes changes.
    pub(super) fn morph_mut(&mut self) -> &mut MorphTexture {
        &mut self.morph
    }

    /// The morph texture.
    pub(super) fn morph(&self) -> &MorphTexture {
        &self.morph
    }

    /// Forgets the textures, so they are made and filled again, after the thread that draws
    /// replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.joints.forget_gpu();
        self.morph.forget_gpu();
        self.gate.forget_gpu();
        self.rows = 0;
        self.pending = self.span.is_some();
    }
}

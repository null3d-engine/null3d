//! Skinning in the vertex shader, as decision record D-10 chose for WebGL2: every pass that draws a
//! skinned object, its shadow passes too, draws it with the [`permutation::SKIN`] variant of its
//! pipeline, which blends each vertex's joints from the joint texture (see [`crate::skinning`]).
//!
//! Skinned objects stay in the buckets of their mesh and material, so a crowd of one mesh draws in
//! one instanced draw per part. Each instance finds its own joints through a second data texture,
//! which holds the first joint of the animated instance that skins each source row, laid out as the
//! index list is. Only scene objects are skinned, and a scene slot's row is its slot, so the
//! texture covers the scene's rows up to the last skinned one. It changes only with the scene's
//! structure, while the joint texture is written every frame.
//!
//! [`permutation::SKIN`]: null3d_gpu::drawlist::permutation::SKIN

use std::collections::TryReserveError;

use null3d_core::animation::Animations;
use null3d_core::scene::SceneStorage;
use null3d_gpu::drawlist::{DrawList, sizes};

use super::data::{DataTexture, TextureRows, write_rows};
use super::ids;
use crate::frame::{RecordError, UploadArena, words_as_bytes};
use crate::meshes::MeshStorage;
use crate::pipelines::{DrawKey, PipelineCache};
use crate::skinning::{JointTexture, SkinnedGate, skin_of, skinned_in_vertex_shader};
use crate::sorted::SkinnedPipeline;

/// The first joint of a scene slot that no animated instance skins.
const NOT_SKINNED: u32 = u32::MAX;

/// The texture of each source row's first joint.
const FIRST_JOINTS: DataTexture = DataTexture::indices(ids::FIRST_JOINTS, 1);

/// The joint texture and the texture of first joints, with what the next frame uploads.
#[derive(Debug)]
pub(super) struct Skins {
    joints: JointTexture,
    /// The first joint of each scene slot's animated instance, or [`NOT_SKINNED`].
    firsts: Vec<u32>,
    /// The first and the last skinned slot, or `None` while no object is skinned.
    span: Option<(u32, u32)>,
    /// True when the next frame uploads the first joints of the span.
    pending: bool,
    /// Rows of the texture of first joints, 0 before it exists.
    rows: u32,
    /// Whether the passes draw the skinned objects yet.
    gate: SkinnedGate,
}

impl Default for Skins {
    fn default() -> Self {
        Self {
            joints: JointTexture::new(ids::JOINTS),
            firsts: Vec::new(),
            span: None,
            pending: false,
            rows: 0,
            gate: SkinnedGate::default(),
        }
    }
}

impl Skins {
    /// Finds the animated instance that skins each scene slot, after the scene's structure changed.
    pub(super) fn rebuild(
        &mut self,
        scene: &SceneStorage,
        animations: Option<&Animations>,
        meshes: &MeshStorage,
    ) -> Result<(), TryReserveError> {
        let rows = scene.capacity() as usize + 1;
        self.firsts.clear();
        self.firsts.try_reserve(rows)?;
        self.span = None;
        for slot in 0..rows {
            let first = skin_of(scene, animations, meshes, slot).map_or(NOT_SKINNED, |(f, _)| f);
            if first != NOT_SKINNED {
                let s = slot as u32;
                self.span = Some(self.span.map_or((s, s), |(low, _)| (low, s)));
            }
            self.firsts.push(first);
        }
        self.pending = self.span.is_some();
        Ok(())
    }

    /// True when an animated instance skins scene slot `slot`.
    pub(super) fn skinned(&self, slot: usize) -> bool {
        self.firsts
            .get(slot)
            .is_some_and(|&first| first != NOT_SKINNED)
    }

    /// True when the layouts leave out the object at scene slot `slot`: a skinned object, while
    /// the pipelines that draw skinned objects are not built yet.
    pub(super) fn hides(&self, slot: usize) -> bool {
        !self.gate.drawn() && self.skinned(slot)
    }

    /// How the object at scene slot `slot`, whose pair's pipeline has `key`, draws in the
    /// transparent pass by its skinning.
    pub(super) fn sorted_pipeline(&self, slot: usize, key: DrawKey) -> SkinnedPipeline {
        if !self.skinned(slot) {
            SkinnedPipeline::NotSkinned
        } else if self.gate.drawn() {
            SkinnedPipeline::Drawn(skinned_in_vertex_shader(key))
        } else {
            SkinnedPipeline::Waiting(skinned_in_vertex_shader(key))
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
    pub(super) fn upload_bound(&self) -> usize {
        match self.span {
            Some((low, high)) if self.pending => (high - low + 1) as usize * 4,
            _ => 0,
        }
    }

    /// Makes the joint texture and the texture of first joints when skinned objects need them,
    /// the latter with room for every skinned slot, at most `limit` rows. Returns true when it made
    /// one, which the views' instance groups bind.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        animations: Option<&Animations>,
        limit: u32,
    ) -> Result<bool, RecordError> {
        let (Some((_, high)), Some(animations)) = (self.span, animations) else {
            return Ok(false);
        };
        let made = self.joints.create(list, animations)?;
        let needed = (high + 1).div_ceil(sizes::INDICES_PER_TEXTURE_ROW);
        let grown = FIRST_JOINTS.grow(list, &mut self.rows, needed, limit)?;
        self.pending |= grown;
        Ok(made || grown)
    }

    /// Uploads the first joints after a change, and every frame, the joint matrices of the
    /// animation table's last step.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        animations: Option<&Animations>,
    ) -> Result<(), RecordError> {
        let (Some((low, high)), Some(animations)) = (self.span, animations) else {
            return Ok(());
        };
        if std::mem::take(&mut self.pending) {
            let firsts = &self.firsts[low as usize..=high as usize];
            let (at, _) = arena.push(words_as_bytes(firsts))?;
            let rows = TextureRows::indices(low, high - low + 1);
            write_rows(list, ids::FIRST_JOINTS, rows, at)?;
        }
        self.joints.upload(list, animations)
    }

    /// The joint texture and the texture of first joints, once both exist, for the views'
    /// instance groups.
    pub(super) fn textures(&self) -> Option<[u32; 2]> {
        (self.joints.exists() && self.rows > 0).then_some([ids::JOINTS, ids::FIRST_JOINTS])
    }

    /// Forgets both textures, so they are made and filled again, after the thread that draws
    /// replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.joints.forget_gpu();
        self.gate.forget_gpu();
        self.rows = 0;
        self.pending = self.span.is_some();
    }
}

//! Cluster levels: the pass that picks the patches a view draws and copies their indices into the
//! view's own list, so one indirect draw draws them all.
//!
//! A mesh with a tree of cluster patches (`crate::patches`) draws its tree in the camera's views
//! instead of its whole triangle list. The culling pass counts the mesh's instances, so a view
//! that sees none of them draws none of its patches. Then three dispatches of one pipeline fill
//! the view's list (see `cluster_cull.wgsl`): the first counts each patch's indices, the second
//! adds the counts up into the view's list and writes each mesh's indirect draw, and the third
//! copies the chosen patches' indices. The view's opaque pass then draws each cluster mesh with
//! those draws, which name its list.
//!
//! The scene's patch table and its indices are one buffer each, shared by every view, and they
//! upload again when the layout changes. Each view has its own counts, offsets, list, draws and
//! parameters.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, sizes, template,
};

use super::ids;
use super::layout::Layout;
use crate::frame::{RecordError, UploadArena, grown_size, words_as_bytes};
use crate::view::ViewId;

/// Bytes of one dispatch's parameters: six planes, four counts and the level rule's vector.
const PARAMS_BYTES: u32 = 128;
const _: () = assert!(PARAMS_BYTES <= PARAMS_STRIDE);
/// The bytes between two dispatches' parameters, which every device's dynamic offsets take.
const PARAMS_STRIDE: u32 = 256;
/// The stages of a view's cluster pass: the count, the scan and the copy.
const STAGES: u32 = 3;
/// What a view's dispatch parameters hold besides the layout's counts: its frustum planes, the
/// level rule's vector, and the draws that come before the view's own in its indirect buffer.
pub(super) struct ViewRules<'a> {
    pub(super) planes: &'a [[f32; 4]; 6],
    pub(super) levels: [f32; 4],
    pub(super) draws_before: u32,
}

/// The words of one patch's record and of one mesh's record in the table.
pub(super) const PATCH_WORDS: u32 = 8;
pub(super) const MESH_WORDS: u32 = 8;
/// The words of one indexed indirect draw.
const INDIRECT_WORDS: u32 = 5;
/// The threads of the cluster pipeline's workgroups.
const WORKGROUP_SIZE: u32 = 64;

/// The words that a patch table of `patches` patches and `meshes` meshes takes, and its indices.
pub(super) fn table_bytes(patches: u32, meshes: u32, indices: u32) -> [u32; 2] {
    [
        ((patches * PATCH_WORDS + meshes * MESH_WORDS).max(1)) * 4,
        (indices.max(1)) * 4,
    ]
}

/// The scene's cluster tables and each view's buffers.
#[derive(Debug, Default)]
pub(super) struct Clusters {
    /// The made sizes of the scene's patch table and its indices.
    tables: [u32; 2],
    /// The patches and the meshes of the table that the GPU holds.
    table_words: [u32; 2],
    /// Each view's buffers, by view id.
    views: Vec<Option<ViewBuffers>>,
}

/// One view's cluster buffers, and their made sizes.
#[derive(Clone, Copy, Debug, Default)]
struct ViewBuffers {
    runs: u32,
    offsets: u32,
    list: u32,
    draws: u32,
    params: u32,
    /// True once the view's bind group exists.
    group: bool,
}

impl Clusters {
    /// The bytes that the cluster tables and one view's parameters take from the frame's uploads:
    /// the scene's patches, its mesh records and its indices, when the layout holds them.
    pub(super) fn upload_bytes(layout: &Layout) -> usize {
        let patches = layout.cluster_patches.len() * PATCH_WORDS as usize;
        let meshes = layout.clusters.len() * MESH_WORDS as usize;
        let indices = layout.cluster_indices.len();
        (patches + meshes + indices) * 4 + (PARAMS_STRIDE * STAGES) as usize
    }

    /// Records the creation of the cluster pass's one pipeline.
    pub(super) fn create_pipeline(list: &mut DrawList) -> Result<(), RecordError> {
        list.push(
            Op::CreateComputePipeline,
            &[ids::CLUSTER, template::CLUSTER, 0],
        )?;
        Ok(())
    }

    /// Sizes the scene's two tables for the layout, and uploads them when they are new, when the
    /// layout changed, or when they hold another count of patches. Returns true when either buffer
    /// was made again.
    pub(super) fn apply_tables(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        layout: &Layout,
        layout_changed: bool,
        binding_bytes: u32,
    ) -> Result<bool, RecordError> {
        let patches = layout.cluster_patches.len() as u32;
        let meshes = layout.clusters.len() as u32;
        let indices = layout.cluster_indices.len() as u32;
        let needed = table_bytes(patches, meshes, indices);
        let ids = [ids::CLUSTER_PATCHES, ids::CLUSTER_INDICES];
        let mut recreated = false;
        for (k, id) in ids.into_iter().enumerate() {
            if self.tables[k] < needed[k] {
                self.tables[k] = grown_size(needed[k], binding_bytes);
                list.push(
                    Op::CreateBuffer,
                    &[id, self.tables[k], usage::STORAGE | usage::COPY_DST],
                )?;
                recreated = true;
            }
        }
        if patches == 0 && indices == 0 {
            return Ok(recreated);
        }
        let words = [patches, meshes];
        if recreated || layout_changed || self.table_words != words {
            self.table_words = words;
            let mut table: Vec<u32> = Vec::with_capacity((patches * PATCH_WORDS) as usize);
            for patch in &layout.cluster_patches {
                table.extend_from_slice(patch);
            }
            for mesh in &layout.clusters {
                table.extend_from_slice(&[
                    mesh.first_patch,
                    mesh.patch_count,
                    mesh.slot,
                    mesh.first_draw,
                    mesh.base_vertex,
                    0,
                    0,
                    0,
                ]);
            }
            if !table.is_empty() {
                let (at, length) = arena.push(words_as_bytes(&table))?;
                list.push(Op::WriteBuffer, &[ids::CLUSTER_PATCHES, 0, at, length])?;
            }
            if !layout.cluster_indices.is_empty() {
                let (at, length) = arena.push(words_as_bytes(&layout.cluster_indices))?;
                list.push(Op::WriteBuffer, &[ids::CLUSTER_INDICES, 0, at, length])?;
            }
        }
        Ok(recreated)
    }

    /// Sizes one view's buffers and binds its group again when a buffer it binds is new, or the
    /// scene's tables are.
    pub(super) fn apply(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        tables_recreated: bool,
        binding_bytes: u32,
    ) -> Result<(), RecordError> {
        if self.views.len() <= view.index() {
            self.views.resize(view.index() + 1, None);
        }
        let patches = layout.cluster_patches.len() as u32;
        if patches == 0 {
            return Ok(());
        }
        let indices = layout.cluster_indices.len() as u32;
        let meshes = layout.clusters.len() as u32;
        let needed = [
            (
                ids::cluster_runs(view),
                patches * 4,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::cluster_offsets(view),
                patches * 4,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::cluster_list(view),
                indices * 4,
                usage::INDEX | usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::cluster_draws(view),
                meshes.max(1) * INDIRECT_WORDS * 4,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::cluster_params(view),
                PARAMS_STRIDE * STAGES,
                usage::UNIFORM | usage::COPY_DST,
            ),
        ];
        let buffers = self.views[view.index()].get_or_insert_with(ViewBuffers::default);
        let made = [
            &mut buffers.runs,
            &mut buffers.offsets,
            &mut buffers.list,
            &mut buffers.draws,
            &mut buffers.params,
        ];
        let mut recreated = false;
        for ((id, size, flags), made) in needed.into_iter().zip(made) {
            if *made < size {
                *made = grown_size(size, binding_bytes);
                list.push(Op::CreateBuffer, &[id, *made, flags])?;
                recreated = true;
            }
        }
        if !recreated && !tables_recreated && buffers.group {
            return Ok(());
        }
        let entries = [
            (0, ids::cluster_params(view), PARAMS_STRIDE),
            (1, ids::CLUSTER_PATCHES, 0),
            (2, ids::CLUSTER_INDICES, 0),
            (3, ids::visible(view), 0),
            (4, ids::indirect(view), 0),
            (5, ids::cluster_runs(view), 0),
            (6, ids::cluster_offsets(view), 0),
            (7, ids::cluster_list(view), 0),
            (8, ids::cluster_draws(view), 0),
        ];
        let mut words = [0u32; 3 + 9 * 5];
        words[..3].copy_from_slice(&[ids::cluster_group(view), bind_layout::CLUSTER_CULL, 9]);
        for (at, (binding, id, size)) in entries.into_iter().enumerate() {
            let at = 3 + at * 5;
            words[at..at + 5].copy_from_slice(&[binding, resource_kind::BUFFER, id, 0, size]);
        }
        list.push(Op::CreateBindGroup, &words)?;
        buffers.group = true;
        Ok(())
    }

    /// Uploads one view's three blocks of dispatch parameters.
    pub(super) fn upload(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        layout: &Layout,
        rules: ViewRules<'_>,
    ) -> Result<(), RecordError> {
        let Some(buffers) = self.views.get(view.index()).and_then(Option::as_ref) else {
            return Ok(());
        };
        if buffers.params == 0 {
            return Ok(());
        }
        let mut bytes = [0u32; (PARAMS_STRIDE * STAGES / 4) as usize];
        for stage in 0..STAGES {
            let at = (stage * PARAMS_STRIDE / 4) as usize;
            for (plane, out) in rules.planes.iter().zip(bytes[at..at + 24].chunks_mut(4)) {
                for (value, word) in plane.iter().zip(out) {
                    *word = value.to_bits();
                }
            }
            let counts = [
                stage,
                layout.cluster_patches.len() as u32,
                layout.clusters.len() as u32,
                rules.draws_before,
            ];
            for (word, value) in bytes[at + 24..at + 28].iter_mut().zip(counts) {
                *word = value;
            }
            for (word, value) in bytes[at + 28..at + 32].iter_mut().zip(rules.levels) {
                *word = value.to_bits();
            }
        }
        let (at, length) = arena.push(words_as_bytes(&bytes))?;
        list.push(Op::WriteBuffer, &[ids::cluster_params(view), 0, at, length])?;
        Ok(())
    }

    /// Records a view's three dispatches: the count over the patches, the scan in one workgroup,
    /// then a workgroup to a patch for the copy.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
    ) -> Result<(), RecordError> {
        let Some(buffers) = self.views.get(view.index()).and_then(Option::as_ref) else {
            return Ok(());
        };
        let patches = layout.cluster_patches.len() as u32;
        if !buffers.group || patches == 0 {
            return Ok(());
        }
        let count = patches.div_ceil(WORKGROUP_SIZE);
        for (stage, groups) in [(0u32, count), (1, 1), (2, patches)] {
            list.push(Op::SetComputePipeline, &[ids::CLUSTER])?;
            list.push(
                Op::SetBindGroup,
                &[0, ids::cluster_group(view), 1, stage * PARAMS_STRIDE],
            )?;
            list.push(Op::Dispatch, &[groups, 1, 1])?;
        }
        Ok(())
    }

    /// The byte offset of a cluster mesh's indirect draw in a view's draw buffer.
    pub(super) const fn draw_offset(cluster: u32) -> u32 {
        cluster * INDIRECT_WORDS * 4
    }
}

const _: () = assert!(sizes::INDIRECT_WORDS == INDIRECT_WORDS);

//! Cluster levels: the pass that picks the patches a view draws and copies their indices into the
//! view's own list, so one indirect draw draws them all.
//!
//! A mesh with a tree of cluster patches (`crate::patches`) draws its tree in the camera's views
//! and in each shadow view instead of its whole triangle list. The culling pass counts the mesh's
//! instances, so a view that sees none of them draws none of its patches. Then three dispatches of
//! one pipeline fill the view's list (see `cluster_cull.wgsl`): the first counts each patch's
//! indices, the second adds the counts up into the view's list and writes each mesh's indirect
//! draw, and the third copies the chosen patches' indices. The view's opaque or shadow pass then
//! draws each cluster mesh with those draws, which name its list. Each view picks with its own
//! rule: a camera's view in its pixels, a shadow view in its map's texels.
//!
//! The scene's patch table and its indices are one buffer each, shared by every view, and they
//! upload again when a layout changes. After the patches, the table holds two sets of mesh
//! records, one for each of the scene's trees: the scene layout's, which the camera's views read,
//! and the casters' layout's, which the shadow views read. Each names its own layout's copy and
//! draw, so the two layouts share the trees' patches and indices. Each view has its own counts,
//! offsets, list, draws and parameters. The view's list holds the indices that the view picks:
//! the frame counts them with the same walk on the CPU ([`crate::patches::PatchTree::walk`]) and
//! sizes the list to them, with room to spare.
//!
//! A view that culls in two phases runs the pass twice. After the first culling phase it picks the
//! patches of the occluders that the first set of indirect draws counts, which the occluders' pass
//! draws, so an occluder's depth is this frame's. After the second phase it picks them again for
//! the opaque pass, from the second set. The two runs read the parameters of a set of stages each.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, sizes, template,
};

use null3d_core::levels::LevelRule;
use null3d_core::math::Affine;
use null3d_core::scene::SceneStorage;
use null3d_core::world::MATRIX_FLOATS;

use super::ids;
use super::layout::{ClusterMesh, Layout, NOT_DRAWN};
use crate::frame::{
    CellOffsets, RecordError, SceneSettings, UploadArena, grown_size, grown_size_within,
    words_as_bytes,
};
use crate::view::{ViewFrame, ViewId};

/// Bytes of one dispatch's parameters: six planes, four counts, the level rule's vector, where the
/// view measures errors, and the view's set of mesh records with its list's capacity.
const PARAMS_BYTES: u32 = 160;
const _: () = assert!(PARAMS_BYTES <= PARAMS_STRIDE);
/// The bytes between two dispatches' parameters, which every device's dynamic offsets take.
const PARAMS_STRIDE: u32 = 256;
/// The stages of a view's cluster pass: the count, the scan and the copy.
const STAGES: u32 = 3;
/// The sets of stage parameters of a view: one for the run that the opaque pass draws, and one for
/// the run after a first culling phase, whose draws come first in the view's indirect buffer.
const RUNS: u32 = 2;
/// What a view's dispatch parameters hold besides the layout's counts: its frustum planes, the
/// level rule, the draws that come before the view's own in its indirect buffer, and the set of
/// mesh records that it reads.
pub(super) struct ViewRules<'a> {
    pub(super) planes: &'a [[f32; 4]; 6],
    pub(super) rule: &'a LevelRule,
    pub(super) draws_before: u32,
    pub(super) records: RecordSet,
}

/// The set of mesh records in the scene's table that a view reads: the scene layout's, for the
/// camera's views, or the casters' layout's, for the shadow views.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RecordSet {
    Scene = 0,
    Casters = 1,
}

/// The sets of mesh records that the scene's table holds.
const RECORD_SETS: u32 = 2;

/// The words of one patch's record and of one mesh's record in the table.
pub(super) const PATCH_WORDS: u32 = 8;
pub(super) const MESH_WORDS: u32 = 8;
/// The words of one indexed indirect draw.
const INDIRECT_WORDS: u32 = 5;
/// The threads of the cluster pipeline's workgroups.
const WORKGROUP_SIZE: u32 = 64;

/// The bytes that a patch table of `patches` patches and `meshes` meshes takes, with each set of
/// mesh records, and the bytes of its indices.
pub(super) fn table_bytes(patches: u32, meshes: u32, indices: u32) -> [u32; 2] {
    [
        ((patches * PATCH_WORDS + RECORD_SETS * meshes * MESH_WORDS).max(1)) * 4,
        (indices.max(1)) * 4,
    ]
}

/// The indices that a view's list holds for `picked` indices that the CPU's walk picked: the
/// GPU's own arithmetic may pick a finer patch at a switch distance, so the list keeps room for a
/// few patches more.
pub(super) fn list_room(picked: u32) -> u32 {
    picked
        .saturating_add(picked / 16)
        .saturating_add(LIST_SPARE_INDICES)
}

/// The indices that a view's list keeps beyond a sixteenth of what it picks: a few patches' worth.
const LIST_SPARE_INDICES: u32 = 4 * 3 * 128;

/// The scene's cluster tables and each view's buffers.
#[derive(Debug, Default)]
pub(super) struct Clusters {
    /// The made sizes of the scene's patch table and its indices.
    tables: [u32; 2],
    /// The patches and the meshes of the table that the GPU holds.
    table_words: [u32; 2],
    /// The build count of the tables that the GPU holds, or `None` before it holds them.
    tables_epoch: Option<u64>,
    /// The mesh records that the GPU holds, the scene layout's then the casters', so a record
    /// that changes without a new layout writes the table again: a tree's copy moves with its
    /// bucket's slice, and the casters' layout changes on its own.
    records: Vec<[u32; 8]>,
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
    /// The indices that the view's list must hold in this frame.
    need: u32,
}

impl Clusters {
    /// The bytes that the cluster tables and one view's parameters take from the frame's uploads:
    /// the scene's patches, each set of its mesh records and its indices, when the layout holds
    /// them.
    pub(super) fn upload_bytes(layout: &Layout) -> usize {
        let patches = layout.cluster_patches.len() * PATCH_WORDS as usize;
        let meshes = layout.clusters.len() * (RECORD_SETS * MESH_WORDS) as usize;
        let indices = layout.cluster_indices.len();
        (patches + meshes + indices) * 4 + (PARAMS_STRIDE * STAGES * RUNS) as usize
    }

    /// Records the creation of the cluster pass's one pipeline.
    pub(super) fn create_pipeline(list: &mut DrawList) -> Result<(), RecordError> {
        list.push(
            Op::CreateComputePipeline,
            &[ids::CLUSTER, template::CLUSTER, 0],
        )?;
        Ok(())
    }

    /// Sizes the scene's two tables for the scene's layout `layout`, at most the storage binding's
    /// bytes each, and uploads them when they are new, when a layout changed, or when they hold
    /// another count of patches or other casters' records. `casters` is the casters' layout, whose
    /// records name its own copies and draws of the scene's trees, or `None` while no light casts
    /// shadows. Returns true when either buffer was made again. Only the path that runs the
    /// cluster pass calls this: its group binds each table whole, so the binding alone bounds them.
    pub(super) fn apply_tables(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        layout: &Layout,
        casters: Option<&Layout>,
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
                self.tables[k] = grown_size_within(needed[k], binding_bytes)?;
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
        // The casters' records follow the scene's trees one for one; a tree that no caster draws,
        // and every tree while no light casts shadows, takes a record that draws nothing.
        let caster_record = |k: usize| {
            let tree = casters
                .and_then(|casters| casters.clusters.get(k))
                .filter(|tree| tree.drawn());
            match tree {
                Some(tree) => mesh_record(tree),
                None => mesh_record(&ClusterMesh {
                    slot: NOT_DRAWN,
                    first_draw: NOT_DRAWN,
                    ..layout.clusters[k]
                }),
            }
        };
        let trees = layout.clusters.len();
        let record = |k: usize| {
            if k < trees {
                mesh_record(&layout.clusters[k])
            } else {
                caster_record(k - trees)
            }
        };
        let records_changed =
            self.records.len() != 2 * trees || (0..2 * trees).any(|k| self.records[k] != record(k));
        // The patch table and the index table change only with the trees, which the layout counts.
        // A structure change that leaves them alone, such as a level arriving, writes only the mesh
        // records, which follow the patches in the same buffer.
        let tables_changed = recreated
            || self.tables_epoch != Some(layout.cluster_tables_epoch())
            || self.table_words != words;
        if tables_changed {
            self.tables_epoch = Some(layout.cluster_tables_epoch());
            self.table_words = words;
            if !layout.cluster_patches.is_empty() {
                let mut table: Vec<u32> = Vec::with_capacity((patches * PATCH_WORDS) as usize);
                for patch in &layout.cluster_patches {
                    table.extend_from_slice(patch);
                }
                let (at, length) = arena.push(words_as_bytes(&table))?;
                list.push(Op::WriteBuffer, &[ids::CLUSTER_PATCHES, 0, at, length])?;
            }
            if !layout.cluster_indices.is_empty() {
                let (at, length) = arena.push(words_as_bytes(&layout.cluster_indices))?;
                list.push(Op::WriteBuffer, &[ids::CLUSTER_INDICES, 0, at, length])?;
            }
        }
        if tables_changed || records_changed || layout_changed {
            self.records.clear();
            self.records.extend((0..2 * trees).map(record));
            let mut records: Vec<u32> = Vec::with_capacity(self.records.len() * 8);
            for record in &self.records {
                records.extend_from_slice(record);
            }
            if !records.is_empty() {
                let (at, length) = arena.push(words_as_bytes(&records))?;
                let offset = patches * PATCH_WORDS * 4;
                list.push(Op::WriteBuffer, &[ids::CLUSTER_PATCHES, offset, at, length])?;
            }
        }
        Ok(recreated)
    }

    /// Notes the indices that a view's list must hold in this frame, `picked` by the CPU's walk.
    /// Returns true when the list must grow: the view then sizes its buffers again
    /// ([`Clusters::apply`]), and its bundle, which names the list, records again.
    pub(super) fn set_need(&mut self, view: ViewId, picked: u32) -> bool {
        if self.views.len() <= view.index() {
            self.views.resize(view.index() + 1, None);
        }
        let buffers = self.views[view.index()].get_or_insert_with(ViewBuffers::default);
        buffers.need = list_room(picked);
        buffers.list > 0 && buffers.list < buffers.need.max(1) * 4
    }

    /// Sizes one view's buffers for the scene's tables, with the list for the indices that
    /// [`Clusters::set_need`] noted, and binds its group again when a buffer it binds is new: one
    /// of its own, or one that `bound_recreated` names, of the scene's tables or of the view's
    /// culling, its compacted instances and indirect draws.
    pub(super) fn apply(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        bound_recreated: bool,
        binding_bytes: u32,
    ) -> Result<(), RecordError> {
        if self.views.len() <= view.index() {
            self.views.resize(view.index() + 1, None);
        }
        let [patches, meshes] = self.table_words;
        if patches == 0 {
            return Ok(());
        }
        let need = self.views[view.index()].map_or(0, |buffers| buffers.need);
        let needed = [
            (
                ids::cluster_runs(view),
                patches * 4,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::cluster_offsets(view),
                (patches + patches.div_ceil(WORKGROUP_SIZE)) * 4,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::cluster_list(view),
                need.max(1) * 4,
                usage::INDEX | usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::cluster_draws(view),
                meshes.max(1) * INDIRECT_WORDS * 4,
                usage::INDIRECT | usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::cluster_params(view),
                PARAMS_STRIDE * STAGES * RUNS,
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
                *made = grown_size(size, binding_bytes).ok_or(RecordError::BufferFull {
                    bytes: binding_bytes,
                })?;
                list.push(Op::CreateBuffer, &[id, *made, flags])?;
                recreated = true;
            }
        }
        if !recreated && !bound_recreated && buffers.group {
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

    /// Uploads one view's three blocks of dispatch parameters, and with `two_phases` the three of
    /// the run after the first culling phase, which reads the first set of indirect draws.
    pub(super) fn upload(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        rules: ViewRules<'_>,
        two_phases: bool,
    ) -> Result<(), RecordError> {
        let Some(buffers) = self.views.get(view.index()).and_then(Option::as_ref) else {
            return Ok(());
        };
        if buffers.params == 0 {
            return Ok(());
        }
        let [patches, meshes] = self.table_words;
        // The list holds what its buffer holds, which the shader never writes past.
        let capacity = buffers.list / 4;
        let runs = if two_phases { RUNS } else { 1 };
        let mut bytes = [0u32; (PARAMS_STRIDE * STAGES * RUNS / 4) as usize];
        for block in 0..STAGES * runs {
            let (stage, first) = (block % STAGES, block >= STAGES);
            let at = (block * PARAMS_STRIDE / 4) as usize;
            for (plane, out) in rules.planes.iter().zip(bytes[at..at + 24].chunks_mut(4)) {
                for (value, word) in plane.iter().zip(out) {
                    *word = value.to_bits();
                }
            }
            let counts = [
                stage,
                patches,
                meshes,
                if first { 0 } else { rules.draws_before },
            ];
            for (word, value) in bytes[at + 24..at + 28].iter_mut().zip(counts) {
                *word = value;
            }
            for (word, value) in bytes[at + 28..at + 32].iter_mut().zip(rules.rule.uniform()) {
                *word = value.to_bits();
            }
            for (word, value) in bytes[at + 32..at + 36]
                .iter_mut()
                .zip(rules.rule.measure_uniform())
            {
                *word = value.to_bits();
            }
            let set = [rules.records as u32 * meshes, capacity, 0, 0];
            bytes[at + 36..at + 40].copy_from_slice(&set);
        }
        let words = (PARAMS_STRIDE * STAGES * runs / 4) as usize;
        let (at, length) = arena.push(words_as_bytes(&bytes[..words]))?;
        list.push(Op::WriteBuffer, &[ids::cluster_params(view), 0, at, length])?;
        Ok(())
    }

    /// Records a view's three dispatches: the count over the patches, the scan in one workgroup,
    /// then a workgroup to a patch for the copy. With `first`, they pick the occluders' patches
    /// after a first culling phase, with the parameters of that run. A view whose layout draws no
    /// tree records none.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        first: bool,
    ) -> Result<(), RecordError> {
        let Some(buffers) = self.views.get(view.index()).and_then(Option::as_ref) else {
            return Ok(());
        };
        if !layout.clusters.iter().any(ClusterMesh::drawn) {
            return Ok(());
        }
        let patches = self.table_words[0];
        if !buffers.group || patches == 0 {
            return Ok(());
        }
        let count = patches.div_ceil(WORKGROUP_SIZE);
        let run = if first { STAGES } else { 0 };
        for (stage, groups) in [(0u32, count), (1, 1), (2, patches)] {
            list.push(Op::SetComputePipeline, &[ids::CLUSTER])?;
            list.push(
                Op::SetBindGroup,
                &[
                    0,
                    ids::cluster_group(view),
                    1,
                    (run + stage) * PARAMS_STRIDE,
                ],
            )?;
            list.push(Op::Dispatch, &[groups, 1, 1])?;
        }
        Ok(())
    }

    /// Forgets the scene's tables and every view's buffers, so each is made again, after the thread
    /// that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.tables = [0; 2];
        self.table_words = [0; 2];
        self.records.clear();
        self.views.clear();
    }

    /// The slot of each tree's copy that the GPU's table of the scene layout's mesh records names.
    pub(super) fn uploaded_slots(&self) -> impl Iterator<Item = u32> + '_ {
        let trees = self.records.len() / 2;
        self.records[..trees].iter().map(|record| record[2])
    }

    /// The byte offset of a cluster mesh's indirect draw in a view's draw buffer.
    pub(super) const fn draw_offset(cluster: u32) -> u32 {
        cluster * INDIRECT_WORDS * 4
    }
}

/// The indices that a view picks from the trees that `drawn`, its layout, draws: the walk of each
/// tree with the view's `rule`, for the object that draws it, inside the view's frustum, with the
/// scene's world in `parity` and `offsets` from the view's camera to each cell. The cluster pass
/// applies the same rule to the GPU's copy of the same matrix (`cluster_cull.wgsl`).
pub(super) fn picked_indices(
    scene: &SceneStorage,
    parity: usize,
    settings: &SceneSettings,
    drawn: &Layout,
    frame: &ViewFrame,
    rule: &LevelRule,
    offsets: &CellOffsets,
) -> u32 {
    let world = scene.world(parity);
    let matrices = world.matrices();
    let cells = scene.cells();
    let offsets = offsets.as_slice();
    let patches = settings.patches();
    drawn
        .clusters
        .iter()
        .filter(|tree| tree.drawn())
        .filter_map(|cluster| {
            let tree = patches.of(cluster.mesh)?;
            let slot = cluster.object as usize;
            let matrix: &Affine = matrices
                .get(slot * MATRIX_FLOATS..(slot + 1) * MATRIX_FLOATS)?
                .try_into()
                .ok()?;
            let cell = cells.get(slot).copied().unwrap_or(0);
            let offset = offsets.get(cell as usize).copied().unwrap_or([0.0; 4]);
            let offset = [offset[0], offset[1], offset[2]];
            Some(tree.picked_indices(matrix, offset, rule, Some(&frame.frustum)))
        })
        .fold(0u32, u32::saturating_add)
}

/// A cluster mesh's record in the scene's table: its first patch, its patches, the slot of its
/// copy, its first draw and its base vertex.
fn mesh_record(mesh: &ClusterMesh) -> [u32; 8] {
    [
        mesh.first_patch,
        mesh.patch_count,
        mesh.slot,
        mesh.first_draw,
        mesh.base_vertex,
        0,
        0,
        0,
    ]
}

const _: () = assert!(sizes::INDIRECT_WORDS == INDIRECT_WORDS);

#[cfg(test)]
mod tests {
    use super::*;
    use null3d_gpu::drawlist::decode;

    /// The sizes that a frame's list made the two tables with.
    fn made(list: &DrawList) -> Vec<u32> {
        decode(list.words())
            .filter_map(|command| {
                let command = command.expect("the buffer commands decode");
                (command.op == Op::CreateBuffer).then_some(command.operands[1])
            })
            .collect()
    }

    /// A cluster table holds a layout that fills the storage binding that the cluster pass group
    /// binds it within, and a layout that passes that binding fails the frame instead of asking
    /// for a buffer the group cannot bind.
    #[test]
    fn a_cluster_table_past_the_binding_is_refused() {
        let binding = 4096;
        // A scene with a tree of patches and no cluster meshes: one record per patch, and four
        // indices.
        let tables = |patches: usize| {
            let layout = Layout::with_cluster_tables(patches, 4);
            let mut list = DrawList::with_capacity(64);
            let mut arena = UploadArena::default();
            arena.begin_frame().unwrap();
            let mut clusters = Clusters::default();
            let outcome =
                clusters.apply_tables(&mut list, &mut arena, &layout, None, true, binding);
            (outcome, made(&list))
        };
        // A patch table of the binding's bytes, and its indices, fit.
        let (outcome, sizes) = tables(binding as usize / 32);
        outcome.expect("the tables fit the binding");
        assert_eq!(sizes[0], binding);
        assert!(sizes.iter().all(|&size| size <= binding), "{sizes:?}");
        // One patch more passes the binding, so the frame fails and names it.
        let (outcome, sizes) = tables(binding as usize / 32 + 1);
        assert_eq!(outcome, Err(RecordError::BufferFull { bytes: binding }));
        assert!(
            sizes.is_empty(),
            "a buffer was made past the binding: {sizes:?}"
        );
    }
}

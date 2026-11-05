//! Slots: the pass that culls one copy's level group by group and packs the kept groups' indices
//! into the view's own list, so one indirect draw draws the slot.
//!
//! A mesh whose pieces and groups exist draws its pieces in the camera's view, and the copies that
//! carry the most triangles of a level take that level's slots (`crate::gpu_driven::layout`). The
//! culling pass sends such a copy to its slot instead of the level's pieces, and this pass tests
//! the level's 64 to 128-triangle groups for that one copy: a group draws where its piece reaches
//! into the view and faces the eye, and where the group itself does. Three dispatches of one
//! pipeline fill the view's list (see `cluster_cull.wgsl`'s `GROUPS` build): the first counts each
//! group's indices, the second adds them up into the slot's room, and the third copies them.
//!
//! The slots' groups, pieces and parts are one table that every view reads, and it uploads when the
//! layout changes. Each slot's record names its copy's place in the view's compacted instances and
//! its room in the view's list, so it uploads in every frame that the pick changed it.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, index_format, layout as bind_layout, resource_kind, sizes,
    template,
};

use super::ids;
use super::layout::{
    Layout, MAX_SLOTS, SLOT_GROUP_WORDS, SLOT_PART_WORDS, SLOT_PIECE_WORDS, SLOT_WORDS,
};
use crate::frame::{MeshBuffers, RecordError, UploadArena, grown_size, words_as_bytes};
use crate::view::{ViewFrame, ViewId};

/// The words of one indexed indirect draw.
const INDIRECT_WORDS: u32 = 5;
/// The threads of the slot pipeline's workgroups.
const WORKGROUP_SIZE: u32 = 64;
/// The bytes of one dispatch's parameters: six planes, four counts, four words of settings, four
/// spare words and four places in the record table.
const PARAMS_BYTES: u32 = 160;
const _: () = assert!(PARAMS_BYTES <= PARAMS_STRIDE);
/// The bytes between two dispatches' parameters, which every device's dynamic offsets take.
const PARAMS_STRIDE: u32 = 256;
/// The stages of a view's slot pass: the count, the scan and the copy.
const STAGES: u32 = 3;
/// The groups that one copying workgroup takes, as the shader keeps them.
const COPY_GROUPS: u32 = 64;

/// The slot table's first word of each part, after the slots' records and their groups's and
/// pieces'.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct TablePlaces {
    slots: u32,
    groups: u32,
    pieces: u32,
    parts: u32,
    words: u32,
}

/// The places of the parts of the slot table that a layout of `slots` slots, `groups` groups,
/// `pieces` pieces and `parts` parts holds, as places among the table's `vec4u` entries.
fn table_places(slots: u32, groups: u32, pieces: u32, parts: u32) -> TablePlaces {
    let words = |first: u32, count: u32, stride: u32| first + count * stride;
    let group_at = words(0, slots, SLOT_WORDS);
    let piece_at = words(group_at, groups, SLOT_GROUP_WORDS);
    let part_at = words(piece_at, pieces, SLOT_PIECE_WORDS);
    let end = words(part_at, parts, SLOT_PART_WORDS);
    TablePlaces {
        slots: 0,
        groups: group_at / 4,
        pieces: piece_at / 4,
        parts: part_at / 4,
        words: end.max(4),
    }
}

/// The scene's slot table and each view's slot buffers.
#[derive(Debug, Default)]
pub(super) struct Slots {
    /// The made size of the scene's table, and the words that it holds.
    table: u32,
    table_words: u32,
    /// The layout's groups, pieces and parts, which upload when it changes.
    built: bool,
    /// The slots' records, which the frame fills again when the pick or a slice changes.
    records: Vec<u32>,
    /// Each view's buffers, by view id.
    views: Vec<Option<ViewBuffers>>,
}

/// One view's slot buffers, and their made sizes.
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

/// The words that a layout's slots' groups take in the runs' and offsets' buffers.
fn runs_words(layout: &Layout) -> u32 {
    layout
        .slot_levels
        .iter()
        .map(|level| level.group_count * level.slots)
        .sum()
}

/// The indices that a layout's slots' rooms take in the view's list.
fn room_total(layout: &Layout) -> u32 {
    layout.slot_room.iter().copied().sum()
}

impl Slots {
    /// The bytes that the slot table and one view's parameters take from the frame's uploads.
    pub(super) fn upload_bytes(layout: &Layout) -> usize {
        let places = table_places(
            layout.slot_buckets.len() as u32,
            layout.slot_groups.len() as u32,
            layout.slot_pieces.len() as u32,
            layout.slot_parts.len() as u32,
        );
        (places.words * 4 + PARAMS_STRIDE * STAGES) as usize
    }

    /// Records the creation of the slot pass's one pipeline.
    pub(super) fn create_pipeline(list: &mut DrawList) -> Result<(), RecordError> {
        list.push(Op::CreateComputePipeline, &[ids::SLOT, template::SLOT, 0])?;
        Ok(())
    }

    /// Sizes the scene's slot table for `layout` and uploads its groups, pieces and parts when the
    /// layout is new. Returns true when the table was made again, which each view's bind group
    /// must see.
    pub(super) fn apply_table(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        layout: &Layout,
        layout_changed: bool,
        binding_bytes: u32,
    ) -> Result<bool, RecordError> {
        if layout.slot_buckets.is_empty() {
            return Ok(false);
        }
        let places = table_places(
            layout.slot_buckets.len() as u32,
            layout.slot_groups.len() as u32,
            layout.slot_pieces.len() as u32,
            layout.slot_parts.len() as u32,
        );
        let mut recreated = false;
        if self.table < places.words * 4 {
            self.table =
                grown_size(places.words * 4, binding_bytes).ok_or(RecordError::BufferFull {
                    bytes: binding_bytes,
                })?;
            list.push(
                Op::CreateBuffer,
                &[
                    ids::SLOT_TABLE,
                    self.table,
                    usage::STORAGE | usage::COPY_DST,
                ],
            )?;
            recreated = true;
            self.built = false;
        }
        if recreated || layout_changed || !self.built || self.table_words != places.words {
            self.table_words = places.words;
            self.built = true;
            let mut table: Vec<u32> = Vec::with_capacity(places.words as usize);
            // The slots' records come first and the frame writes them; the groups, pieces and
            // parts follow them.
            table.resize(layout.slot_buckets.len() * SLOT_WORDS as usize, 0);
            for group in &layout.slot_groups {
                table.extend_from_slice(group);
            }
            for piece in &layout.slot_pieces {
                table.extend_from_slice(&[
                    piece.sphere[0].to_bits(),
                    piece.sphere[1].to_bits(),
                    piece.sphere[2].to_bits(),
                    piece.sphere[3].to_bits(),
                    piece.cone[0].to_bits(),
                    piece.cone[1].to_bits(),
                    piece.cone[2].to_bits(),
                    piece.cone[3].to_bits(),
                ]);
            }
            for part in &layout.slot_parts {
                table.extend_from_slice(part);
            }
            let (at, length) = arena.push(words_as_bytes(&table))?;
            list.push(Op::WriteBuffer, &[ids::SLOT_TABLE, 0, at, length])?;
        }
        Ok(recreated)
    }

    /// Sizes the camera's slot buffers for `layout`. Returns true when it made one again, which the
    /// view's bind group and its bundle must see.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        layout: &Layout,
        binding_bytes: u32,
    ) -> Result<bool, RecordError> {
        let view = ViewId::CAMERA;
        if layout.slot_buckets.is_empty() {
            return Ok(false);
        }
        if self.views.len() <= view.index() {
            self.views.resize(view.index() + 1, None);
        }
        let runs = runs_words(layout).max(1);
        let room = room_total(layout).max(1);
        let needed = [
            (
                ids::slot_runs(view),
                runs * 4,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::slot_offsets(view),
                runs * 4,
                usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::slot_list(view),
                room * 4,
                usage::INDEX | usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::slot_draws(view),
                MAX_SLOTS * INDIRECT_WORDS * 4,
                usage::INDIRECT | usage::STORAGE | usage::COPY_DST,
            ),
            (
                ids::slot_params(view),
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
                *made = grown_size(size, binding_bytes).ok_or(RecordError::BufferFull {
                    bytes: binding_bytes,
                })?;
                list.push(Op::CreateBuffer, &[id, *made, flags])?;
                recreated = true;
            }
        }
        if recreated {
            buffers.group = false;
        }
        Ok(recreated)
    }

    /// Binds the camera's slot group again when a buffer it binds is new: one of its own, the
    /// scene's table, or the view's culling buffers that `bound_recreated` names.
    pub(super) fn apply(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        meshes: &MeshBuffers,
        bound_recreated: bool,
        binding_bytes: u32,
    ) -> Result<(), RecordError> {
        if view != ViewId::CAMERA || layout.slot_buckets.is_empty() {
            return Ok(());
        }
        let Some(buffers) = self.views.get_mut(view.index()).and_then(Option::as_mut) else {
            return Ok(());
        };
        if !bound_recreated && buffers.group {
            return Ok(());
        }
        let _ = binding_bytes;
        // The page whose indices the slots read in place, which the binding reads up to the page's
        // own indices: the buffer may keep room to grow past them.
        let page = layout.slot_page;
        let table = self.table_words;
        let entries = [
            (0, ids::slot_params(view), PARAMS_STRIDE),
            (1, ids::SLOT_TABLE, table * 4),
            (2, meshes.ids(page).1, layout.slot_page_bytes),
            (3, ids::visible(view), 0),
            (4, ids::indirect(view), 0),
            (5, ids::slot_runs(view), 0),
            (6, ids::slot_offsets(view), 0),
            (7, ids::slot_list(view), 0),
            (8, ids::slot_draws(view), 0),
        ];
        let mut words = [0u32; 3 + 9 * 5];
        words[..3].copy_from_slice(&[ids::slot_group(view), bind_layout::CLUSTER_CULL, 9]);
        for (at, (binding, id, size)) in entries.into_iter().enumerate() {
            let at = 3 + at * 5;
            words[at..at + 5].copy_from_slice(&[binding, resource_kind::BUFFER, id, 0, size]);
        }
        list.push(Op::CreateBindGroup, &words)?;
        buffers.group = true;
        Ok(())
    }

    /// Writes the slots' records: each slot's copy's place in the view's compacted instances, the
    /// word that counts its copies, its room in the view's list, its level's groups and parts, and
    /// the first of its runs. The frame calls this when the pick or a slice changed.
    pub(super) fn write_records(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        layout: &Layout,
    ) -> Result<(), RecordError> {
        let slots = layout.slot_buckets.len();
        if slots == 0 {
            return Ok(());
        }
        self.records.clear();
        self.records.resize(slots * SLOT_WORDS as usize, 0);
        let mut first_run = 0u32;
        let mut first_room = 0u32;
        for level in &layout.slot_levels {
            for slot in level.first_slot..level.first_slot + level.slots {
                let bucket = &layout.buckets[layout.slot_buckets[slot as usize] as usize];
                let at = slot as usize * SLOT_WORDS as usize;
                let room = layout.slot_room[slot as usize];
                self.records[at..at + SLOT_WORDS as usize].copy_from_slice(&[
                    bucket.base * 4,
                    bucket.first_draw * INDIRECT_WORDS + 1,
                    first_room,
                    room,
                    level.first_group,
                    level.group_count,
                    level.first_part,
                    level.part_count,
                    first_run,
                    0,
                    0,
                    0,
                ]);
                first_run += level.group_count;
                first_room += room;
            }
        }
        let (at, length) = arena.push(words_as_bytes(&self.records))?;
        list.push(Op::WriteBuffer, &[ids::SLOT_TABLE, 0, at, length])?;
        Ok(())
    }

    /// Uploads one view's three blocks of dispatch parameters.
    pub(super) fn upload(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        layout: &Layout,
        frame: &ViewFrame,
    ) -> Result<(), RecordError> {
        let Some(buffers) = self.views.get(view.index()).and_then(Option::as_ref) else {
            return Ok(());
        };
        if buffers.params == 0 || layout.slot_buckets.is_empty() {
            return Ok(());
        }
        let places = table_places(
            layout.slot_buckets.len() as u32,
            layout.slot_groups.len() as u32,
            layout.slot_pieces.len() as u32,
            layout.slot_parts.len() as u32,
        );
        let mut bytes = [0u32; (PARAMS_STRIDE * STAGES / 4) as usize];
        for stage in 0..STAGES {
            let at = (stage * PARAMS_STRIDE / 4) as usize;
            for (plane, out) in frame
                .frustum
                .planes()
                .iter()
                .zip(bytes[at..at + 24].chunks_mut(4))
            {
                for (value, word) in plane.iter().zip(out) {
                    *word = value.to_bits();
                }
            }
            let counts = [stage, 0, layout.slot_buckets.len() as u32, 0];
            for (word, value) in bytes[at + 24..at + 28].iter_mut().zip(counts) {
                *word = value;
            }
            bytes[at + 28] = COPY_GROUPS;
            let records = [places.slots, places.groups, places.pieces, places.parts];
            bytes[at + 36..at + 40].copy_from_slice(&records);
        }
        let (at, length) = arena.push(words_as_bytes(&bytes))?;
        list.push(Op::WriteBuffer, &[ids::slot_params(view), 0, at, length])?;
        Ok(())
    }

    /// Records a view's three dispatches: the count over the slots' groups, the scan of a slot's
    /// room, then the copy of a run of a slot's groups. A view that draws no slot records none, and
    /// a view that culls in two phases draws its copies before its second pass places them.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        two_phases: bool,
    ) -> Result<(), RecordError> {
        if view != ViewId::CAMERA || two_phases || layout.slot_buckets.is_empty() {
            return Ok(());
        }
        let Some(buffers) = self.views.get(view.index()).and_then(Option::as_ref) else {
            return Ok(());
        };
        if !buffers.group {
            return Ok(());
        }
        let slots = layout.slot_buckets.len() as u32;
        let widest = layout
            .slot_levels
            .iter()
            .map(|level| level.group_count)
            .max()
            .unwrap_or(0);
        let count = widest.div_ceil(WORKGROUP_SIZE);
        let copy = widest.div_ceil(COPY_GROUPS);
        for (stage, groups) in [(0u32, (count, slots)), (1, (slots, 1)), (2, (copy, slots))] {
            list.push(Op::SetComputePipeline, &[ids::SLOT])?;
            list.push(
                Op::SetBindGroup,
                &[0, ids::slot_group(view), 1, stage * PARAMS_STRIDE],
            )?;
            list.push(Op::Dispatch, &[groups.0, groups.1, 1])?;
        }
        Ok(())
    }

    /// The byte offset of a slot's indirect draw in a view's draws buffer.
    pub(super) const fn draw_offset(slot: u32) -> u32 {
        slot * INDIRECT_WORDS * 4
    }

    /// The index format that a view's slot list holds.
    pub(super) const FORMAT: u32 = index_format::UINT32;

    /// Forgets the scene's table and every view's buffers, so each is made again, after the thread
    /// that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.table = 0;
        self.table_words = 0;
        self.built = false;
        self.views.clear();
    }
}

const _: () = assert!(sizes::INDIRECT_WORDS == INDIRECT_WORDS);

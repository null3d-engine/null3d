//! The sources and buckets that every view culls and draws, and their uploads: the world matrices,
//! the bucket, cell and layer mask of every source, the bucket records that the culling shader
//! reads, and the sources in cell order.
//!
//! A layout holds one kind of bucket. The scene's layout holds every object and instance row with a
//! mesh and a material, as the views of cameras draw them, and it owns the matrices, the layer
//! table and the cell order. The casters' layout holds the objects that cast shadows, grouped by
//! mesh alone, as the shadow cascades draw their depth. The outlined layout holds the objects that
//! the sketch outlines, grouped by mesh alone, as the outline view draws them into the outline
//! mask. The subsurface layout holds the objects whose material has a scatter radius, with the
//! skin pass's builds of their pipelines and their materials, as the subsurface view draws them
//! into the skin pass's target. The motion layout holds every opaque object and instance row,
//! grouped by mesh and by the material of a masked or swaying pair, as the motion view draws their
//! motion (see [`crate::motion`]). Each of the four has a bucket table and bucket records of its
//! own, and its culling reads the scene layout's matrices, layer table and cell order.

use std::collections::TryReserveError;
use std::ops::Range;

use null3d_core::alloc::keep_room;
use null3d_core::cells::CELL_SHIFT;
use null3d_core::culling::{NO_BUCKET, RowRanges, batch_ranges};
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::levels::{LevelLink, NO_LINK};
use null3d_core::memory::{MemoryUse, vec_bytes};
use null3d_core::scene::{SceneStorage, flags};
use null3d_core::snapshot::SCENE_TARGET;
use null3d_core::world::{MATRIX_FLOATS, UNBOUNDED_RADIUS};
use null3d_gpu::caps::{BUDGET, Limit};
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, permutation, sizes, state_flags, template,
};

use super::ids;
use super::skin::{SkinnedObject, SkinnedPart, Skinning};
use crate::cells::{CellCulling, CellMask, CellOrder, MOVING};
use crate::data_texture::{self, DataTexture, TextureRows, write_row_values};
use crate::debug_view::DebugView;
use crate::frame::{
    FrameInput, HIDDEN, KeyCounts, REBUILD_BYTES_PER_SOURCE, RecordError, SceneSettings,
    UploadArena, address, bucket_of, collect_bucket_keys, drawn_rows, floats_as_bytes, grown_size,
    joined_rows, words_as_bytes,
};
use crate::levels::{
    BucketKey, KeyLinks, expand_level_keys, is_fade_key, key_level, level_key, links_of,
};
use crate::meshes::MeshStorage;
use crate::motion::ChangedRanges;
use crate::object_ranges::ObjectRanges;
use crate::outline::mask_keys;
use crate::pipelines::{DrawKey, PassTargets, PipelineCache, Prepass};
use crate::shadows::CasterPasses;
use crate::subsurface::skin_key;
use crate::tone_mask::tone_key;

/// Words of one bucket record in the culling shader: base, material, radius, first draw, draw
/// count, the centre of the local sphere that culls the bucket's sources, and the first joint of
/// the skin of a bucket whose vertex shader skins.
pub(super) const BUCKET_WORDS: u32 = sizes::BUCKET_WORDS;
/// Bytes of one bucket record.
const BUCKET_BYTES: u32 = BUCKET_WORDS * 4;
/// Bytes of one world matrix: three rows of four floats.
const MATRIX_BYTES: u32 = (MATRIX_FLOATS * 4) as u32;
/// The index entries that fit in the bytes of one copied instance.
pub(super) const INDEX_ENTRIES_PER_COPY: u32 = sizes::INSTANCE_STRIDE / sizes::INDEX_STRIDE;
/// The mark of a level's bucket whose slice the frames size to the copies that they count.
pub(super) const COUNTED: u8 = 1;
/// The mark of a level's bucket whose slice holds every source of its set, which no frame counts.
pub(super) const FIXED: u8 = 2;
/// The most slots, over all of a layout's level sets, that the sets whose slices hold every
/// source of the set in each bucket take, as the builder's configuration gives it by default.
/// Each slot is one copy in each view's compacted instance buffer, so these take at most 512 KiB a
/// view. A frame's count of a set's copies costs CPU time for each source in each view, and a
/// small set saves little memory by it.
pub const FIXED_LEVEL_SLOTS: u32 = 8192;
/// Floats of one source's texel in the ranges texture: its start and its end distance, its own
/// local radius, which 0 leaves to its bucket's sphere, then a word that nothing reads.
const RANGE_FLOATS: usize = sizes::RANGE_TEXELS as usize * 4;

/// Appends one source's texel to the ranges texture's data.
fn push_range(ranges: &mut Vec<f32>, start: f32, end: f32, radius: f32) {
    ranges.extend_from_slice(&[start, end, radius, 0.0]);
}

// What makes a bucket, in draw order: what its mesh and material ask of their pipeline, the bind
// group of its material's map, the mesh page of its mesh's first part, its engine mesh id or a
// level key (see `crate::levels`), its material id, and the bounds that cull its sources (see
// `bounds_of`). The WebGL2 builder's keys have the same type, so both share one sort.

/// What a layout's buckets draw.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Drawn {
    /// Every object and instance row with a mesh and a material, as the views of cameras draw
    /// them.
    #[default]
    Scene,
    /// The objects and instance rows that cast shadows, as the shadow cascades draw their depth.
    Casters,
    /// The objects that the sketch outlines, as the outline view draws them into the outline mask.
    Outlined,
    /// The objects whose material has a scatter radius, as the subsurface view draws them into the
    /// skin pass's target.
    Subsurface,
    /// The objects whose material keeps its color as the display shows it, as the tone view draws
    /// them into the mask that the final pass reads.
    Tone,
    /// The opaque objects and instance rows, as the motion view draws the motion of those that
    /// move into the motion target.
    Motion,
}

impl Drawn {
    /// True for the passes that draw the scene's surfaces, where the scene's material override
    /// applies: the camera's views, the subsurface view and the tone view.
    fn overrides(self) -> bool {
        matches!(self, Drawn::Scene | Drawn::Subsurface | Drawn::Tone)
    }
}

/// The material of every caster bucket and every outlined bucket: neither a caster's depth nor an
/// object's place in the outline mask depends on its material, so the objects of one mesh share a
/// bucket.
const CASTER_MATERIAL: u32 = 1;

/// The bounds of sources culled with their mesh's sphere, centred on their origin.
const MESH_BOUNDS: u32 = 0;
/// The bounds of sources that culling keeps wherever they are.
const UNCULLED_BOUNDS: u32 = 1;
/// The bounds of a scene object with a sphere of its own: this plus its slot.
const OWN_BOUNDS: u32 = 2;
/// The bounds of the skinned objects that the vertex shaders skin. The objects of one mesh and
/// material share a bucket, as a crowd of one model draws in one instanced draw per part, and the
/// bucket's sphere holds each object's own (see `Layout::fit_skinned`).
const SHARED_SKIN_BOUNDS: u32 = u32::MAX;

/// The bounds part of a scene object's bucket key. The culling shader reads one local sphere per
/// bucket, so each object with a sphere of its own draws from a bucket of its own, apart from the
/// skinned objects that the vertex shaders skin, whose copies need no vertices of their own. An
/// object that a feature-instance draw places always draws from a bucket of its own: the bucket
/// names the add-on's rows and count word, and the frame draws the count that the page or the
/// add-on's compute wrote. Such an object is unculled, because the add-on's own count is its cull,
/// and a mesh made from arrays carries no bounds of its own.
fn bounds_of(
    scene: &SceneStorage,
    skinning: &Skinning,
    features: &crate::feature_instances::FeatureInstanceTable,
    slot: usize,
) -> u32 {
    let object_flags = scene.flags()[slot];
    if !features.is_empty() && features.id_of(slot as u32).is_some() {
        OWN_BOUNDS + slot as u32
    } else if object_flags & flags::UNCULLED != 0 {
        UNCULLED_BOUNDS
    } else if skinning.skins_in_vertex_shader(slot as u32) && scene.level_biases()[slot] == 1.0 {
        // The skinned objects of one mesh share a bucket, whose sphere holds every one of them. A
        // bucket holds one bias, so a skinned object that sets its own bias draws from a bucket of
        // its own, as any other object with a bias does.
        SHARED_SKIN_BOUNDS
    } else if object_flags & flags::CUSTOM_BOUNDS != 0 || scene.level_biases()[slot] != 1.0 {
        OWN_BOUNDS + slot as u32
    } else {
        MESH_BOUNDS
    }
}

/// The scene slot of the one object that bounds `bounds` belong to, or `None` for bounds that
/// buckets share.
fn object_of(bounds: u32) -> Option<u32> {
    match bounds {
        SHARED_SKIN_BOUNDS => None,
        own => own.checked_sub(OWN_BOUNDS),
    }
}

/// The center and radius of the local sphere that culls a bucket with `bounds`, whose mesh's
/// sphere lies at `mesh_center` with `mesh_radius`. The core gives the bucket's objects and batch
/// rows the same sphere, so the copies that it counts are the ones that the GPU keeps.
fn local_sphere(
    scene: &SceneStorage,
    bounds: u32,
    mesh_center: [f32; 3],
    mesh_radius: f32,
) -> ([f32; 3], f32) {
    match bounds {
        MESH_BOUNDS => (mesh_center, mesh_radius),
        // A shared bucket's sphere comes from its objects' once the layout lists them.
        SHARED_SKIN_BOUNDS => ([0.0; 3], mesh_radius),
        UNCULLED_BOUNDS => ([0.0; 3], UNBOUNDED_RADIUS),
        own => {
            let slot = (own - OWN_BOUNDS) as usize;
            let center = &scene.local_centers()[slot * 3..slot * 3 + 3];
            ([center[0], center[1], center[2]], scene.local_radii()[slot])
        }
    }
}

/// One bucket: its pipeline, its slice of each view's compacted instance buffer, and its draws.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct Bucket {
    /// The id of its render pipeline. In the casters' layout, the pipeline that draws into the
    /// shadow cascades, or 0 while the cascades are off.
    pub(super) pipeline: u32,
    /// The id of the render pipeline that draws its depth in the depth prepass or the occluders'
    /// pass, or 0 for a bucket that the pass leaves out. In the outlined layout, the pipeline that
    /// marks the parts that nothing hides, after `pipeline` marked every part. In the casters'
    /// layout, the pipeline that draws into the shadow atlas's tiles, or 0 while the tiles are off.
    pub(super) prepass: u32,
    /// True when that pipeline is the bucket's own template's, which reads the frame group and the
    /// maps' group as the shading does, and false for the depth template's.
    pub(super) prepass_own: bool,
    /// The id of the render pipeline that draws its depth in the occluders' pass of occlusion
    /// culling, or 0 for a bucket that hides nothing.
    pub(super) occluder: u32,
    /// True when that pipeline is the bucket's own template's, which reads the frame group and the
    /// maps' group as the shading does.
    pub(super) occluder_own: bool,
    /// True for a bucket whose surface writes no color. Its draws come first, so the depth it
    /// writes holds back the color of the surfaces behind it.
    pub(super) holdout: bool,
    /// The bind group of its material's map, or 0 for a pipeline that reads none.
    pub(super) group: u32,
    pub(super) material: u32,
    pub(super) base: u32,
    pub(super) capacity: u32,
    /// Its draws, one per part of its mesh: `draws` of the layout's draws from `first_draw` on.
    pub(super) first_draw: u32,
    pub(super) draws: u32,
    /// The mesh field of its bucket key: the mesh's engine id, or a level key. The staged levels'
    /// watches read it to tell which mesh and level a bucket draws.
    pub(super) mesh_key: u32,
    /// The local sphere that culls its sources.
    pub(super) center: [f32; 3],
    pub(super) radius: f32,
    /// True for a bucket of skinned objects whose vertex shaders skin them, whose first joint
    /// sends the culling pass to each source's own (see [`sizes::PER_SOURCE_JOINT`]).
    pub(super) skins: bool,
    /// True when its material takes parallax, so its pipelines read the displacement map in the
    /// fragment stage as well and bind the frame group of parallax in place of the frame group.
    pub(super) parallax: bool,
    pub(super) first_joint: u32,
    /// True when its pipelines read their instances by index, so its slice holds an index entry
    /// per instance from entry `base` on, after every copy; false when it holds a copy per instance
    /// from copy `base` on.
    pub(super) indexed: bool,
    /// In the motion layout, true when its instances move by themselves, as skinned and morphed
    /// meshes and swaying custom materials do, so the motion view draws them in every frame.
    pub(super) moves: bool,
    /// Its level of detail's error and links, for a bucket of a mesh with levels.
    pub(super) levels: KeyLinks,
    /// The level of detail that the bucket draws, 0 for the base level or a mesh without levels.
    /// The levels debug view writes it beside each copy.
    pub(super) level: u32,
    /// True for a fade bucket, whose slice holds each instance as a pair: its entry, then its
    /// fade value's bits.
    pub(super) pairs: bool,
    /// The id of the pipeline that draws its objects into GPU picking's id target, or 0 while
    /// picking is off or its pair has no pick build.
    pub(super) pick: u32,
    /// True when its material reads the copy of the scene's depth, which its draws bind.
    pub(super) scene_depth: bool,
    /// True when that pipeline binds the material's maps, as a custom material's pick build does.
    pub(super) pick_maps: bool,
    /// The threshold bias that picks its sources' levels of detail: 1 for the quality settings'
    /// threshold, and above or below 1 for a coarser or a finer level.
    pub(super) bias: f32,
    /// The cluster tree that its mesh draws in the camera's views, as a place in
    /// [`Layout::clusters`], or `None` for a bucket whose mesh draws its whole triangle list.
    pub(super) cluster: Option<u32>,
    /// The id of the feature-instance draw that fills this bucket's per-instance buffer and whose
    /// count word the bucket's indirect draws take, or 0 for a bucket of the engine's own.
    pub(super) feature: u32,
    /// The most instances that the feature draw's buffer holds, 0 for a bucket of the engine's own.
    pub(super) feature_capacity: u32,
    /// True while the add-on's feature says that the draw draws, and true for a bucket of the
    /// engine's own. A bucket whose feature is not ready records no draw in any view.
    pub(super) feature_ready: bool,
    /// The scene slot of the object that places the feature draw, or `u32::MAX` for a bucket of the
    /// engine's own.
    pub(super) feature_slot: u32,
    /// The buckets of the pieces that this bucket's mesh draws in its place (see
    /// [`crate::pieces`]): the first, and how many follow it. A bucket with pieces has no draws of
    /// its own, and the culling appends each copy to the slice of each piece that it shows.
    pub(super) pieces: Option<(u32, u32)>,
    /// For the bucket of a piece, the piece's cone of facings in its mesh's space: its axis and its
    /// cutoff, 1 or more where the cone test does not apply. `None` for every other bucket.
    pub(super) cone: Option<[f32; 4]>,
}

/// One indexed indirect draw of each view: a part of a bucket's mesh.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Draw {
    /// The mesh page whose indices it draws, and whose vertices unless `vertices` names others.
    pub(super) page: u32,
    pub(super) index_count: u32,
    pub(super) first_index: u32,
    pub(super) base_vertex: u32,
    /// The buffer and byte offset of the vertices it draws in place of its page's: a skinned
    /// part's region of a skinned vertex buffer.
    pub(super) vertices: Option<(u32, u32)>,
}

/// The bit of a table entry that marks a source that may hide others, which the first phase of
/// occlusion culling draws when it showed in the view's last frame and looks large on the screen.
/// Buckets take the bits below it, and the cell index the bits from `CELL_SHIFT` up.
pub(super) const OCCLUDER: u32 = 1 << 22;
const _: () = assert!(OCCLUDER << 1 == 1 << CELL_SHIFT);

/// The bit of a bucket record's word of index reads that marks a bucket that draws pieces in its
/// place, which never reads by index: the word then names the bucket of its first piece, which fits
/// below the occluder bit, and the count of its pieces from `PIECE_COUNT_SHIFT` up.
const PIECED: u32 = 1 << 31;
const PIECE_COUNT_SHIFT: u32 = 24;
const _: () = assert!(OCCLUDER < 1 << PIECE_COUNT_SHIFT);
const _: () = assert!(crate::pieces::MAX_PIECES < 1 << (31 - PIECE_COUNT_SHIFT));

/// The most buckets a layout holds, so that each fits below the occluder bit, and the entry of a
/// drawn source is never `HIDDEN`. Sources may outnumber it, but each bucket needs its own mesh,
/// material or bounds.
const MAX_BUCKETS: u32 = OCCLUDER;

/// A source's entry in the bucket table: its bucket with the occluder bit and its cell index above
/// it, or `HIDDEN` for a source that draws nowhere.
fn entry(bucket: u32, cell: u32, occluder: bool) -> u32 {
    if bucket == HIDDEN {
        HIDDEN
    } else if occluder {
        bucket | OCCLUDER | (cell << CELL_SHIFT)
    } else {
        bucket | (cell << CELL_SHIFT)
    }
}

/// A scene object's entry in the bucket table: its bucket, whether it may hide others, and its
/// cell, or `HIDDEN` while it is hidden, which its world radius says, and for an object whose
/// feature-instance draw the GPU counts, which the culling shader never visits. An object may hide
/// others when its bucket draws depth in the occluders' pass (`occludes`), unless its flags opt it
/// out.
fn scene_entry(
    home: u32,
    world_radius: f32,
    cell: u32,
    object_flags: u32,
    gpu_count: bool,
    occludes: bool,
) -> u32 {
    if gpu_count || world_radius == f32::NEG_INFINITY {
        HIDDEN
    } else {
        let occluder = occludes && object_flags & flags::NOT_OCCLUDER == 0;
        entry(home, cell, occluder)
    }
}

/// The entry of a batch's `row`: the batch's bucket and the row's cell while the row is active,
/// with the occluder bit while the bucket draws depth in the occluders' pass (`occludes`) and the
/// batch does not opt its rows out.
fn row_entry(bucket: u32, batch: &InstanceBatch, row: u32, active: u32, occludes: bool) -> u32 {
    if row < active {
        let occluder = occludes && !batch.not_occluder();
        entry(bucket, batch.cells()[row as usize], occluder)
    } else {
        HIDDEN
    }
}

/// True when bucket `bucket` of `buckets` draws depth in the occluders' pass, which a layout with
/// that pass gives the buckets of opaque surfaces that the depth template draws.
fn bucket_occludes(buckets: &[Bucket], bucket: u32) -> bool {
    buckets
        .get(bucket as usize)
        .is_some_and(|b| b.occluder != 0)
}

/// True when the object that places a feature-instance bucket is hidden, so its draw draws nothing
/// whatever its own count says.
pub(super) fn feature_hidden(radii: &[f32], bucket: &Bucket) -> bool {
    bucket.feature_slot != u32::MAX
        && radii.get(bucket.feature_slot as usize) == Some(&f32::NEG_INFINITY)
}

/// The occluders among entries.
fn occluders_in(entries: &[u32]) -> u32 {
    entries
        .iter()
        .filter(|&&entry| entry != HIDDEN && entry & OCCLUDER != 0)
        .count() as u32
}

/// Uploads the entries of sources `rows` of a per-source table into its buffer.
fn write_rows(
    list: &mut DrawList,
    arena: &mut UploadArena,
    buffer: u32,
    table: &[u32],
    rows: Range<u32>,
) -> Result<(), RecordError> {
    let (at, bytes) = arena.push(words_as_bytes(
        &table[rows.start as usize..rows.end as usize],
    ))?;
    list.push(Op::WriteBuffer, &[buffer, rows.start * 4, at, bytes])?;
    Ok(())
}

/// Sets the entries of `table` at `rows` to the values `wanted` gives by row, and returns the rows
/// from the first entry that changed to the last, or `None` when none changed.
fn sync_rows(
    table: &mut [u32],
    rows: Range<u32>,
    wanted: impl Fn(usize) -> u32,
) -> Option<Range<u32>> {
    let mut changed: Option<Range<u32>> = None;
    for row in rows {
        let value = wanted(row as usize);
        let entry = &mut table[row as usize];
        if *entry != value {
            *entry = value;
            changed = Some(changed.map_or(row..row + 1, |rows| rows.start..row + 1));
        }
    }
    changed
}

/// A source's bucket as the CPU culling reads it, or `NO_BUCKET` for a source that draws nowhere:
/// its bucket-table entry without the occluder bit and the cell index.
fn cull_entry(entry: u32) -> u32 {
    if entry == HIDDEN {
        NO_BUCKET
    } else {
        entry & (OCCLUDER - 1)
    }
}

/// Writes the CPU culling's copy of the bucket of every source in `rows` from their entries.
fn sync_cull(cull_buckets: &mut [u32], entries: &[u32], rows: Range<u32>) {
    let range = rows.start as usize..rows.end as usize;
    for (cull, &entry) in cull_buckets[range.clone()].iter_mut().zip(&entries[range]) {
        *cull = cull_entry(entry);
    }
}

/// A batch's part of the tables as they were last written: its raw id, its bucket, the active row
/// count its bucket table entries hold, and the mask its rows hold in the layer table.
#[derive(Clone, Copy, Debug)]
struct BatchRows {
    id: u32,
    bucket: u32,
    active: u32,
    layers: u32,
}

/// One cluster mesh: its first patch in the scene's tables, the patches it has, the slot of its
/// copy in a view's compacted instances, the first of its indirect draws, and its base vertex.
/// The casters' layout holds one for each of the scene's, in the same order, with
/// [`NOT_DRAWN`] for the slot and the draw of a tree that no caster draws.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct ClusterMesh {
    /// The engine mesh whose tree the pass picks, which a staged band's watch reads.
    pub(super) mesh: u32,
    /// The scene object that draws the tree, whose matrix places each patch.
    pub(super) object: u32,
    pub(super) first_patch: u32,
    pub(super) patch_count: u32,
    pub(super) slot: u32,
    pub(super) first_draw: u32,
    pub(super) base_vertex: u32,
}

/// The slot and the draw of a tree in the casters' layout that no caster draws, which the cluster
/// pass skips (`cluster_cull.wgsl`).
pub(super) const NOT_DRAWN: u32 = u32::MAX;

impl ClusterMesh {
    /// True when the layout draws the tree.
    pub(super) fn drawn(&self) -> bool {
        self.slot != NOT_DRAWN
    }
}

/// A hash of the keys whose trees the tables hold, in their sorted order: a structure change that
/// leaves the same trees in the same order keeps the tables.
fn treed_keys_of(keys: &[(BucketKey, u32)]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    keys.hash(&mut hasher);
    hasher.finish()
}

/// The source layout and bucket tables, rebuilt when the structure changes.
#[derive(Default)]
pub(super) struct Layout {
    /// The most sources that a rebuild has checked the heap's room for.
    room_for_sources: u32,
    /// What the buckets draw.
    drawn: Drawn,
    /// True when the buckets whose templates can read their instances by index do so.
    index_instances: bool,
    /// True when a bucket's material takes parallax, so a pass records the frame group of parallax
    /// as well as the view's.
    parallax: bool,
    pub(super) sources: u32,
    /// Each batch's raw id and the first source of its rows.
    pub(super) batch_bases: Vec<(u32, u32)>,
    /// The sources up to the last row of a batch with row values, which the row values texture
    /// holds, or 0 while no batch has them.
    pub(super) value_sources: u32,
    /// The table of object ranges, which the scene's layout builds when it changes while a live
    /// material reads ids, and true while the GPU lacks its last build.
    object_ranges: ObjectRanges,
    ranges_pending: bool,
    pub(super) buckets: Vec<Bucket>,
    /// The level of each bucket, by bucket, for the CPU culling of the direct path.
    pub(super) bucket_levels: Vec<u32>,
    /// The views whose pass targets the buckets' materials sample, as a mask of view places.
    pub(super) material_views: u32,
    /// The views whose pass targets the buckets' pick pipelines sample, as a mask of view places.
    pub(super) pick_views: u32,
    /// The slots of the buckets that read copies, and of those that read indices, which each
    /// view's compacted instance buffer holds after the copies.
    pub(super) copied: u32,
    pub(super) indexed: u32,
    /// Every bucket's draws, bucket by bucket; a draw's place is its indirect draw's.
    pub(super) draws: Vec<Draw>,
    /// The buckets in the order that a pass draws them: each bucket's pieces in its place, and the
    /// buckets of the pieces after every other bucket in the table, which no source names.
    pub(super) draw_order: Vec<u32>,
    /// Each bucket whose mesh draws pieces in its place, and that mesh by the storage's id, for the
    /// check of what pieces cull.
    pub(super) piece_parents: Vec<(u32, u32)>,
    /// The first of the draws of the pieces and of their buckets' tallies, which follow every other
    /// draw.
    pub(super) first_piece_draw: u32,
    /// The entry of every source: its bucket, its occluder bit and its cell, or `HIDDEN`.
    instance_buckets: Vec<u32>,
    /// The shown scene objects whose entries carry the occluder bit, and the batches whose rows
    /// carry it.
    occluders: u32,
    /// True while the layout's builds give its buckets pipelines of the occluders' pass of
    /// occlusion culling.
    occluder_pass: bool,
    /// The layer mask of every source.
    source_layers: Vec<u32>,
    /// The texel of the ranges texture that every source reads: its start and end distance, its own
    /// local radius, which 0 leaves to its bucket's sphere, then a word that nothing reads.
    source_ranges: Vec<f32>,
    /// The texel rows of the distance ranges texture, 0 before it exists.
    ranges_rows: u32,
    /// True when any source of the scene draws in a distance band, which every layout of that
    /// scene culls by, its own sources or another layout's.
    has_ranges: bool,
    /// True when every scene slot holds the default mask in the layer table, as it does while no
    /// object has a mask of its own.
    scene_layers_default: bool,
    /// The bucket of every scene slot whether it is shown or not, or `HIDDEN` for a slot with no
    /// mesh or material.
    home_buckets: Vec<u32>,
    /// The sources that are scene slots: the rows that `home_buckets` and the scene's world
    /// buffers hold. The sources after them are batch rows.
    pub(super) scene_rows: u32,
    /// The bucket of every source as the CPU culling reads it, or `NO_BUCKET` for a source that
    /// draws nowhere. It is `instance_buckets` without the occluder bit and the cell index.
    pub(super) cull_buckets: Vec<u32>,
    /// Each bucket's link to its next level of detail, as the CPU culling reads it.
    pub(super) level_links: Vec<LevelLink>,
    /// For each bucket that holds a level's copies, the buckets of a level set and their fade
    /// buckets, how its slice is sized: [`COUNTED`] to the copies that a frame draws
    /// ([`Layout::fit_copies`](super::copies)), or [`FIXED`] to every source of its set. 0 for
    /// any other bucket.
    pub(super) marks: Vec<u8>,
    /// The buckets that `marks` marks, in bucket order.
    pub(super) level_buckets: Vec<u32>,
    /// The sources whose home bucket `marks` marks [`COUNTED`], in source order, shown or hidden:
    /// the only sources whose copies the frame counts to size the levels' slices.
    pub(super) level_sources: Vec<u32>,
    /// The sources whose home bucket `marks` marks [`FIXED`], in source order: the count visits
    /// them only while a loader watches staged levels.
    pub(super) fixed_sources: Vec<u32>,
    /// Working lists of a build's choice of the sets that it fixes: which buckets another bucket
    /// links to, and the buckets of one set.
    linked: Vec<bool>,
    set: Vec<u32>,
    /// The most slots that the sets whose slices hold every source of the set take in all.
    fixed_slots: u32,
    /// The cluster meshes that the layout's views draw from their trees. The scene's layout picks
    /// them; the casters' layout holds one for each of the scene's, in the same order.
    pub(super) clusters: Vec<ClusterMesh>,
    /// The scene's cluster meshes, which the casters' layout may draw: the scene's tables hold
    /// their patches, and its own records name its own copies and draws.
    pub(super) scene_trees: Vec<ClusterMesh>,
    /// The tree generation and the hash of the tree keys whose patches the tables hold. A rebuild
    /// that changes neither keeps the tables, so a structure change does not copy or upload them.
    tables_generation: u64,
    treed_keys_hash: u64,
    tables_built: bool,
    /// Every cluster patch of those meshes, eight words each: its sphere and its record.
    pub(super) cluster_patches: Vec<[u32; 8]>,
    /// Every patch's indices, one patch after another.
    pub(super) cluster_indices: Vec<u32>,
    /// The largest count of copies that a view of the layout placed in each bucket in the last
    /// count, each thread's tallies of the views' counts, and the counts that size the slices:
    /// working space of [`Layout::fit_copies`](super::copies).
    pub(super) copy_counts: Vec<u32>,
    pub(super) copy_tallies: Vec<u32>,
    pub(super) copy_fits: Vec<u32>,
    /// True once a level's slices hold the counts of a frame of this layout.
    pub(super) slices_placed: bool,
    /// True while a level's slice moved and the frame has not recorded its bundles again.
    pub(super) slices_moved: bool,
    /// True for each bucket of a level that no view of the layout has placed a copy in for
    /// [`IDLE_FRAMES`](super::copies::IDLE_FRAMES) frames, and for the pieces of such a level. The
    /// views' bundles leave out its draws, whose instance count would be 0.
    pub(super) idle: Vec<bool>,
    /// The frames in a row that each bucket of a level held no copy, up to the count that makes it
    /// idle.
    pub(super) idle_frames: Vec<u16>,
    /// The most words that the CPU culling lists for one view: a source that fades between levels
    /// lists three words more than one that does not.
    cull_rows: u32,
    /// True while the levels debug view draws: the CPU culling writes each entry's level code, and
    /// the culling shader writes it into each copy, in place of the fade value.
    pub(super) codes: bool,
    /// Each batch's part of the tables, in `batch_bases` order.
    batch_rows: Vec<BatchRows>,
    /// The per-frame reset of every indirect draw: instance counts at zero.
    pub(super) indirect_template: Vec<u32>,
    /// Each skinned object whose bounds its pose moves, with its bucket, in bucket order: one
    /// object in a bucket of its own where the skinning pass skins it, and the objects that share
    /// a bucket where the vertex shaders skin them. Their bounds change with the pose in every
    /// frame.
    skinned: Vec<(u32, u32)>,
    /// The first joint of the skin of each scene slot up to the last that the vertex shaders skin,
    /// or 0, which the scene's layout uploads to the skin firsts texture, and the texel rows that
    /// the texture holds, 0 before it exists.
    skin_firsts: Vec<u32>,
    skin_firsts_rows: u32,
    /// The pipelines of the skinned objects that the layout leaves out until they are built.
    waiting: Vec<u32>,
    /// Bucket records in the culling shader's layout.
    pub(super) bucket_records: Vec<u32>,
    /// True when a bucket draws without writing depth, so a background drawn after the objects
    /// would cover it where nothing lies behind it.
    pub(super) depthless: bool,
    pub(super) built: bool,
    /// Sizes of the matrix buffer, the bucket table, the layer table, the bucket records and the
    /// cell order, 0 before they exist.
    buffer_sizes: [u32; 5],
    /// Every drawn source in cell order: the still sources cell by cell, then the moving ones.
    order: CellOrder,
    /// The cell culling build that the order follows, and whether the GPU holds it.
    order_build: Option<u32>,
    order_uploaded: bool,
    /// The buckets whose records this frame changed, from the first to the last plus one: every
    /// bucket of a rebuilt table, the buckets whose slice moved, and a skinned bucket whose bounds
    /// moved. The frame uploads them in one write, so no two writes to the table share a frame.
    records_dirty: Option<Range<u32>>,
}

impl Layout {
    /// Adds the bytes that the layout's tables hold to the memory register.
    pub(super) fn account(&self, use_: &mut MemoryUse) {
        for array in [
            vec_bytes(&self.batch_bases),
            vec_bytes(&self.buckets),
            vec_bytes(&self.draws),
            vec_bytes(&self.draw_order),
            vec_bytes(&self.instance_buckets),
            vec_bytes(&self.source_layers),
            vec_bytes(&self.source_ranges),
            vec_bytes(&self.home_buckets),
            vec_bytes(&self.cull_buckets),
            vec_bytes(&self.level_links),
            vec_bytes(&self.marks),
            vec_bytes(&self.level_buckets),
            vec_bytes(&self.level_sources),
            vec_bytes(&self.fixed_sources),
            vec_bytes(&self.linked),
            vec_bytes(&self.set),
            vec_bytes(&self.clusters),
            vec_bytes(&self.scene_trees),
            vec_bytes(&self.cluster_patches),
            vec_bytes(&self.cluster_indices),
            vec_bytes(&self.copy_counts),
            vec_bytes(&self.copy_tallies),
            vec_bytes(&self.copy_fits),
            vec_bytes(&self.batch_rows),
            vec_bytes(&self.indirect_template),
            vec_bytes(&self.skinned),
            vec_bytes(&self.skin_firsts),
            vec_bytes(&self.waiting),
            vec_bytes(&self.bucket_records),
        ] {
            use_.add(array);
        }
        use_.add(self.object_ranges.memory_use());
        use_.add(self.order.memory_use());
    }

    /// Bytes of each view's compacted instance buffer for this layout: a copy for each slot of the
    /// buckets that read copies, then an index entry for each slot of those that read indices. One
    /// copy more keeps the binding of a bucket whose slice holds none inside the buffer.
    pub(super) fn compacted_bytes(&self) -> u32 {
        let stride = self.copy_stride();
        (self.copied * stride + self.indexed * sizes::INDEX_STRIDE).max(stride) + stride
    }

    /// The most that one view copies into the upload arena for this layout, when at most `active`
    /// sources can draw: a copy for each of them, within the layout's compacted size. A source
    /// that is not active draws nothing and takes no upload room.
    pub(super) fn copy_upload_bytes(&self, active: u32) -> u32 {
        let stride = self.copy_stride();
        (self.copied.min(active) * stride + self.indexed.min(active) * sizes::INDEX_STRIDE)
            .max(stride)
            + stride
    }

    /// A layout whose buckets read `copied` slots, for the tests of the buffer that holds them,
    /// which read that count alone.
    #[cfg(test)]
    pub(super) fn with_copies(copied: u32) -> Self {
        Self {
            copied,
            ..Self::default()
        }
    }

    /// A layout of one bucket of one draw for each of `depth`, which draws depth in the occluders'
    /// pass where it is true, for the tests of the buckets that the pass draws.
    #[cfg(test)]
    pub(super) fn with_occluder_buckets(depth: &[bool]) -> Self {
        let buckets = (0..depth.len() as u32).map(|b| Bucket {
            occluder: u32::from(depth[b as usize]),
            first_draw: b,
            draws: 1,
            ..Bucket::default()
        });
        Self {
            buckets: buckets.collect(),
            ..Self::default()
        }
    }

    /// A layout with a tree of `patches` and `indices` of its own, for the tests of the tables that
    /// hold them, which read those counts alone.
    #[cfg(test)]
    pub(super) fn with_cluster_tables(patches: usize, indices: usize) -> Self {
        Self {
            cluster_patches: vec![[0; 8]; patches],
            cluster_indices: vec![0; indices],
            ..Self::default()
        }
    }

    /// Bytes of each copy in a view's compacted instance buffer: the motion layout's copies hold the
    /// last frame's matrix too.
    pub(super) fn copy_stride(&self) -> u32 {
        if self.drawn == Drawn::Motion {
            sizes::MOTION_INSTANCE_STRIDE
        } else {
            sizes::INSTANCE_STRIDE
        }
    }

    /// Each source's bucket as the CPU culling reads it, or `NO_BUCKET` for a source that draws
    /// nowhere.
    pub(super) fn cull_buckets(&self) -> &[u32] {
        &self.cull_buckets
    }

    /// Each bucket's link to its next level of detail, as the CPU culling reads it.
    pub(super) fn level_links(&self) -> &[LevelLink] {
        &self.level_links
    }

    /// The most words that the CPU culling lists for one view of this layout.
    pub(super) fn cull_rows(&self) -> u32 {
        self.cull_rows.max(self.sources)
    }

    /// The level of each bucket, by bucket, which the levels debug view writes beside each copy.
    pub(super) fn bucket_levels(&self) -> &[u32] {
        &self.bucket_levels
    }

    /// The layer mask of every source, which the scene's layout owns.
    pub(super) fn layers(&self) -> &[u32] {
        &self.source_layers
    }

    /// The first joint of the skin of every source up to the last that the vertex shaders skin,
    /// which the scene's layout owns.
    pub(super) fn skin_firsts(&self) -> &[u32] {
        &self.skin_firsts
    }

    /// Each batch's raw id and the first source of its rows.
    pub(super) fn batch_bases(&self) -> &[(u32, u32)] {
        &self.batch_bases
    }

    /// The number of batches that the layout lists rows of.
    pub(super) fn batch_count(&self) -> usize {
        self.batch_rows.len()
    }

    /// The raw id of batch `index`'s rows.
    pub(super) fn batch_id(&self, index: usize) -> u32 {
        self.batch_rows[index].id
    }

    /// The bucket of batch `index`'s rows, or `NO_BUCKET` for a batch that draws nowhere.
    pub(super) fn batch_bucket(&self, index: usize) -> u32 {
        self.batch_rows[index].bucket
    }

    /// The first source of batch `index`'s rows.
    pub(super) fn batch_base(&self, index: usize) -> u32 {
        self.batch_bases[index].1
    }

    /// An empty layout of buckets that draw `drawn`, whose pipelines read their instances by index
    /// where their templates can, with `index_instances`.
    pub(super) fn new(drawn: Drawn, index_instances: bool, fixed_slots: u32) -> Self {
        Self {
            drawn,
            index_instances,
            fixed_slots,
            ..Self::default()
        }
    }

    /// The buffers of the bucket table and the bucket records, which the culling passes bind.
    pub(super) fn table_ids(&self) -> (u32, u32) {
        match self.drawn {
            Drawn::Scene => (ids::INSTANCE_BUCKETS, ids::BUCKETS),
            Drawn::Casters => (ids::CASTER_BUCKETS, ids::CASTER_RECORDS),
            Drawn::Outlined => (ids::OUTLINE_BUCKETS, ids::OUTLINE_RECORDS),
            Drawn::Subsurface => (ids::SUBSURFACE_BUCKETS, ids::SUBSURFACE_RECORDS),
            Drawn::Tone => (ids::TONE_BUCKETS, ids::TONE_RECORDS),
            Drawn::Motion => (ids::MOTION_BUCKETS, ids::MOTION_RECORDS),
        }
    }

    /// True when this layout's passes bind the frame group of parallax for the buckets whose
    /// material takes parallax, in place of the view's frame group: the scene's layout with such a
    /// bucket. The casters' and the outlined layout never do: their pipelines bind the depth
    /// layout, or a mask template, under that group's id.
    pub(super) fn parallax_frame(&self) -> bool {
        self.drawn == Drawn::Scene && self.parallax
    }

    /// True for the scene's layout, which owns the matrices, the layer table and the cell order.
    fn owns_sources(&self) -> bool {
        self.drawn == Drawn::Scene
    }

    /// The rows of the tables that the scene's layout owns, for `sources` sources: all of them in
    /// the scene's layout, none in the casters'.
    fn owned(&self, sources: u32) -> u32 {
        if self.owns_sources() { sources } else { 0 }
    }

    /// The first source of the rows of the batch at `index` in the batch table's order.
    fn base_of(&self, target: u32) -> Option<u32> {
        if target == SCENE_TARGET {
            return Some(0);
        }
        self.batch_bases
            .iter()
            .find(|(id, _)| *id == target)
            .map(|&(_, base)| base)
    }

    /// True for a scene slot whose mesh and material draw, shown or hidden.
    pub(super) fn draws(&self, slot: usize) -> bool {
        self.home_buckets
            .get(slot)
            .is_some_and(|&bucket| bucket != HIDDEN)
    }

    /// Bytes of the matrix buffer on the GPU, 0 before it exists.
    pub(super) fn matrix_bytes(&self) -> u32 {
        self.buffer_sizes[0]
    }

    /// The most that one frame copies into its arena for the tables: the bucket table, the layer
    /// table, the bucket records, the cell order and the ranges texture.
    pub(super) fn upload_bound(&self) -> usize {
        let owned = self.owned(self.sources) as usize;
        // Each source has a row of the bucket table. The layout that owns the tables gives each
        // source a row of the layer table, a place in the cell order, and a texel of the ranges
        // texture.
        let rows = self.sources as usize * 4 + owned * (4 + 4 + RANGE_FLOATS * 4);
        let firsts = self.skin_firsts.len() * 4;
        // A frame that writes every record writes the skinned objects' bounds again after them.
        let writes = if self.skinned.is_empty() { 1 } else { 2 };
        // The scene's layout may build its table of object ranges in the frame, after this bound.
        let object_ranges = if self.owns_sources() {
            sizes::OBJECT_RANGE_BYTES as usize
        } else {
            0
        };
        rows + firsts + self.buckets.len() * BUCKET_BYTES as usize * writes + object_ranges
    }

    /// Makes room for the bucket table, the layer table and the cell order of `sources` sources.
    pub(super) fn reserve(&mut self, sources: u32) -> Result<(), TryReserveError> {
        let owned = self.owned(sources);
        for (table, rows) in [
            (&mut self.instance_buckets, sources),
            (&mut self.source_layers, owned),
        ] {
            table.try_reserve((rows as usize).saturating_sub(table.len()))?;
        }
        self.order.try_reserve(owned as usize)
    }

    /// The pipelines of the skinned objects that the layout leaves out, which must be built before
    /// they draw.
    pub(super) fn waiting(&self) -> &[u32] {
        &self.waiting
    }

    /// Empties the buckets, for a layout that draws nothing until it is built again.
    pub(super) fn clear(&mut self) {
        self.records_dirty = None;
        self.depthless = false;
        self.occluders = 0;
        self.buckets.clear();
        self.marks.clear();
        self.level_buckets.clear();
        self.level_sources.clear();
        self.fixed_sources.clear();
        self.idle.clear();
        self.idle_frames.clear();
        (self.copied, self.indexed) = (0, 0);
        self.draws.clear();
        self.draw_order.clear();
        self.piece_parents.clear();
        self.first_piece_draw = 0;
        self.skinned.clear();
        self.waiting.clear();
        self.indirect_template.clear();
        self.bucket_records.clear();
        self.material_views = 0;
        self.pick_views = 0;
    }

    /// Lists the sources whose home bucket takes a level's copies, by how the bucket's slice is
    /// sized: the scene slots by their home bucket, and every row of a batch by the batch's
    /// bucket. A source keeps its home bucket until the layout is built again, so the frames'
    /// counts of the levels' copies visit these alone.
    pub(super) fn note_level_sources(&mut self) {
        self.level_sources.clear();
        self.fixed_sources.clear();
        if self.level_buckets.is_empty() {
            return;
        }
        let marks = &self.marks;
        let mark = |bucket: u32| marks.get(bucket as usize).copied().unwrap_or(0);
        for source in 0..self.scene_rows {
            match mark(self.home_buckets[source as usize]) {
                COUNTED => self.level_sources.push(source),
                FIXED => self.fixed_sources.push(source),
                _ => {}
            }
        }
        for (index, &(_, base)) in self.batch_bases.iter().enumerate() {
            let list = match self.batch_rows.get(index).map(|rows| mark(rows.bucket)) {
                Some(COUNTED) => &mut self.level_sources,
                Some(FIXED) => &mut self.fixed_sources,
                _ => continue,
            };
            let end = self
                .batch_bases
                .get(index + 1)
                .map_or(self.sources, |&(_, next)| next);
            list.extend(base..end);
        }
    }

    /// Marks [`FIXED`] the level sets whose slices can hold every source of the set in each of
    /// their buckets within the layout's room for fixed slots in all, in bucket order. The build gives
    /// each bucket of a set a slot for every source of the set, so such a set never outgrows its
    /// slices, and the frames count none of its copies. Its levels' draws stay in the bundles
    /// while they hold no copy. A set with pieces or a tree of cluster patches stays counted:
    /// its idle levels leave many draws out.
    fn fix_small_sets(&mut self) {
        let buckets = self.buckets.len();
        // A set's base bucket is a level's bucket that no other bucket links to.
        let mut linked = std::mem::take(&mut self.linked);
        let mut set = std::mem::take(&mut self.set);
        linked.clear();
        linked.resize(buckets, false);
        for (bucket, link) in self.level_links.iter().enumerate() {
            for target in [link.next, link.fade] {
                if target != NO_LINK && target as usize != bucket {
                    linked[target as usize] = true;
                }
            }
        }
        let mut left = self.fixed_slots;
        for base in 0..buckets {
            if self.marks[base] != COUNTED || linked[base] {
                continue;
            }
            set.clear();
            self.set_buckets(base as u32, &mut set);
            let (mut slots, mut counted) = (0u32, false);
            for &bucket in &set {
                let bucket = &self.buckets[bucket as usize];
                slots = slots.saturating_add(bucket.capacity);
                counted |= bucket.pieces.is_some() || bucket.cluster.is_some();
            }
            if counted || slots > left {
                continue;
            }
            left -= slots;
            for &bucket in &set {
                self.marks[bucket as usize] = FIXED;
            }
        }
        self.linked = linked;
        self.set = set;
    }

    /// Pushes onto `set` each bucket of the level set whose base bucket is `base`: each level's
    /// bucket and its fade bucket.
    fn set_buckets(&self, base: u32, set: &mut Vec<u32>) {
        let mut bucket = base;
        loop {
            set.push(bucket);
            let link = self.level_links[bucket as usize];
            // A levels debug view's fade link names the level's own bucket.
            if link.fade != NO_LINK && link.fade != bucket {
                set.push(link.fade);
            }
            if link.next == NO_LINK || set.len() > self.buckets.len() {
                return;
            }
            bucket = link.next;
        }
    }

    /// The shown scene objects that may hide others, and the batches whose rows may: none means
    /// that occlusion culling has nothing to draw into its depth pyramid.
    pub(super) fn occluders(&self) -> u32 {
        self.occluders
    }

    /// True when bucket `bucket` draws depth in the occluders' pass.
    pub(super) fn bucket_occludes(&self, bucket: u32) -> bool {
        bucket_occludes(&self.buckets, bucket)
    }

    /// Gives the buckets of the next builds pipelines for the occluders' pass of occlusion culling,
    /// or none. Only the scene's own layout draws that pass.
    pub(super) fn set_occluder_pass(&mut self, on: bool) {
        self.occluder_pass = on && self.drawn == Drawn::Scene;
    }

    /// Forgets the buffers, so the next layout makes them again and uploads everything.
    pub(super) fn forget_gpu(&mut self) {
        self.built = false;
        self.buffer_sizes = [0; 5];
        self.skin_firsts_rows = 0;
        self.ranges_rows = 0;
        self.order_uploaded = false;
    }

    /// Brings the cell order up to the scene's, which `cells` keeps, and uploads it when it is new
    /// or the GPU lacks it. Every drawn scene slot goes where the scene order puts it, and each
    /// row of a batch that draws goes to its cell, or with the moving sources for a dynamic
    /// batch. Does nothing while cell culling does not run.
    #[inline(never)]
    pub(super) fn update_order(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        cells: &CellCulling,
        input: &FrameInput<'_>,
        casters: &Layout,
    ) -> Result<(), RecordError> {
        if !cells.active() {
            return Ok(());
        }
        if self.order_build != Some(cells.builds()) {
            let (scene, batches) = (input.scene, input.batches);
            let (bases, rows) = (&self.batch_bases, &self.batch_rows);
            // A blended batch that casts shadows has a bucket in the casters' layout alone, and the
            // cascades cull with this order too.
            let casts = |k: usize| {
                casters
                    .batch_rows
                    .get(k)
                    .is_some_and(|r| r.bucket != HIDDEN)
            };
            self.order.build(&|visit| {
                cells.visit_scene(scene, visit);
                let listed = batches.iter().zip(bases).zip(rows).enumerate();
                for (k, (((_, batch), &(_, base)), batch_rows)) in listed {
                    if batch_rows.bucket == HIDDEN && !casts(k) {
                        continue;
                    }
                    let dynamic = batch.is_dynamic();
                    for (row, &cell) in batch.cells().iter().enumerate() {
                        visit(base + row as u32, if dynamic { MOVING } else { cell });
                    }
                }
            });
            self.order_build = Some(cells.builds());
            self.order_uploaded = false;
        }
        if !self.order_uploaded && !self.order.sources().is_empty() {
            let (at, bytes) = arena.push(words_as_bytes(self.order.sources()))?;
            list.push(Op::WriteBuffer, &[ids::ORDER, 0, at, bytes])?;
            self.order_uploaded = true;
        }
        Ok(())
    }

    /// Every drawn source in cell order, as the GPU holds it while cell culling runs.
    pub(super) fn order(&self) -> &[u32] {
        self.order.sources()
    }

    /// The runs of the cell order that a view culls, as the culling shader reads them: the runs
    /// of the cells in `visible` and the moving sources' run, with runs that follow each other
    /// joined. Each is its first position, its end, and its first workgroup, which follow from
    /// the runs before it. Returns the runs and the workgroups they need.
    pub(super) fn ranges(&self, visible: &CellMask, out: &mut [[u32; 4]]) -> (usize, u32) {
        let (mut count, mut groups) = (0, 0);
        let mut close = |out: &mut [[u32; 4]], count: usize| {
            let [start, end, first, _] = &mut out[count - 1];
            *first = groups;
            groups += (*end - *start).div_ceil(sizes::CULL_WORKGROUP_SIZE);
        };
        for run in visible
            .iter()
            .map(|cell| self.order.run(cell))
            .chain(std::iter::once(self.order.run(MOVING)))
            .filter(|run| !run.is_empty())
        {
            if count > 0 && out[count - 1][1] == run.start {
                out[count - 1][1] = run.end;
                continue;
            }
            if count > 0 {
                close(out, count);
            }
            out[count] = [run.start, run.end, 0, 0];
            count += 1;
        }
        if count > 0 {
            close(out, count);
        }
        (count, groups)
    }

    /// Assigns every source to a bucket and lays the buckets out, from the frame's world state,
    /// with each bucket's pipeline id from `pipelines`, for a pass that draws into `targets`. While
    /// `shadows` has a pass on, the scene's receivers draw with pipelines that read the shadow maps,
    /// and the casters' buckets get a pipeline for each pass of `shadows` in place of `targets`.
    /// With a `prepass`, the buckets that the depth prepass or the occluders' pass draws get its
    /// pipelines too. The outlined layout's buckets get both pipelines of the outline mask, and the
    /// subsurface layout's the skin pass's pipelines.
    /// Skinned objects draw the skinned vertices that `skinning` lays out; the skinned objects that
    /// it hides get no bucket, and the layout asks only for their pipelines (see
    /// [`Self::waiting`]). It reuses the layout's tables and scratch space, which grow only with
    /// the scene. A scene of more than `limit` sources fails. A mesh may draw its tree of cluster
    /// patches where `cluster_binding` is the largest storage binding of the cluster pass that the
    /// frame runs, and 0 where it runs none.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn rebuild(
        &mut self,
        settings: &SceneSettings,
        pipelines: &mut PipelineCache,
        targets: PassTargets,
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
        limit: u32,
        shadows: CasterPasses,
        prepass: Prepass,
        skinning: &Skinning,
        key_counts: &mut KeyCounts,
        pick_targets: PassTargets,
        picking: bool,
        cluster_binding: u32,
    ) -> Result<(), RecordError> {
        let scene_rows = scene.capacity() + 1;
        self.codes = self.drawn == Drawn::Scene && settings.debug_view() == DebugView::Levels;
        self.batch_bases.clear();
        self.value_sources = 0;
        let mut sources = scene_rows;
        for (id, batch) in batches.iter() {
            self.batch_bases.push((id.raw(), sources));
            sources += batch.capacity();
            if batch.has_row_values() {
                self.value_sources = sources;
            }
        }
        if sources > limit {
            return Err(RecordError::TooManySources { limit });
        }
        self.sources = sources;
        // The tables below grow with plain pushes, which cannot report a refused request. They keep
        // their room between rebuilds, so a rebuild of no more sources asks for nothing new.
        if sources > self.room_for_sources {
            keep_room(sources as usize * REBUILD_BYTES_PER_SOURCE).map_err(|_| {
                RecordError::OutOfMemory {
                    bytes: sources.saturating_mul(REBUILD_BYTES_PER_SOURCE as u32),
                }
            })?;
            self.room_for_sources = sources;
        }
        if self.owns_sources() && settings.materials().reads_object_ids() {
            let bases = self.batch_bases.iter();
            let ranges = bases.map(|&(id, base)| (base, Handle::from_raw(id)));
            self.object_ranges.build(scene_rows, ranges);
            self.ranges_pending = true;
        }
        let owned = self.owned(sources);
        self.order
            .try_reserve(owned as usize)
            .map_err(|_| RecordError::OutOfMemory {
                bytes: owned.saturating_mul(4),
            })?;
        self.order_build = None;

        let meshes = settings.meshes();
        let drawn = self.drawn;
        let skin = |key: DrawKey, skinned: Option<SkinnedObject>| match skinned {
            Some(object) => skinning.skinned_key(&object, key),
            None => key,
        };
        let key_of = |pipeline: Option<DrawKey>, mesh, material, bounds, object: u32, skinned| {
            let pipeline = skin(pipeline?, skinned);
            // A decal draws in the decal pass alone: no shadow, depth or outline.
            if pipeline.decal() {
                return None;
            }
            let page = meshes.parts(meshes.mesh(mesh - 1)?, false).first()?.page;
            // Casters, outlined objects and toned objects draw with no material, through the depth
            // template's bindings, apart from masked casters, which test their material's alpha.
            let depth_key = match drawn {
                Drawn::Casters => Some(settings.caster_of(pipeline, material)),
                Drawn::Outlined => Some((mask_keys(pipeline).0, 0)),
                Drawn::Tone => {
                    // A blended surface lets the scene behind it show, so the mask cannot say
                    // which surface owns a pixel. Such a material keeps the curve on the HDR path.
                    if pipeline.sorts() {
                        return None;
                    }
                    Some((tone_key(pipeline), 0))
                }
                Drawn::Scene | Drawn::Subsurface => None,
                Drawn::Motion => Some(settings.motion_of(pipeline, material)?),
            };
            if let Some((key, group)) = depth_key {
                // The motion template reads its material only to test a mask.
                let unmasked_motion = key.template == template::MOTION
                    && key.permutation & permutation::ALPHA_MASK == 0;
                let material = if key.template == template::SHADOW_DEPTH
                    || drawn == Drawn::Outlined
                    || drawn == Drawn::Tone
                    || unmasked_motion
                {
                    CASTER_MATERIAL
                } else {
                    material
                };
                return Some((skin(key, skinned), group, page, mesh, material, bounds));
            }
            // Blended pairs, and pairs that let light through, draw in the transparent pass, which
            // sorts them on the job workers.
            if pipeline.sorts() {
                return None;
            }
            let pipeline = if shadows.any() && object & flags::RECEIVE_SHADOWS != 0 {
                settings.receiving(pipeline)
            } else {
                pipeline
            };
            let pipeline = settings.area_key(pipeline);
            let group = settings.texture_group(material, pipeline);
            // The skin pass draws the pair with its own builds, which bind the same maps.
            let pipeline = match drawn {
                Drawn::Subsurface => skin_key(pipeline)?,
                _ => pipeline,
            };
            Some((pipeline, group, page, mesh, material, bounds))
        };
        let world = scene.world(parity);
        let any_key = |slot: usize| {
            let object = scene.flags()[slot];
            let own = scene.materials()[slot];
            let material = if drawn.overrides() {
                settings.drawn_material(own)
            } else {
                own
            };
            let left_out = match drawn {
                Drawn::Scene => false,
                Drawn::Casters => !shadows.any() || object & flags::CAST_SHADOWS == 0,
                Drawn::Outlined => object & flags::OUTLINED == 0,
                Drawn::Subsurface => !settings.scatters(material),
                Drawn::Tone => !settings.keeps_display_color(material),
                Drawn::Motion => false,
            };
            if left_out {
                return None;
            }
            let bounds = bounds_of(scene, skinning, settings.feature_instances(), slot);
            let mesh = scene.meshes()[slot];
            key_of(
                settings.pipeline_of(mesh, material),
                mesh,
                material,
                bounds,
                object,
                skinning.object(slot as u32),
            )
        };
        let scene_key = |slot: usize| {
            if skinning.hides(slot as u32) {
                None
            } else {
                any_key(slot)
            }
        };
        // Instance batches cast and receive shadows as their shadow bits say, and take no
        // outlines. Sprites sized in pixels of the screen have no bounds in the world, so culling
        // keeps them; sprites cast no shadows.
        let batch_key = |batch: &InstanceBatch| {
            let bits = batch.shadows();
            match drawn {
                Drawn::Casters if bits & flags::CAST_SHADOWS == 0 => None,
                Drawn::Scene | Drawn::Casters | Drawn::Motion => {
                    let bounds = if batch.unculled() {
                        UNCULLED_BOUNDS
                    } else {
                        MESH_BOUNDS
                    };
                    let (material, pipeline) = if drawn.overrides() {
                        settings.drawn_batch_pipeline_of(batch)
                    } else {
                        (batch.material(), settings.batch_pipeline_of(batch))
                    };
                    key_of(pipeline, batch.mesh(), material, bounds, bits, None)
                }
                Drawn::Outlined | Drawn::Subsurface | Drawn::Tone => None,
            }
        };

        collect_bucket_keys(key_counts, scene, batches, scene_key, |_, batch| {
            batch_key(batch)
        });
        // A morphed object draws its base level: a level carries no morph targets. A skinned
        // object may pick one when every level of its set draws the base mesh's own vertices, which
        // the skin moves and the level then names from indices of its own.
        let levels = settings.levels();
        // A mesh whose bucket draws its tree of cluster patches draws no whole level: the patches
        // already cover it at the view's threshold. This holds only where the cluster pass runs,
        // which the direct path does not, and only for the one copy that the pass draws. The pass
        // copies triangles, whose 32-bit indices reach every vertex of the mesh's parts from the
        // first part's base vertex while the parts lie one after another in one page. A tree also
        // fits the storage binding that the pass's tables and each view's list take, beside the
        // trees before it, or it draws whole levels.
        let patches = settings.patches();
        // True when the patched tables are built again: the trees changed, or the keys that draw
        // them changed or moved.
        let mut rebuild_tables = true;
        // Each key that draws a tree, with the scene object that draws it.
        let mut treed_keys: Vec<(BucketKey, u32)> = Vec::new();
        // A caster draws its tree in each shadow view where the scene's layout draws the same
        // object's tree: the scene's tables hold its patches, which every view shares.
        let shared_trees = drawn == Drawn::Casters;
        if cluster_binding > 0 && (drawn == Drawn::Scene || shared_trees) {
            let (mut tree_patches, mut tree_indices) = (0u32, 0u32);
            for slot in 0..scene_rows as usize {
                let Some(key) = scene_key(slot) else {
                    continue;
                };
                if shared_trees {
                    let scene_tree = self
                        .scene_trees
                        .iter()
                        .any(|tree| tree.object == slot as u32);
                    let single = key_counts
                        .binary_search_by_key(&key, |&(key, _)| key)
                        .is_ok_and(|at| key_counts[at].1 == 1);
                    let lines = key.0.state & state_flags::LINE_LIST != 0;
                    let by_index = self.index_instances && key.0.reads_index();
                    if scene_tree && single && !lines && !by_index {
                        treed_keys.push((key, slot as u32));
                    }
                    continue;
                }
                let single = key_counts
                    .binary_search_by_key(&key, |&(key, _)| key)
                    .is_ok_and(|at| key_counts[at].1 == 1);
                let Some(tree) = patches.of(key.3).filter(|_| single) else {
                    continue;
                };
                let mesh = levels.mesh_of_key(key.3).unwrap_or(key.3);
                let Some(slot_mesh) = settings.meshes().mesh(mesh.wrapping_sub(1)) else {
                    continue;
                };
                let lines = key.0.state & state_flags::LINE_LIST != 0;
                let by_index = self.index_instances && key.0.reads_index();
                if lines || by_index || settings.meshes().joined_parts(slot_mesh).is_none() {
                    continue;
                }
                let more_patches = tree_patches.saturating_add(tree.len() as u32);
                let more_indices = tree_indices.saturating_add(tree.indices().len() as u32);
                let bytes = super::clusters::table_bytes(
                    more_patches,
                    treed_keys.len() as u32 + 1,
                    more_indices,
                );
                // The pass copies with a workgroup a patch, in one dispatch along one axis.
                if bytes.iter().any(|&bytes| bytes > cluster_binding)
                    || more_patches > null3d_gpu::caps::MAX_WORKGROUPS_PER_DIMENSION
                {
                    continue;
                }
                (tree_patches, tree_indices) = (more_patches, more_indices);
                treed_keys.push((key, slot as u32));
            }
            treed_keys.sort_unstable_by_key(|&(key, _)| key);
            treed_keys.dedup_by_key(|pair| pair.0);
            let generation = settings.patches().generation();
            let keys_hash = treed_keys_of(&treed_keys);
            rebuild_tables = !self.tables_built
                || self.tables_generation != generation
                || self.treed_keys_hash != keys_hash;
            self.tables_built = true;
            self.tables_generation = generation;
            self.treed_keys_hash = keys_hash;
        }
        let tree_object = |key: &BucketKey| {
            treed_keys
                .binary_search_by_key(key, |&(key, _)| key)
                .ok()
                .map(|at| treed_keys[at].1)
        };
        let treed = |key: &BucketKey| tree_object(key).is_some();
        let eligible = |key: &BucketKey| !treed(key) && levels.may_pick(key.3, key.0.permutation);
        // A level may name a material of its own, so its bucket key comes from the level's mesh and
        // material, while it keeps the fields of the bucket that names it: its bounds, and the
        // object's receive-shadows bit, which the base key's pipeline holds.
        let depth_stand_in = |key: &BucketKey| {
            key.4 == CASTER_MATERIAL
                && (key.0.template == template::SHADOW_DEPTH
                    || drawn == Drawn::Outlined
                    || drawn == Drawn::Tone
                    || (key.0.template == template::MOTION
                        && key.0.permutation & permutation::ALPHA_MASK == 0))
        };
        let level_bucket = |key: &BucketKey, level: usize| {
            let (base, _) = key_level(key.3);
            let set = levels.of(base)?;
            let mesh = set.mesh(level);
            // A depth bucket holds a stand-in in place of its material, since it draws with none, so
            // the stand-in names no pipeline. A level that names no material keeps the bucket's
            // depth pipeline and takes its own mesh's vertex format.
            if set.material(level) == 0 && depth_stand_in(key) {
                let vertex_format = meshes.mesh(mesh - 1)?.format;
                let page = meshes.parts(meshes.mesh(mesh - 1)?, false).first()?.page;
                let pipeline = DrawKey {
                    vertex_format,
                    ..key.0
                };
                return Some((pipeline, key.1, page, level_key(base, level), key.4, key.5));
            }
            let material = match set.material(level) {
                0 => key.4,
                own => own,
            };
            let object = if key.0.permutation & permutation::RECEIVE_SHADOWS != 0 {
                flags::RECEIVE_SHADOWS
            } else {
                0
            };
            // A batch's rows bring their own color and values to whichever level they draw.
            let row_values = key.0.permutation & permutation::ROW_VALUES != 0;
            let mut bucket = key_of(
                settings.rows_pipeline_of(mesh, material, row_values),
                mesh,
                material,
                key.5,
                object,
                None,
            )?;
            // The level draws the vertices that its base key's skin moves, so it keeps the
            // skin and morph bits that the scene gave that key.
            bucket.0.permutation |= key.0.permutation & (permutation::SKIN | permutation::MORPH);
            bucket.3 = level_key(base, level);
            Some(bucket)
        };
        let fades = drawn == Drawn::Scene && settings.levels_fade() && !self.index_instances;
        // The keys whose sources draw in a distance band, which need a fade bucket beside each of
        // their levels only while the quality settings fade those bands.
        let mut ranged_keys: Vec<BucketKey> = Vec::new();
        if fades {
            for slot in 0..scene_rows as usize {
                let [start, end] = scene
                    .draw_ranges()
                    .get(slot * 2..slot * 2 + 2)
                    .map_or([0.0, f32::INFINITY], |range| [range[0], range[1]]);
                if start > 0.0 || end.is_finite() {
                    ranged_keys.extend(scene_key(slot));
                }
            }
            for (_, batch) in batches.iter() {
                if !batch_ranges(batches, batch).is_none() {
                    ranged_keys.extend(batch_key(batch));
                }
            }
            ranged_keys.sort_unstable();
            ranged_keys.dedup();
        }
        let ranged = |key: &BucketKey| ranged_keys.binary_search(key).is_ok();
        expand_level_keys(
            key_counts,
            levels,
            fades,
            self.codes,
            ranged,
            eligible,
            &level_bucket,
        );
        self.depthless = key_counts
            .iter()
            .any(|&((pipeline, ..), _)| !pipeline.writes_depth());

        if key_counts.len() as u32 >= MAX_BUCKETS {
            return Err(RecordError::TooManySources { limit: MAX_BUCKETS });
        }
        self.waiting.clear();
        for slot in 0..scene_rows {
            if !skinning.hides(slot) {
                continue;
            }
            if let Some((pipeline, ..)) = any_key(slot as usize) {
                // The outlined layout's buckets draw with both pipelines of the outline mask.
                let (pipeline, second) = match drawn {
                    Drawn::Outlined => {
                        let (every, visible) = mask_keys(pipeline);
                        (
                            pipelines.id(every.in_pass(targets)),
                            pipelines.id(visible.in_pass(targets)),
                        )
                    }
                    Drawn::Casters => shadows.pipelines(pipelines, pipeline),
                    Drawn::Motion => (pipelines.id(pipeline.in_pass(targets)), 0),
                    Drawn::Scene => pipelines.opaque(pipeline, targets, prepass),
                    Drawn::Subsurface | Drawn::Tone => (pipelines.id(pipeline.in_pass(targets)), 0),
                };
                self.waiting
                    .extend([pipeline, second].into_iter().filter(|&id| id != 0));
            }
        }

        self.buckets.clear();
        self.bucket_levels.clear();
        self.draws.clear();
        self.skinned.clear();
        if shared_trees {
            self.clusters.clear();
            self.clusters
                .extend(self.scene_trees.iter().map(|&tree| ClusterMesh {
                    slot: NOT_DRAWN,
                    first_draw: NOT_DRAWN,
                    ..tree
                }));
        } else if rebuild_tables {
            self.clusters.clear();
            self.cluster_patches.clear();
            self.cluster_indices.clear();
        } else {
            // The tables hold the same trees in the same order, so keep them and the records that
            // name where each tree starts. The bucket loop writes each tree's copy and draw again.
            for tree in &mut self.clusters {
                tree.slot = NOT_DRAWN;
                tree.first_draw = NOT_DRAWN;
            }
        }
        self.parallax = false;
        self.material_views = 0;
        self.pick_views = 0;
        let (mut copied, mut indexed) = (0, 0);
        // The buckets whose mesh draws pieces in their place, each with its mesh and whether its
        // pipeline drops back faces.
        let mut pieced_buckets: Vec<(u32, u32, bool)> = Vec::new();
        for &(key, count) in key_counts.iter() {
            let (pipeline, group, _, mesh, material, bounds) = key;
            let bands = |key: &BucketKey| fades && ranged(key);
            let links = links_of(
                key,
                &*key_counts,
                levels,
                self.codes,
                bands,
                eligible,
                &level_bucket,
            );
            let mesh = levels
                .mesh_of_key(mesh)
                .expect("level keys name known levels");
            // The vertex shaders of a bucket of skinned objects find each copy's first joint in the
            // copy, which the culling pass takes from the copy's own source, so the bucket's
            // objects may share it. The SKIN builds never read their instances by index.
            let skins = pipeline.permutation & permutation::SKIN != 0;
            let parallax = pipeline.permutation & permutation::PARALLAX != 0;
            let by_index = self.index_instances && pipeline.reads_index();
            let pipeline = if by_index {
                pipeline.by_index()
            } else {
                pipeline
            };
            let slot = meshes.mesh(mesh - 1).expect("keys name known meshes");
            let parts = meshes.parts(slot, pipeline.state & state_flags::LINE_LIST != 0);
            // A mesh with a tree of cluster patches draws it in the camera's views, when one scene
            // object draws the bucket: the pass picks the patches of that object alone, and the
            // mesh draws them in one indirect draw of one instance. The keys that draw a tree were
            // chosen before the levels were added, and they already hold one object, one part and
            // a copy whose matrix the pass reads. A batch row draws whole levels instead, as a
            // browser that picks no patches does.
            let tree = if treed(&key) {
                settings.patches().of(mesh)
            } else {
                None
            };
            let slot_base = if by_index { indexed } else { copied };
            let first_draw = self.draws.len() as u32;
            let cluster = tree.and_then(|tree| {
                // The casters' record of the scene's tree names the caster's own copy and draw.
                if shared_trees {
                    let object = tree_object(&key)?;
                    let index = self
                        .clusters
                        .iter()
                        .position(|tree| tree.object == object)?;
                    let record = &mut self.clusters[index];
                    record.slot = slot_base;
                    record.first_draw = first_draw;
                    return Some(index as u32);
                }
                if !rebuild_tables {
                    // The kept table puts this tree's patches where they were; find its record and
                    // name this frame's copy and draw.
                    let index = self
                        .clusters
                        .iter()
                        .position(|record| record.mesh == mesh)?;
                    let record = &mut self.clusters[index];
                    record.slot = slot_base;
                    record.first_draw = first_draw;
                    record.object = tree_object(&key).unwrap_or(NOT_DRAWN);
                    return Some(index as u32);
                }
                let index = self.clusters.len() as u32;
                let first_patch = self.cluster_patches.len() as u32;
                self.clusters.push(ClusterMesh {
                    mesh,
                    object: tree_object(&key).unwrap_or(NOT_DRAWN),
                    first_patch,
                    patch_count: tree.len() as u32,
                    slot: slot_base,
                    first_draw,
                    base_vertex: parts[0].base_vertex,
                });
                // A patch's run and its parent follow the indices and the patches of the meshes
                // before it in the scene's tables.
                let first_index = self.cluster_indices.len() as u32;
                self.cluster_patches.extend(
                    (0..tree.len() as u32)
                        .map(|patch| tree.table_record(patch, first_patch, first_index)),
                );
                self.cluster_indices.extend_from_slice(tree.indices());
                Some(index)
            });
            // A displaced material moves vertices past its mesh's sphere, by up to its margin.
            let margin = settings.materials().bounds_margin(material.wrapping_sub(1));
            let (center, radius) = local_sphere(scene, bounds, slot.center, slot.radius + margin);
            let object = object_of(bounds);
            let skin = object.and_then(|object| skinning.object(object));
            if let (Some(object), Some(_)) = (object, skin) {
                self.skinned.push((self.buckets.len() as u32, object));
            }
            let regions = object.and_then(|object| skinning.parts_of(object));
            // A bucket moves by itself when its pipeline skins or morphs in the vertex shader, when
            // the skinning pass computes its vertices, or when a custom material's vertex offset
            // moves them. The object's own skin data is not the test: a skinned bucket may hold
            // objects that the skin table names by their batch's row instead, and a morphed
            // object's pipeline has no morph build where the skinning pass morphs it.
            let moves = drawn == Drawn::Motion
                && (pipeline.permutation & (permutation::SKIN | permutation::MORPH) != 0
                    || regions.is_some()
                    || (pipeline.template >= template::CUSTOM_FIRST
                        && pipeline.permutation & permutation::MOTION != 0));
            // A camera's view culls each piece of a mesh with pieces on its own, where the piece's
            // bounds hold: the vertices stay where the mesh puts them, unmoved by a skin, morph
            // targets, a displacement or a custom vertex offset, and each copy's matrix reaches the
            // culling shader. A draw of lines, a tree of cluster patches and a feature's own count
            // keep the whole list. The cone test also needs the pipeline to drop back faces.
            let piece_count = meshes.pieces(mesh - 1).len();
            let pieced = drawn == Drawn::Scene
                && (2..=crate::pieces::MAX_PIECES).contains(&piece_count)
                && tree.is_none()
                && !by_index
                && !skins
                && regions.is_none()
                && margin == 0.0
                && pipeline.state & state_flags::LINE_LIST == 0
                && pipeline.permutation & (permutation::SKIN | permutation::MORPH) == 0
                && !pipeline.places_own_vertices()
                && object.is_none_or(|slot| settings.feature_instances().id_of(slot).is_none());
            let culls_back =
                pipeline.state & (state_flags::CULL_NONE | state_flags::CULL_FRONT) == 0;
            if pieced {
                pieced_buckets.push((self.buckets.len() as u32, mesh, culls_back));
            }
            // A surface that writes no color holds back what lies behind it, so its draws come
            // before the surfaces that write color. Only the scene's own layout draws them.
            let holdout =
                drawn == Drawn::Scene && pipeline.state & state_flags::NO_COLOR_WRITE != 0;
            // The motion template's pipelines bind a map's group after the frame's, and a blank
            // one's where the pair has no map.
            let group =
                if drawn == Drawn::Motion && pipeline.template == template::MOTION && group == 0 {
                    ids::BLANK_MAP_GROUP
                } else {
                    group
                };
            // GPU picking draws this bucket with its own template, or with a custom material's
            // pick builds, which repeat the vertex offset. A pair without one has no pick build.
            let (pick, pick_maps) = match (picking, drawn) {
                (true, Drawn::Scene) => {
                    match crate::pick::key_of(pipeline, settings.sways(material), false) {
                        Some((key, maps)) => (pipelines.id(key.in_pass(pick_targets)), maps),
                        None => (0, false),
                    }
                }
                _ => (0, false),
            };
            let (occluder, occluder_own) = if self.occluder_pass {
                pipelines.occluder(pipeline, targets)
            } else {
                (0, false)
            };
            // The mask's second pipeline binds as the depth template does.
            let (pipeline, prepass, prepass_own) = match drawn {
                Drawn::Outlined => {
                    let (every, visible) = mask_keys(pipeline);
                    (
                        pipelines.id(every.in_pass(targets)),
                        pipelines.id(visible.in_pass(targets)),
                        false,
                    )
                }
                Drawn::Casters => {
                    let (cascades, tiles) = shadows.pipelines(pipelines, pipeline);
                    (cascades, tiles, false)
                }
                Drawn::Motion => (pipelines.id(pipeline.in_pass(targets)), 0, false),
                Drawn::Scene => {
                    let own = pipeline.places_own_vertices();
                    let (pipeline, prepass) = pipelines.opaque(pipeline, targets, prepass);
                    (pipeline, prepass, own)
                }
                Drawn::Subsurface | Drawn::Tone => {
                    (pipelines.id(pipeline.in_pass(targets)), 0, false)
                }
            };
            let base = if by_index { &mut indexed } else { &mut copied };
            self.parallax |= parallax;
            // The pass targets that this bucket's material samples, so a pass that draws the
            // bucket waits for the pass that writes them.
            let sampled = settings.textures().group_pass_views(group);
            self.material_views |= sampled;
            if pick_maps {
                self.pick_views |= sampled;
            }
            // A bucket draws its material's surface function in the camera's opaque or skin pass,
            // and only a custom material's own reads the copy of the scene's depth. The shadow,
            // outline, motion and pick builds drop it.
            let scene_depth = matches!(drawn, Drawn::Scene | Drawn::Subsurface)
                && settings.materials().reads_scene_depth(material - 1);
            // A feature-instance draw fills a bucket of its own from its own buffer, so its count
            // word comes from the page or the add-on's compute rather than from culling.
            let feature = object.and_then(|slot| settings.feature_instances().id_of(slot));
            let record = feature.and_then(|id| settings.feature_instances().record(id));
            self.buckets.push(Bucket {
                pipeline,
                prepass,
                prepass_own,
                // A feature-instance draw takes the count that its add-on gives, which the
                // culling never sees, so it hides nothing.
                occluder: if feature.is_some() { 0 } else { occluder },
                occluder_own,
                holdout,
                group,
                material,
                scene_depth,
                base: *base,
                capacity: count,
                first_draw,
                draws: if pieced { 0 } else { parts.len() as u32 },
                mesh_key: key.3,
                center,
                radius,
                skins,
                parallax,
                first_joint: if skins { sizes::PER_SOURCE_JOINT } else { 0 },
                indexed: by_index,
                moves,
                levels: links,
                level: key_level(key.3).1 as u32,
                pairs: is_fade_key(&key),
                pick,
                pick_maps,
                // A bucket of a scene object whose bias differs from the quality settings' holds
                // that object's bias; every other bucket takes the threshold as it is.
                bias: object.map_or(1.0, |slot| scene.level_biases()[slot as usize]),
                cluster,
                feature: feature.unwrap_or(0),
                feature_capacity: record.map_or(0, |(_, capacity, _)| capacity),
                feature_ready: feature.is_none_or(|id| settings.feature_instances().is_ready(id)),
                feature_slot: object.unwrap_or(u32::MAX),
                pieces: None,
                cone: None,
            });
            self.bucket_levels.push(key_level(key.3).1 as u32);
            *base += count;
            if pieced {
                continue;
            }
            self.draws.extend(parts.iter().enumerate().map(|(k, part)| {
                // A skinned part draws its region of skinned vertices, from its first vertex.
                let region = regions.and_then(|regions| regions.get(k));
                Draw {
                    page: part.page,
                    index_count: part.index_count,
                    first_index: part.first_index,
                    base_vertex: if region.is_some() {
                        0
                    } else {
                        part.base_vertex
                    },
                    vertices: region.map(SkinnedPart::vertices),
                }
            }));
        }
        copied = self.add_pieces(meshes, &pieced_buckets, copied);
        if self.buckets.len() as u32 >= MAX_BUCKETS {
            return Err(RecordError::TooManySources { limit: MAX_BUCKETS });
        }
        // The index slices follow the copies, so their bases count entries from the buffer's
        // start.
        for bucket in self.buckets.iter_mut().filter(|bucket| bucket.indexed) {
            bucket.base += copied * INDEX_ENTRIES_PER_COPY;
        }
        (self.copied, self.indexed) = (copied, indexed);
        self.slices_placed = false;

        let counts = &*key_counts;
        let bucket_of = |key: Option<BucketKey>| bucket_of(counts, key).unwrap_or(HIDDEN);
        let buckets = &self.buckets;
        let occludes = |bucket: u32| bucket_occludes(buckets, bucket);
        self.instance_buckets.clear();
        self.home_buckets.clear();
        let slots = world.radii().iter().zip(scene.cells()).zip(scene.flags());
        for (slot, ((&radius, &cell), &flags)) in slots.take(scene_rows as usize).enumerate() {
            let key = scene_key(slot);
            let home = bucket_of(key);
            if home != HIDDEN && key.is_some_and(|key| key.5 == SHARED_SKIN_BOUNDS) {
                self.skinned.push((home, slot as u32));
            }
            self.home_buckets.push(home);
            let gpu_count = settings.feature_instances().id_of(slot as u32).is_some();
            self.instance_buckets.push(scene_entry(
                home,
                radius,
                cell,
                flags,
                gpu_count,
                occludes(home),
            ));
        }
        self.skinned.sort_unstable();
        if self.owns_sources() {
            self.skin_firsts.clear();
            for (slot, joint_base) in skinning.vertex_skinned() {
                let slot = slot as usize;
                if slot >= self.skin_firsts.len() {
                    self.skin_firsts.resize(slot + 1, 0);
                }
                self.skin_firsts[slot] = joint_base;
            }
        }
        self.occluders = occluders_in(&self.instance_buckets);
        self.source_layers.clear();
        self.source_ranges.clear();
        self.has_ranges = scene.draw_ranges().chunks(2).any(|range| {
            range.first().is_some_and(|&start| start > 0.0)
                || range.get(1).is_some_and(|&end| end.is_finite())
        }) || batches
            .iter()
            .any(|(_, batch)| !batch_ranges(batches, batch).is_none());
        if self.owns_sources() {
            self.source_layers
                .extend_from_slice(&scene.layers()[..scene_rows as usize]);
            for range in scene.draw_ranges()[..scene_rows as usize * 2]
                .as_chunks::<2>()
                .0
            {
                push_range(&mut self.source_ranges, range[0], range[1], 0.0);
            }
        }
        self.scene_layers_default = scene.common_layers().is_some();
        self.batch_rows.clear();
        for (id, batch) in batches.iter() {
            let bucket = bucket_of(batch_key(batch));
            let (active, layers) = (batch.frame_active_count(parity), batch.layers());
            let rows_occlude = self.bucket_occludes(bucket);
            self.batch_rows.push(BatchRows {
                id: id.raw(),
                bucket,
                active,
                layers,
            });
            if rows_occlude && !batch.not_occluder() {
                self.occluders += 1;
            }
            self.instance_buckets.extend(
                (0..batch.capacity())
                    .map(|row| row_entry(bucket, batch, row, active, rows_occlude)),
            );
            if self.owns_sources() {
                let rows = self.source_layers.len() + batch.capacity() as usize;
                self.source_layers.resize(rows, layers);
                // A batch's rows may move away from their origins in its vertex shader, so each
                // carries the batch's own radius, which the culling shader tests around the row.
                let radius = batch.local_radius();
                match batch_ranges(batches, batch) {
                    RowRanges::One(range) => {
                        for _ in 0..batch.capacity() {
                            push_range(&mut self.source_ranges, range.start, range.end, radius);
                        }
                    }
                    RowRanges::Rows(values) => {
                        let ranges = RowRanges::Rows(values);
                        for row in 0..batch.capacity() as usize {
                            let range = ranges.range(row);
                            push_range(&mut self.source_ranges, range.start, range.end, radius);
                        }
                    }
                }
            }
        }

        self.scene_rows = self.home_buckets.len() as u32;
        // The CPU culling reads each source's bucket without the bits that the culling shader
        // packs beside it.
        self.cull_buckets.clear();
        self.cull_buckets
            .extend(self.instance_buckets.iter().copied().map(cull_entry));
        self.level_links.clear();
        self.level_links
            .extend(self.buckets.iter().map(|bucket| LevelLink {
                value: bucket.levels.value,
                switch: bucket.levels.switch,
                next: bucket.levels.next.unwrap_or(NO_LINK),
                fade: bucket.levels.fade.unwrap_or(NO_LINK),
            }));
        // The buckets that take a level's copies: the buckets of the sets and their fade buckets,
        // whose slices the frame sizes to the copies it draws.
        self.marks.clear();
        self.marks.resize(self.buckets.len(), 0);
        for (bucket, link) in self.level_links.iter().enumerate() {
            for target in [link.next, link.fade] {
                if target != NO_LINK {
                    self.marks[bucket] = COUNTED;
                    self.marks[target as usize] = COUNTED;
                }
            }
        }
        // A piece's slice holds the copies that pick its bucket's level, so it takes the same
        // count and moves with the level's slices.
        for bucket in 0..self.buckets.len() {
            if let (Some((first, count)), true) =
                (self.buckets[bucket].pieces, self.marks[bucket] != 0)
            {
                self.marks[first as usize..(first + count) as usize].fill(COUNTED);
            }
        }
        self.fix_small_sets();
        self.level_buckets.clear();
        self.level_buckets.extend(
            (0..self.buckets.len() as u32).filter(|&bucket| self.marks[bucket as usize] != 0),
        );
        self.note_level_sources();
        // A new layout draws every bucket until its counts say that a level holds no copy.
        self.idle.clear();
        self.idle.resize(self.buckets.len(), false);
        self.idle_frames.clear();
        self.idle_frames.resize(self.buckets.len(), 0);
        let fades = self.level_links.iter().any(LevelLink::has_next);
        self.cull_rows = if fades || self.has_ranges || self.codes {
            self.sources.saturating_mul(4)
        } else {
            self.sources
        };

        self.fit_skinned(scene);
        self.indirect_template.clear();
        for draw in &self.draws {
            self.indirect_template.extend_from_slice(&[
                draw.index_count,
                0,
                draw.first_index,
                draw.base_vertex,
                0,
            ]);
        }
        self.bucket_records.clear();
        for bucket in &self.buckets {
            // A piece's bucket holds its cone where a level's holds its switch and links.
            let (value, next, fade, bias, switch) = match bucket.cone {
                Some([x, y, z, cutoff]) => (x, y.to_bits(), z.to_bits(), cutoff, 0),
                None => (
                    bucket.levels.value,
                    bucket.levels.next.map_or(0, |bucket| bucket + 1),
                    bucket.levels.fade.map_or(0, |bucket| bucket + 1),
                    bucket.bias,
                    bucket.levels.switch as u32,
                ),
            };
            self.bucket_records.extend_from_slice(&[
                bucket.base,
                bucket.material - 1,
                bucket.radius.to_bits(),
                bucket.first_draw,
                bucket.draws,
                bucket.center[0].to_bits(),
                bucket.center[1].to_bits(),
                bucket.center[2].to_bits(),
                bucket.first_joint,
                // The motion layout's buckets never read by index: the word marks those whose
                // instances move by themselves. A bucket that draws pieces in its place names them
                // here, under the bit that marks it.
                bucket.pieces.map_or(
                    u32::from(bucket.indexed || bucket.moves),
                    |(first, count)| PIECED | first | count << PIECE_COUNT_SHIFT,
                ),
                // The culling shader reads a bucket as its index plus one, and 0 as none.
                value.to_bits(),
                next,
                fade,
                bias.to_bits(),
                switch,
                // The level that the bucket draws, which the levels debug view writes beside each
                // copy in place of the fade value.
                bucket.level,
                bucket.capacity,
            ]);
        }
        self.records_dirty = Some(0..self.buckets.len() as u32);
        self.built = true;
        Ok(())
    }

    /// The buckets in the order that a pass draws them: each bucket with pieces gives way to its
    /// pieces' buckets.
    pub(super) fn drawn_buckets(&self) -> impl Iterator<Item = usize> + '_ {
        // A layout that no rebuild has ordered draws its buckets in their own order.
        let ordered = !self.draw_order.is_empty() || self.buckets.is_empty();
        let order = self.draw_order.iter().map(|&b| b as usize);
        let own = (0..self.buckets.len()).filter(move |_| !ordered);
        order.chain(own)
    }

    /// Adds the buckets of the pieces of each bucket in `pieced`, with its mesh and whether its
    /// pipeline drops back faces, after every other bucket, with their draws after every other
    /// draw, and gives each bucket's place in the draw order. Each piece's bucket copies its
    /// bucket's pipeline and material, takes the piece's sphere and cone, a slice of the bucket's
    /// size after the `copied` copies before it, and a draw for each range of the mesh's parts that
    /// the piece covers. Returns the copies with the pieces' slices.
    fn add_pieces(
        &mut self,
        meshes: &MeshStorage,
        pieced: &[(u32, u32, bool)],
        mut copied: u32,
    ) -> u32 {
        self.piece_parents.clear();
        self.first_piece_draw = self.draws.len() as u32;
        for &(parent, mesh, culls_back) in pieced {
            let whole = self.buckets[parent as usize];
            let pieces = meshes.pieces(mesh - 1);
            let first = self.buckets.len() as u32;
            for piece in pieces {
                let [x, y, z, radius] = piece.sphere;
                let [ax, ay, az, cutoff] = piece.cone;
                self.buckets.push(Bucket {
                    base: copied,
                    first_draw: self.draws.len() as u32,
                    draws: 0,
                    center: [x, y, z],
                    radius,
                    // A material that draws back faces shows the piece from either side.
                    cone: Some([ax, ay, az, if culls_back { cutoff } else { 1.0 }]),
                    pieces: None,
                    levels: KeyLinks::default(),
                    ..whole
                });
                self.bucket_levels.push(whole.level);
                copied += whole.capacity;
            }
            crate::pieces::piece_parts(meshes.piece_parts(mesh - 1), pieces, |k, part| {
                let bucket = &mut self.buckets[(first + k) as usize];
                if bucket.draws == 0 {
                    bucket.first_draw = self.draws.len() as u32;
                }
                bucket.draws += 1;
                self.draws.push(Draw {
                    page: part.page,
                    index_count: part.index_count,
                    first_index: part.first_index,
                    base_vertex: part.base_vertex,
                    vertices: None,
                });
            });
            // The bucket draws no copy of its own. Its draw is a tally that no pass draws: the
            // culling counts each copy that waits for its pieces' tests in its instance count, for
            // the check of what pieces cull.
            let page = self.draws.last().map_or(0, |draw| draw.page);
            let tally = &mut self.buckets[parent as usize];
            tally.pieces = Some((first, pieces.len() as u32));
            tally.first_draw = self.draws.len() as u32;
            self.draws.push(Draw {
                page,
                index_count: 0,
                first_index: 0,
                base_vertex: 0,
                vertices: None,
            });
            self.piece_parents.push((parent, mesh - 1));
        }
        self.draw_order.clear();
        for (b, bucket) in self.buckets.iter().enumerate() {
            match (bucket.pieces, bucket.cone) {
                (Some((first, count)), _) => self.draw_order.extend(first..first + count),
                (None, None) => self.draw_order.push(b as u32),
                (None, Some(_)) => {}
            }
        }
        copied
    }

    /// The triangles that each mesh with pieces would draw whole in a view, and those that its
    /// pieces drew: `instances` gives the copies that a bucket's draws took, and `waiting` the
    /// copies that waited for a pieced bucket's tests. Gives each mesh to `out`.
    pub(super) fn piece_counts(
        &self,
        instances: impl Fn(u32) -> u32,
        waiting: impl Fn(u32) -> u32,
        mut out: impl FnMut(u32, u64, u64),
    ) {
        for &(parent, mesh) in &self.piece_parents {
            let Some((first, count)) = self.buckets[parent as usize].pieces else {
                continue;
            };
            let (mut whole, mut drawn) = (0u64, 0u64);
            for piece in first..first + count {
                let bucket = &self.buckets[piece as usize];
                let draws = &self.draws
                    [bucket.first_draw as usize..(bucket.first_draw + bucket.draws) as usize];
                let triangles: u64 = draws.iter().map(|d| u64::from(d.index_count / 3)).sum();
                whole += triangles;
                drawn += u64::from(instances(piece)) * triangles;
            }
            out(mesh, u64::from(waiting(parent)) * whole, drawn);
        }
    }

    /// Sets each feature-instance draw's count in the template that a frame's reset uploads, for
    /// the views that the frame's count copy does not reach: the camera's mirrors and probes, and
    /// the outline, skin and motion views. The camera's own view and every shadow view take the
    /// add-on's count word instead. The culling shader never visits these buckets, so it keeps the
    /// count as it is. `radii` holds each scene slot's world radius: a hidden object draws
    /// nothing, as its draw would in any other bucket, so its count is 0.
    pub(super) fn set_feature_counts(
        &mut self,
        features: &crate::feature_instances::FeatureInstanceTable,
        radii: &[f32],
    ) {
        for bucket in self.buckets.iter().filter(|bucket| bucket.feature != 0) {
            let count = Self::feature_count(features, radii, bucket);
            for index in bucket.first_draw..bucket.first_draw + bucket.draws {
                self.indirect_template[(index * sizes::INDIRECT_WORDS + 1) as usize] = count;
            }
        }
    }

    /// The count that a bucket's feature-instance draw draws: the page's count, or 0 while the
    /// object that places it is hidden.
    pub(super) fn feature_count(
        features: &crate::feature_instances::FeatureInstanceTable,
        radii: &[f32],
        bucket: &Bucket,
    ) -> u32 {
        if feature_hidden(radii, bucket) {
            return 0;
        }
        features
            .record(bucket.feature)
            .map_or(0, |(_, _, count)| count)
    }

    /// Gives each bucket of skinned objects the sphere that holds its objects' spheres, which the
    /// animation step moves: an object's own in a bucket of its own, and in a bucket that several
    /// share, the sphere around their centres' mean that reaches past each one's.
    fn fit_skinned(&mut self, scene: &SceneStorage) {
        for objects in self.skinned.chunk_by(|a, b| a.0 == b.0) {
            let sphere =
                |&(_, slot): &(u32, u32)| local_sphere(scene, OWN_BOUNDS + slot, [0.0; 3], 0.0);
            let (center, radius) = match objects {
                [object] => sphere(object),
                _ => {
                    let share = 1.0 / objects.len() as f32;
                    let mut mean = [0.0f32; 3];
                    for (center, _) in objects.iter().map(sphere) {
                        for (m, c) in mean.iter_mut().zip(center) {
                            *m += c * share;
                        }
                    }
                    let reach = |(center, radius): ([f32; 3], f32)| {
                        let d = [
                            center[0] - mean[0],
                            center[1] - mean[1],
                            center[2] - mean[2],
                        ];
                        (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() + radius
                    };
                    (
                        mean,
                        objects.iter().map(sphere).map(reach).fold(0.0, f32::max),
                    )
                }
            };
            let bucket = &mut self.buckets[objects[0].0 as usize];
            (bucket.center, bucket.radius) = (center, radius);
        }
    }

    /// Moves the bounds of the skinned objects' buckets, which the animation step moved, and marks
    /// the records from the first such bucket to the last for the frame's one table upload.
    pub(super) fn update_skinned(&mut self, scene: &SceneStorage) -> Result<(), RecordError> {
        let (Some(&(first, _)), Some(&(last, _))) = (self.skinned.first(), self.skinned.last())
        else {
            return Ok(());
        };
        self.fit_skinned(scene);
        for objects in self.skinned.chunk_by(|a, b| a.0 == b.0) {
            let bucket = objects[0].0;
            let Bucket { center, radius, .. } = self.buckets[bucket as usize];
            let record = &mut self.bucket_records[(bucket * BUCKET_WORDS) as usize..];
            record[2] = radius.to_bits();
            record[5..8].copy_from_slice(&center.map(f32::to_bits));
        }
        self.mark_records(first..last + 1);
        Ok(())
    }

    /// Sizes the shared buffers for the layout, at most `binding_bytes` each, and uploads its
    /// tables. Returns true when it made a buffer again, which the views' culling groups bind.
    pub(super) fn apply(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        binding_bytes: u32,
    ) -> Result<bool, RecordError> {
        let (entries, records) = self.table_ids();
        let owned = self.owned(self.sources);
        let needed = [
            (ids::MATRICES, owned * MATRIX_BYTES),
            (entries, self.sources * 4),
            (ids::SOURCE_LAYERS, owned * 4),
            (records, (self.buckets.len() as u32).max(1) * BUCKET_BYTES),
            (ids::ORDER, owned * 4),
        ];
        let mut recreated = false;
        for ((id, size), made) in needed.into_iter().zip(&mut self.buffer_sizes) {
            if size > 0 && *made < size {
                *made = grown_size(size, binding_bytes).ok_or(RecordError::BufferFull {
                    bytes: binding_bytes,
                })?;
                // The motion pass copies the matrices into its last frame's copies.
                let flags = if id == ids::MATRICES {
                    usage::STORAGE | usage::COPY_DST | usage::COPY_SRC
                } else {
                    usage::STORAGE | usage::COPY_DST
                };
                list.push(Op::CreateBuffer, &[id, *made, flags])?;
                recreated = true;
                self.order_uploaded &= id != ids::ORDER;
            }
        }
        let everything = 0..self.sources;
        write_rows(
            list,
            arena,
            entries,
            &self.instance_buckets,
            everything.clone(),
        )?;
        if self.owns_sources() {
            write_rows(
                list,
                arena,
                ids::SOURCE_LAYERS,
                &self.source_layers,
                everything,
            )?;
        }
        if self.owns_sources() {
            recreated |= self.upload_skin_firsts(list, arena)?;
            recreated |= self.upload_ranges(list, arena)?;
        }
        Ok(recreated)
    }

    /// Marks the records of buckets `range` to upload again this frame.
    pub(super) fn mark_records(&mut self, range: Range<u32>) {
        self.records_dirty = Some(match self.records_dirty.take() {
            Some(dirty) => dirty.start.min(range.start)..dirty.end.max(range.end),
            None => range,
        });
    }

    /// Uploads the bucket records that changed this frame, in one write, or nothing when none did.
    /// A rebuild marks every bucket, so the table goes up whole, and a frame's other changes ride
    /// in the same write: two writes to the table in one frame would leave whichever the device
    /// routed last, and a direct write lands before a staged copy whatever their order in the list.
    pub(super) fn upload_records(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let Some(range) = self.records_dirty.take() else {
            return Ok(());
        };
        if range.is_empty() || self.bucket_records.is_empty() {
            return Ok(());
        }
        let words = &self.bucket_records[range.start as usize * BUCKET_WORDS as usize
            ..range.end as usize * BUCKET_WORDS as usize];
        let (at, bytes) = arena.push(words_as_bytes(words))?;
        let (_, records) = self.table_ids();
        list.push(
            Op::WriteBuffer,
            &[records, range.start * BUCKET_BYTES, at, bytes],
        )?;
        Ok(())
    }

    /// Makes the distance ranges texture big enough for the sources, with room to grow, and at
    /// least one texel, which the culling groups bind while no source has a range, then uploads
    /// each source's range. Returns true when it made the texture again.
    fn upload_ranges(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<bool, RecordError> {
        let count = (self.source_ranges.len() / RANGE_FLOATS) as u32;
        let needed = count.div_ceil(sizes::RANGES_PER_TEXTURE_ROW);
        let limit = BUDGET[Limit::TextureDimension2D as usize];
        let texture = DataTexture::ranges(ids::INSTANCE_RANGES, 1);
        let made = texture.grow(list, &mut self.ranges_rows, needed, limit)?;
        if count > 0 {
            let (at, _) = arena.push(floats_as_bytes(&self.source_ranges))?;
            let rows = TextureRows {
                first: 0,
                count,
                column: 0,
                per_row: sizes::RANGES_PER_TEXTURE_ROW,
                texels: sizes::RANGE_TEXELS,
                bytes: 16,
            };
            data_texture::write_rows(list, ids::INSTANCE_RANGES, rows, at)?;
        }
        Ok(made)
    }

    /// Makes the skin firsts texture big enough for the first joints, with room to grow, and at
    /// least one texel row, which the culling groups bind while no object needs it, then uploads
    /// the first joints. Returns true when it made the texture again.
    fn upload_skin_firsts(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<bool, RecordError> {
        let count = self.skin_firsts.len() as u32;
        let needed = count.div_ceil(sizes::INDICES_PER_TEXTURE_ROW);
        let limit = BUDGET[Limit::TextureDimension2D as usize];
        let texture = DataTexture::indices(ids::SKIN_FIRSTS, 1);
        let made = texture.grow(list, &mut self.skin_firsts_rows, needed, limit)?;
        if count > 0 {
            let (at, _) = arena.push(words_as_bytes(&self.skin_firsts))?;
            let rows = TextureRows::indices(0, count);
            data_texture::write_rows(list, ids::SKIN_FIRSTS, rows, at)?;
        }
        Ok(made)
    }

    /// Rewrites the table entries of the sources whose membership, cell or layers changed since
    /// the layout was built, without a rebuild: scene objects shown, hidden, moved to another cell
    /// or given new layers this frame, which the frame's uploads name, the batch rows that a new
    /// active count added or removed, the batch rows that changed cells, and the rows of batches
    /// with new layers.
    pub(super) fn update_membership(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        input: &FrameInput<'_>,
        features: &crate::feature_instances::FeatureInstanceTable,
        parity: usize,
    ) -> Result<(), RecordError> {
        let scene = input.scene;
        let (radii, cells, layers) = (scene.world(parity).radii(), scene.cells(), scene.layers());
        let object_flags = scene.flags();
        let scene_rows = self.home_buckets.len() as u32;
        let (entries, _) = self.table_ids();
        let owns_sources = self.owns_sources();
        // While no object has a mask of its own, and none had one when the table was last
        // written, every slot's mask is the default one the table holds.
        let all_default = scene.common_layers().is_some();
        let check_layers = owns_sources && !(all_default && self.scene_layers_default);
        self.scene_layers_default = all_default;
        let home_buckets = &self.home_buckets;
        let buckets = &self.buckets;
        let occludes = |bucket: u32| bucket_occludes(buckets, bucket);
        let (instance_buckets, source_layers, occluders, cull_buckets) = (
            &mut self.instance_buckets,
            &mut self.source_layers,
            &mut self.occluders,
            &mut self.cull_buckets,
        );
        let mut check = |start: u32, count: u32| -> Result<(), RecordError> {
            let slots = start..(start + count).min(scene_rows);
            let entry = |s: usize| {
                let counted = features.id_of(s as u32).is_some();
                scene_entry(
                    home_buckets[s],
                    radii[s],
                    cells[s],
                    object_flags[s],
                    counted,
                    occludes(home_buckets[s]),
                )
            };
            let range = slots.start as usize..slots.end as usize;
            let before = occluders_in(&instance_buckets[range.clone()]);
            if let Some(rows) = sync_rows(instance_buckets, slots.clone(), entry) {
                *occluders = *occluders - before + occluders_in(&instance_buckets[range]);
                write_rows(list, arena, entries, instance_buckets, rows.clone())?;
                sync_cull(cull_buckets, instance_buckets, rows);
            }
            if check_layers && let Some(rows) = sync_rows(source_layers, slots, |s| layers[s]) {
                write_rows(list, arena, ids::SOURCE_LAYERS, source_layers, rows)?;
            }
            Ok(())
        };
        if input.snapshot.overflowed() {
            check(0, scene_rows)?;
        } else {
            for range in input.snapshot.uploads() {
                if range.target == SCENE_TARGET {
                    check(range.start, range.count)?;
                }
            }
        }
        for (index, (_, batch)) in input.batches.iter().enumerate() {
            let BatchRows {
                bucket,
                active: was,
                layers: had,
                ..
            } = self.batch_rows[index];
            let base = self.batch_bases[index].1;
            let mask = batch.layers();
            if owns_sources && mask != had {
                // Every row holds the batch's mask, so rows that become active later need none.
                let rows = base..base + batch.capacity();
                self.source_layers[rows.start as usize..rows.end as usize].fill(mask);
                write_rows(list, arena, ids::SOURCE_LAYERS, &self.source_layers, rows)?;
                self.batch_rows[index].layers = mask;
            }
            let now = batch.frame_active_count(parity);
            let moved = batch.cell_changes();
            let mut rows = (now != was).then(|| (was.min(now), was.max(now)));
            if moved.count > 0 {
                let (start, end) = (moved.start, moved.start + moved.count);
                rows =
                    Some(rows.map_or((start, end), |(low, high)| (low.min(start), high.max(end))));
            }
            let Some((low, high)) = rows else {
                continue;
            };
            let rows_occlude = self.bucket_occludes(bucket);
            for row in low..high {
                self.instance_buckets[(base + row) as usize] =
                    row_entry(bucket, batch, row, now, rows_occlude);
            }
            self.batch_rows[index].active = now;
            let rows = base + low..base + high;
            write_rows(list, arena, entries, &self.instance_buckets, rows.clone())?;
            sync_cull(&mut self.cull_buckets, &self.instance_buckets, rows);
        }
        Ok(())
    }

    /// Uploads the changed row values of the batches that have them straight from the core's world
    /// buffers of this parity, into the row values texture at each row's source, or every active
    /// row's after the layout or the texture changed.
    pub(super) fn upload_row_values(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        parity: usize,
        everything: bool,
    ) -> Result<(), RecordError> {
        if self.value_sources == 0 {
            return Ok(());
        }
        let mut upload = |base: u32, batch: &InstanceBatch, start: u32, count: u32| {
            let values = batch.world(parity).row_values();
            write_row_values(list, ids::ROW_VALUES, base, values, start, count)
        };
        let batches = input.batches.iter().zip(&self.batch_bases);
        if everything || input.snapshot.overflowed() {
            for ((_, batch), &(_, base)) in batches.filter(|((_, b), _)| b.has_row_values()) {
                upload(base, batch, 0, batch.frame_active_count(parity))?;
            }
            return Ok(());
        }
        for range in input.snapshot.uploads() {
            let Ok(batch) = input.batches.get(Handle::from_raw(range.target)) else {
                continue;
            };
            if let (true, Some(base)) = (batch.has_row_values(), self.base_of(range.target)) {
                upload(base, batch, range.start, range.count)?;
            }
        }
        Ok(())
    }

    /// Uploads the table of object ranges after the layout built it again.
    pub(super) fn upload_object_ranges(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        if !std::mem::take(&mut self.ranges_pending) {
            return Ok(());
        }
        let (at, bytes) = arena.push(self.object_ranges.bytes())?;
        list.push(Op::WriteBuffer, &[ids::OBJECT_RANGES, 0, at, bytes])?;
        Ok(())
    }

    /// Uploads changed world matrices straight from the core's world buffers of this parity, or
    /// every matrix after the layout changed. While the motion pass draws, `changed` takes the
    /// byte ranges of the matrix buffer that the frame writes.
    pub(super) fn upload_matrices(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        parity: usize,
        everything: bool,
        mut changed: Option<&mut ChangedRanges>,
    ) -> Result<(), RecordError> {
        if (everything || input.snapshot.overflowed())
            && let Some(changed) = changed.as_deref_mut()
        {
            changed.add_everything();
        }
        let mut upload = |base: u32, matrices: &[f32], start: u32, count: u32| {
            let floats =
                &matrices[start as usize * MATRIX_FLOATS..(start + count) as usize * MATRIX_FLOATS];
            if let Some(changed) = changed.as_deref_mut() {
                changed.add((base + start) * MATRIX_BYTES, count * MATRIX_BYTES);
            }
            list.push(
                Op::WriteBuffer,
                &[
                    ids::MATRICES,
                    (base + start) * MATRIX_BYTES,
                    address(floats_as_bytes(floats)),
                    count * MATRIX_BYTES,
                ],
            )
        };
        if everything || input.snapshot.overflowed() {
            // Slots past the highest one ever used, and rows past a batch's active count, draw
            // nothing; they upload when they change.
            let scene = input.scene.world(parity).matrices();
            upload(0, scene, 0, input.scene.slots().high_water())?;
            for ((_, batch), &(_, base)) in input.batches.iter().zip(&self.batch_bases) {
                let active = batch.frame_active_count(parity);
                upload(base, batch.world(parity).matrices(), 0, active)?;
            }
            return Ok(());
        }
        // Scene rows that changed close together upload in one write, as a span that grows until
        // the next run lies too far from it.
        let scene = input.scene.world(parity).matrices();
        let mut span: Option<(u32, u32)> = None;
        for range in input.snapshot.uploads() {
            let Some(base) = self.base_of(range.target) else {
                continue;
            };
            if range.target == SCENE_TARGET {
                let Some((start, count)) = drawn_rows(&self.home_buckets, range.start, range.count)
                else {
                    continue;
                };
                span = match span.and_then(|span| joined_rows(span, start, count)) {
                    Some(joined) => Some(joined),
                    None => {
                        if let Some((first, rows)) = span {
                            upload(0, scene, first, rows)?;
                        }
                        Some((start, count))
                    }
                };
                continue;
            }
            let Ok(batch) = input.batches.get(Handle::from_raw(range.target)) else {
                continue;
            };
            upload(
                base,
                batch.world(parity).matrices(),
                range.start,
                range.count,
            )?;
        }
        if let Some((first, rows)) = span {
            upload(0, scene, first, rows)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use null3d_core::jobs::JobSystem;
    use null3d_core::scene::Command;
    use null3d_gpu::drawlist::format;

    use super::*;
    use crate::geometry::box_geometry;
    use crate::gpu_driven::{RendererConfig, scene_settings};
    use crate::materials::Shading;

    /// The texels of the ranges texture that a frame uploads, as the culling shader reads them.
    fn uploaded_ranges(layout: &mut Layout) -> Vec<[f32; 4]> {
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        arena.begin_frame().unwrap();
        layout.apply(&mut list, &mut arena, u32::MAX).unwrap();
        let base = arena.bytes().as_ptr() as usize;
        let op = null3d_gpu::drawlist::decode(list.words())
            .map(|command| command.unwrap())
            .find(|command| {
                command.op == Op::WriteTexture
                    && command.operands.first() == Some(&ids::INSTANCE_RANGES)
            })
            .map(|command| command.operands.to_vec())
            .expect("the frame writes the ranges texture");
        let (at, bytes) = (op[8] as usize, op[9] as usize);
        // The list records the upload's address as the low word of the arena's pointer, as WebAssembly
        // holds pointers in one word; a native test reads the offset back the same way.
        let start = (at as u32).wrapping_sub(base as u32) as usize;
        let block = arena.bytes().len() - start;
        assert!(
            bytes <= block,
            "the write takes {bytes} bytes from a block of {block}"
        );
        arena.bytes()[start..start + bytes]
            .as_chunks::<16>()
            .0
            .iter()
            .map(|texel| {
                let mut row = [0.0f32; 4];
                for (word, bytes) in row.iter_mut().zip(texel.as_chunks::<4>().0) {
                    *word = f32::from_le_bytes(*bytes);
                }
                row
            })
            .collect()
    }

    /// The culling shader reads each source's range from the start of one texel of the ranges
    /// texture. This gives three objects different ranges, records the frame's upload and reads
    /// what the shader would see for each source.
    #[test]
    fn each_sources_range_reaches_its_own_texel_of_the_ranges_texture() {
        let mut settings = scene_settings(&RendererConfig::default());
        let box_mesh = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let mesh = settings.meshes_mut().add(&box_mesh).unwrap() + 1;
        let material = settings
            .materials_mut()
            .create(Shading::Lit, 0, [1.0; 4])
            .unwrap()
            + 1;
        let mut scene = SceneStorage::with_capacity(8);
        let mut commands = Vec::new();
        let ranges = [(0.0f32, 10.0f32), (12.0, 30.0), (40.0, 50.0)];
        let mut slots = Vec::new();
        for &(start, end) in &ranges {
            let object = scene.reserve().unwrap();
            commands.push(Command::create(object, Handle::NONE, mesh, flags::VISIBLE));
            commands.push(Command::set_material(object, material));
            commands.push(Command::set_draw_range(object, start, end));
            slots.push(scene.resolve(object).unwrap() as usize);
        }
        scene.apply_commands(&commands, 1).unwrap();
        scene.update_transforms(&JobSystem::new(0));

        let mut layout = Layout::default();
        let batches = BatchTable::with_capacity(1);
        let mut pipelines = PipelineCache::default();
        let targets = PassTargets {
            color_format: format::CANVAS,
            depth_format: format::DEPTH32_FLOAT,
            samples: 4,
            permutation: 0,
        };
        layout
            .rebuild(
                &settings,
                &mut pipelines,
                targets,
                &scene,
                &batches,
                scene.parity(),
                u32::MAX,
                CasterPasses::default(),
                Prepass::Off,
                &Skinning::default(),
                &mut KeyCounts::new(),
                targets,
                false,
                0,
            )
            .unwrap();

        // Each object reads its own range from the texel of its source.
        let texels = uploaded_ranges(&mut layout);
        for ((start, end), slot) in ranges.iter().zip(slots) {
            let texel = texels.get(slot).expect("the frame uploads every source");
            assert_eq!(
                [texel[0], texel[1]],
                [*start, *end],
                "source {slot} reads {texel:?}"
            );
        }
    }

    /// The culling shader reads each source's range and own radius from one texel of the ranges
    /// texture, so the data must give every source a whole texel: its start and end, its own local
    /// radius, then the word that nothing reads. Data of fewer words per source lands every second
    /// source's range in the wrong texel and reads past the block.
    #[test]
    fn every_sources_range_fills_a_whole_texel_of_the_ranges_texture() {
        let mut ranges = Vec::new();
        push_range(&mut ranges, 12.0, 30.0, 0.0);
        push_range(&mut ranges, 0.0, f32::INFINITY, 2600.0);
        assert_eq!(ranges.len(), 2 * RANGE_FLOATS);
        assert_eq!(ranges.len() * 4, 2 * 16);
        assert_eq!(
            ranges,
            [12.0, 30.0, 0.0, 0.0, 0.0, f32::INFINITY, 2600.0, 0.0]
        );
    }

    /// A batch may carry its rows far from their origins in its vertex shader, so the shader must
    /// cull them by the batch's own radius around each row, not by the sphere of the mesh that they
    /// draw. The ranges texture's third word carries it for every row of the batch, where a scene
    /// object keeps 0 and its bucket's sphere.
    #[test]
    fn a_batch_row_carries_its_own_local_radius_to_the_culling_shader() {
        let mut settings = scene_settings(&RendererConfig {
            max_materials: 4,
            ..RendererConfig::default()
        });
        let mesh = settings
            .meshes_mut()
            .add(&box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap())
            .unwrap()
            + 1;
        let material = settings
            .materials_mut()
            .create(Shading::Lit, 0, [1.0; 4])
            .unwrap()
            + 1;
        let mut scene = SceneStorage::with_capacity(8);
        scene.apply_commands(&[], 1).unwrap();
        scene.update_transforms(&JobSystem::new(0));
        let object = scene.reserve().unwrap();
        scene
            .apply_commands(
                &[
                    Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
                    Command::set_material(object, material),
                ],
                1,
            )
            .unwrap();
        scene.update_transforms(&JobSystem::new(0));
        let mut batches = BatchTable::with_capacity(1);
        batches
            .create(4, false, false, mesh, material, 2600.0)
            .unwrap();
        let mut layout = Layout::default();
        let mut pipelines = PipelineCache::default();
        let targets = PassTargets {
            color_format: format::CANVAS,
            depth_format: format::DEPTH32_FLOAT,
            samples: 4,
            permutation: 0,
        };
        layout
            .rebuild(
                &settings,
                &mut pipelines,
                targets,
                &scene,
                &batches,
                scene.parity(),
                u32::MAX,
                CasterPasses::default(),
                Prepass::Off,
                &Skinning::default(),
                &mut KeyCounts::new(),
                targets,
                false,
                0,
            )
            .unwrap();
        let texels = uploaded_ranges(&mut layout);
        let scene_rows = (scene.capacity() + 1) as usize;
        // The scene's object reads no radius of its own; each batch row reads the batch's.
        assert_eq!(texels[0][2], 0.0, "{:?}", texels[0]);
        for texel in &texels[scene_rows..scene_rows + 4] {
            assert_eq!(texel[2], 2600.0, "{texel:?}");
        }
    }

    /// A frame that rebuilds the layout copies a row of the bucket table for every source and,
    /// in the layout that owns the tables, a row of the layer table, a place in the cell order
    /// and a texel of the ranges texture. The room that the layout asks for must cover every one
    /// of those copies, so a frame whose arena holds exactly that room records no overflow.
    #[test]
    fn the_room_a_layout_asks_for_covers_every_table_a_rebuild_copies() {
        let mut settings = scene_settings(&RendererConfig {
            max_materials: 4,
            ..RendererConfig::default()
        });
        let mesh = settings
            .meshes_mut()
            .add(&box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap())
            .unwrap()
            + 1;
        let material = settings
            .materials_mut()
            .create(Shading::Lit, 0, [1.0; 4])
            .unwrap()
            + 1;
        let mut scene = SceneStorage::with_capacity(8);
        scene.apply_commands(&[], 1).unwrap();
        scene.update_transforms(&JobSystem::new(0));
        let mut batches = BatchTable::with_capacity(1);
        batches
            .create(4096, false, false, mesh, material, 0.9)
            .unwrap();
        let mut layout = Layout::default();
        let mut pipelines = PipelineCache::default();
        let targets = PassTargets {
            color_format: format::CANVAS,
            depth_format: format::DEPTH32_FLOAT,
            samples: 4,
            permutation: 0,
        };
        layout
            .rebuild(
                &settings,
                &mut pipelines,
                targets,
                &scene,
                &batches,
                scene.parity(),
                u32::MAX,
                CasterPasses::default(),
                Prepass::Off,
                &Skinning::default(),
                &mut KeyCounts::new(),
                targets,
                false,
                0,
            )
            .unwrap();
        let mut list = DrawList::with_capacity(1 << 16);
        let mut arena = UploadArena::default();
        arena.begin_frame().unwrap();
        layout
            .apply(&mut list, &mut arena, u32::MAX)
            .expect("the frame's tables fit the room the layout asked for");
    }

    /// The frame's count of each level's copies visits only the sources whose mesh has levels: the
    /// scene's objects of such a mesh, shown or hidden, and every row of a batch that draws one.
    /// Objects and rows of a mesh without levels never enter the count, however many there are.
    /// A small set keeps a slot for each of its sources in each level, and the frames count none
    /// of its copies; a set past the fixed sets' room is counted.
    #[test]
    fn a_layout_lists_only_the_sources_of_a_mesh_with_levels_for_the_count() {
        use null3d_core::levels::Switch;

        let layout_with = |leveled_rows: u32| {
            let mut settings = scene_settings(&RendererConfig {
                max_materials: 4,
                ..RendererConfig::default()
            });
            let mut add_box = |segments: u32| {
                let geometry = box_geometry(1.0, 1.0, 1.0, [segments; 3]).unwrap();
                settings.meshes_mut().add(&geometry).unwrap() + 1
            };
            let (leveled, coarse, plain) = (add_box(2), add_box(1), add_box(1));
            settings
                .set_mesh_levels(leveled, &[coarse], &[0.01], &[Switch::Error], &[0], 0)
                .unwrap();
            let material = settings.materials_mut().create(Shading::Lit, 0, [1.0; 4]);
            let material = material.unwrap() + 1;
            let mut scene = SceneStorage::with_capacity(16);
            let mut commands = Vec::new();
            let mut leveled_slots = Vec::new();
            for i in 0..12u32 {
                let object = scene.reserve().unwrap();
                let mesh = if i % 3 == 0 { leveled } else { plain };
                // A hidden object keeps its place in the list, as showing it takes no rebuild.
                let shown = if i == 6 { 0 } else { flags::VISIBLE };
                commands.push(Command::create(object, Handle::NONE, mesh, shown));
                commands.push(Command::set_material(object, material));
                if mesh == leveled {
                    leveled_slots.push(scene.resolve(object).unwrap());
                }
            }
            scene.apply_commands(&commands, 1).unwrap();
            scene.update_transforms(&JobSystem::new(0));
            let mut batches = BatchTable::with_capacity(2);
            for (mesh, rows) in [(plain, 8), (leveled, leveled_rows)] {
                let batch = batches
                    .create(rows, false, false, mesh, material, 0.5)
                    .unwrap();
                batches.get_mut(batch).unwrap().set_active_count(5).unwrap();
            }
            let mut layout = Layout::new(Drawn::Scene, false, FIXED_LEVEL_SLOTS);
            let targets = PassTargets {
                color_format: format::CANVAS,
                depth_format: format::DEPTH32_FLOAT,
                samples: 4,
                permutation: 0,
            };
            layout
                .rebuild(
                    &settings,
                    &mut PipelineCache::default(),
                    targets,
                    &scene,
                    &batches,
                    scene.parity(),
                    u32::MAX,
                    CasterPasses::default(),
                    Prepass::Off,
                    &Skinning::default(),
                    &mut KeyCounts::new(),
                    targets,
                    false,
                    0,
                )
                .unwrap();
            let base = layout.batch_bases[1].1;
            (layout, leveled_slots, base..base + leveled_rows)
        };
        let (small, slots, rows) = layout_with(8);
        let leveled: Vec<u32> = slots.into_iter().chain(rows).collect();
        assert_eq!(small.fixed_sources, leveled);
        assert!(small.level_sources.is_empty());
        assert!(small.fixed_sources.len() * 2 < small.sources as usize);

        let (large, slots, rows) = layout_with(FIXED_LEVEL_SLOTS);
        let mut listed: Vec<u32> = large.level_sources.clone();
        listed.extend(&large.fixed_sources);
        listed.sort_unstable();
        let leveled: Vec<u32> = slots.into_iter().chain(rows.clone()).collect();
        assert_eq!(listed, leveled);
        assert!(
            rows.into_iter()
                .all(|row| large.level_sources.contains(&row))
        );
        let fixed_slots: u32 = (0..large.buckets.len())
            .filter(|&b| large.marks[b] == FIXED)
            .map(|b| large.buckets[b].capacity)
            .sum();
        assert!(fixed_slots <= FIXED_LEVEL_SLOTS);
    }

    #[test]
    fn objects_with_bounds_of_their_own_or_none_cull_in_buckets_of_their_own() {
        let mut settings = scene_settings(&RendererConfig {
            max_materials: 4,
            ..RendererConfig::default()
        });
        // The box's positions start at its corner on x, as a quantized file stores them, so the
        // mesh's sphere lies half a meter along x from its origin.
        let mut box_mesh = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
        let stride = box_mesh.stride();
        for v in 0..box_mesh.vertex_count() {
            let at = v * stride;
            let x = f32::from_le_bytes(box_mesh.vertices[at..at + 4].try_into().unwrap());
            box_mesh.vertices[at..at + 4].copy_from_slice(&(x + 0.5).to_le_bytes());
        }
        let mesh = settings.meshes_mut().add(&box_mesh).unwrap() + 1;
        let material = settings.materials_mut().create(Shading::Lit, 0, [1.0; 4]);
        let material = material.unwrap() + 1;
        let mut scene = SceneStorage::with_capacity(8);
        let mut commands = Vec::new();
        let mut slots = Vec::new();
        for _ in 0..4 {
            let object = scene.reserve().unwrap();
            commands.push(Command::create(object, Handle::NONE, mesh, flags::VISIBLE));
            commands.push(Command::set_material(object, material));
            slots.push((object, scene.resolve(object).unwrap() as usize));
        }
        // Two objects keep the mesh's bounds, one has bounds of its own, and one is never culled.
        let (own, own_slot) = slots[2];
        scene.local_centers_mut()[own_slot * 3 + 1] = 1.5;
        scene.local_radii_mut()[own_slot] = 4.0;
        let own_bounds = flags::CUSTOM_BOUNDS;
        commands.push(Command::set_flags(own, own_bounds, own_bounds));
        let unculled = flags::UNCULLED;
        commands.push(Command::set_flags(slots[3].0, unculled, unculled));
        scene.apply_commands(&commands, 1).unwrap();
        scene.update_transforms(&JobSystem::new(0));

        let mut layout = Layout::default();
        let batches = BatchTable::with_capacity(1);
        let parity = scene.parity();
        let mut pipelines = PipelineCache::default();
        let targets = PassTargets {
            color_format: format::CANVAS,
            depth_format: format::DEPTH32_FLOAT,
            samples: 4,
            permutation: 0,
        };
        layout
            .rebuild(
                &settings,
                &mut pipelines,
                targets,
                &scene,
                &batches,
                parity,
                u32::MAX,
                CasterPasses::default(),
                Prepass::Off,
                &Skinning::default(),
                &mut KeyCounts::new(),
                targets,
                false,
                0,
            )
            .unwrap();
        let mesh_radius = settings.meshes().mesh(mesh - 1).unwrap().radius;
        let spheres: Vec<_> = layout
            .buckets
            .iter()
            .map(|b| (b.capacity, b.center, b.radius))
            .collect();
        assert_eq!(
            spheres,
            [
                (2, [0.5, 0.0, 0.0], mesh_radius),
                (1, [0.0; 3], UNBOUNDED_RADIUS),
                (1, [0.0, 1.5, 0.0], 4.0),
            ]
        );
        // Each record holds its sphere's centre, where the culling shader reads it, then the
        // first joint of a skin, which no bucket here has, 0 for a slice of copies, and zeros for
        // the level of detail of a mesh without levels.
        let words = BUCKET_WORDS as usize;
        let record = &layout.bucket_records[2 * words..3 * words];
        assert_eq!(record[5..8], [0.0f32, 1.5, 0.0].map(f32::to_bits));
        assert_eq!(record[8..13], [0; 5]);
        // The bucket takes the quality settings' threshold, as it holds no bias of its own.
        assert_eq!(record[13], 1.0f32.to_bits());
    }

    #[test]
    fn an_object_with_a_bias_of_its_own_culls_in_a_bucket_of_its_own() {
        let mut settings = scene_settings(&RendererConfig {
            max_materials: 4,
            ..RendererConfig::default()
        });
        let mesh = settings
            .meshes_mut()
            .add(&box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap())
            .unwrap()
            + 1;
        let material = settings
            .materials_mut()
            .create(Shading::Lit, 0, [1.0; 4])
            .unwrap()
            + 1;
        let mut scene = SceneStorage::with_capacity(8);
        let mut commands = Vec::new();
        let mut slots = Vec::new();
        for _ in 0..3 {
            let object = scene.reserve().unwrap();
            commands.push(Command::create(object, Handle::NONE, mesh, flags::VISIBLE));
            commands.push(Command::set_material(object, material));
            slots.push(object);
        }
        scene.apply_commands(&commands, 1).unwrap();
        // One object keeps its detail: its bucket takes the bias of its threshold, and the other
        // two keep the bucket they share.
        let keen = slots[2];
        scene
            .apply_commands(&[Command::set_level_bias(keen, 0.5)], 1)
            .unwrap();
        scene.update_transforms(&JobSystem::new(0));
        let mut layout = Layout::default();
        let batches = BatchTable::with_capacity(1);
        let parity = scene.parity();
        let mut pipelines = PipelineCache::default();
        let targets = PassTargets {
            color_format: format::CANVAS,
            depth_format: format::DEPTH32_FLOAT,
            samples: 4,
            permutation: 0,
        };
        layout
            .rebuild(
                &settings,
                &mut pipelines,
                targets,
                &scene,
                &batches,
                parity,
                u32::MAX,
                CasterPasses::default(),
                Prepass::Off,
                &Skinning::default(),
                &mut KeyCounts::new(),
                targets,
                false,
                0,
            )
            .unwrap();
        let biases: Vec<(u32, f32)> = layout
            .buckets
            .iter()
            .map(|bucket| (bucket.capacity, bucket.bias))
            .collect();
        assert_eq!(biases, [(2, 1.0), (1, 0.5)]);
        // The record holds the bias after the level's links, where the culling shader reads it.
        let words = BUCKET_WORDS as usize;
        assert_eq!(layout.bucket_records[words + 13], 0.5f32.to_bits());
        assert_eq!(layout.bucket_records[13], 1.0f32.to_bits());
    }

    #[test]
    fn a_feature_instance_draw_keeps_a_bucket_of_its_own_that_culling_never_counts() {
        // The adapter marks its object unculled, because the add-on's own count is its cull, and a
        // mesh made from arrays carries no bounds of its own. Each of these keys must still give
        // the draw a bucket that names it, its buffers and its count.
        for bounds in [flags::UNCULLED, flags::CUSTOM_BOUNDS, 0] {
            let mut settings = scene_settings(&RendererConfig {
                max_materials: 4,
                ..RendererConfig::default()
            });
            let box_mesh = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
            let mesh = settings.meshes_mut().add(&box_mesh).unwrap() + 1;
            let material = settings.materials_mut().create(Shading::Lit, 0, [1.0; 4]);
            let material = material.unwrap() + 1;
            let mut scene = SceneStorage::with_capacity(8);
            let object = scene.reserve().unwrap();
            let mut commands = vec![
                Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
                Command::set_material(object, material),
            ];
            commands.push(Command::set_flags(object, flags::BOUNDS, bounds));
            scene.apply_commands(&commands, 1).unwrap();
            scene.set_local_radius(object, 2.0).unwrap();
            scene.update_transforms(&JobSystem::new(0));
            let slot = scene.resolve(object).unwrap();
            let id = settings.feature_instances_mut().create(slot, 40).unwrap();
            assert!(settings.feature_instances_mut().set_count(id, 6));

            let mut layout = Layout::default();
            let batches = BatchTable::with_capacity(1);
            let mut pipelines = PipelineCache::default();
            let targets = PassTargets {
                color_format: format::CANVAS,
                depth_format: format::DEPTH32_FLOAT,
                samples: 4,
                permutation: 0,
            };
            layout
                .rebuild(
                    &settings,
                    &mut pipelines,
                    targets,
                    &scene,
                    &batches,
                    scene.parity(),
                    u32::MAX,
                    CasterPasses::default(),
                    Prepass::Off,
                    &Skinning::default(),
                    &mut KeyCounts::new(),
                    targets,
                    false,
                    0,
                )
                .unwrap();
            // The object's entry draws nowhere, so the culling shader never counts its instances.
            assert_eq!(layout.instance_buckets[slot as usize], HIDDEN);
            let (first_draw, feature_capacity) = layout
                .buckets
                .iter()
                .find(|bucket| bucket.feature == id)
                .map(|bucket| (bucket.first_draw, bucket.feature_capacity))
                .unwrap_or_else(|| panic!("the draw with the bounds {bounds} has a bucket"));
            assert_eq!(feature_capacity, 40);
            let count_word = (first_draw * sizes::INDIRECT_WORDS + 1) as usize;
            // The template that the frame's reset uploads holds the page's count for the camera's
            // mirrors and probes, which the frame's count copy does not reach.
            assert_eq!(layout.indirect_template[count_word], 0);
            layout.set_feature_counts(settings.feature_instances(), scene.world(1).radii());
            assert_eq!(layout.indirect_template[count_word], 6);
        }
    }

    #[test]
    fn an_entry_counted_on_the_gpu_is_hidden_from_culling() {
        assert_eq!(scene_entry(4, 1.0, 3, flags::VISIBLE, true, true), HIDDEN);
        assert_ne!(scene_entry(4, 1.0, 3, flags::VISIBLE, false, true), HIDDEN);
    }

    #[test]
    fn every_object_whose_bucket_draws_depth_may_hide_others_unless_it_opts_out() {
        let occluder = |object_flags, occludes| {
            scene_entry(4, 1.0, 3, object_flags, false, occludes) & OCCLUDER != 0
        };
        // No mark is needed: the bucket's depth pipeline in the occluders' pass decides.
        assert!(occluder(flags::VISIBLE, true));
        assert!(occluder(flags::VISIBLE | flags::OCCLUDER, true));
        assert!(!occluder(flags::VISIBLE | flags::NOT_OCCLUDER, true));
        // A bucket without that pipeline, as a blended, masked or custom surface has, hides
        // nothing, whatever the mark says.
        assert!(!occluder(flags::VISIBLE | flags::OCCLUDER, false));
        assert!(!occluder(flags::VISIBLE, false));
        // The bucket and the cell stay in their bits.
        let entry = scene_entry(4, 1.0, 3, flags::VISIBLE, false, true);
        assert_eq!(entry & (OCCLUDER - 1), 4);
        assert_eq!(entry >> CELL_SHIFT, 3);
    }

    #[test]
    fn rows_may_hide_others_unless_their_batch_opts_out() {
        let mut batch = InstanceBatch::new(4, false, false, 1, 1, 1.0);
        batch.set_active_count(4).expect("the rows");
        let row = |batch: &InstanceBatch, occludes| row_entry(2, batch, 1, 4, occludes);
        assert_ne!(row(&batch, true) & OCCLUDER, 0);
        assert_eq!(row(&batch, false) & OCCLUDER, 0);
        batch.set_shadows(flags::CAST_SHADOWS | flags::NOT_OCCLUDER);
        assert!(batch.not_occluder());
        assert_eq!(batch.shadows(), flags::CAST_SHADOWS);
        assert_eq!(row(&batch, true) & OCCLUDER, 0);
        // A row past the active count draws nowhere.
        assert_eq!(row_entry(2, &batch, 4, 4, true), HIDDEN);
    }

    /// A scene of one object of a mesh of 30,000 separate triangles, past what one part holds,
    /// whose vertices each carry their own number in their first word, and a tree of `patches`
    /// patches, each over the mesh's last triangle. Returns the layout that `cluster_binding`
    /// builds, the settings, and the mesh's id.
    fn split_tree_layout(cluster_binding: u32, patches: u32) -> (Layout, SceneSettings, u32) {
        let mut settings = scene_settings(&RendererConfig::default());
        let stride = null3d_gpu::drawlist::vertex::stride(0) as usize;
        let count = 90_000usize;
        let mut vertices = vec![0; count * stride];
        for v in 0..count {
            vertices[v * stride..v * stride + 4].copy_from_slice(&(v as u32).to_le_bytes());
        }
        let geometry = crate::geometry::Geometry {
            format: 0,
            vertices,
            indices: (0..count as u32).collect(),
        };
        let index = settings.meshes_mut().add(&geometry).unwrap();
        let mesh = index + 1;
        let last = count as u32 - 3;
        let mut indices = vec![last, last + 1, last + 2];
        let part_vertices = settings.meshes().to_part_order(index, &mut indices);
        let patches = patches as usize;
        let tree = crate::patches::PatchTree::new(
            indices.repeat(patches),
            vec![[0.0, 0.0, 0.0, 1.0]; patches],
            (0..patches as u32).map(|k| [k * 3, 3, 0, 0]).collect(),
            0,
            part_vertices,
        )
        .unwrap();
        settings.patches_mut().set(mesh, Some(tree));
        let material = settings
            .materials_mut()
            .create(Shading::Lit, 0, [1.0; 4])
            .unwrap()
            + 1;
        let mut scene = SceneStorage::with_capacity(8);
        let object = scene.reserve().unwrap();
        scene
            .apply_commands(
                &[
                    Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
                    Command::set_material(object, material),
                ],
                1,
            )
            .unwrap();
        scene.update_transforms(&JobSystem::new(0));
        let targets = PassTargets {
            color_format: format::CANVAS,
            depth_format: format::DEPTH32_FLOAT,
            samples: 4,
            permutation: 0,
        };
        let mut layout = Layout::default();
        layout
            .rebuild(
                &settings,
                &mut PipelineCache::default(),
                targets,
                &scene,
                &BatchTable::with_capacity(1),
                scene.parity(),
                u32::MAX,
                CasterPasses::default(),
                Prepass::Off,
                &Skinning::default(),
                &mut KeyCounts::new(),
                targets,
                false,
                cluster_binding,
            )
            .unwrap();
        (layout, settings, mesh)
    }

    /// A camera bundle draws a pieced level's pieces while the level holds copies, and leaves out
    /// every one of their draws once the frames' counts have found the level idle. A copy that
    /// picks the level again brings them back at once, and each change asks for the bundles again.
    #[test]
    fn a_bundle_leaves_out_the_pieces_of_a_level_that_holds_no_copy() {
        let (mut layout, _settings, _, targets) = pieced_layout();
        let whole = layout
            .buckets
            .iter()
            .position(|bucket| bucket.pieces.is_some())
            .expect("a bucket with pieces");
        let (first, count) = layout.buckets[whole].pieces.unwrap();
        // The bucket takes a level's copies, as a level of a set does, and its pieces with it.
        layout.marks[whole] = 1;
        layout.marks[first as usize..(first + count) as usize].fill(1);
        layout.level_buckets = (0..layout.buckets.len() as u32)
            .filter(|&b| layout.marks[b as usize] != 0)
            .collect();
        let meshes = crate::frame::MeshBuffers::new(100);
        let piece_draws: u32 = layout.buckets[first as usize..(first + count) as usize]
            .iter()
            .map(|bucket| bucket.draws)
            .sum();
        assert!(piece_draws > 0);
        let draws = |layout: &Layout| {
            let mut list = DrawList::with_capacity(4096);
            super::super::opaque::record_bundle(
                &mut list,
                crate::view::ViewId::CAMERA,
                layout,
                &meshes,
                targets,
                super::super::opaque::Bundle::Opaque,
                0,
                &|_| false,
            )
            .unwrap();
            null3d_gpu::drawlist::decode(list.words())
                .map(Result::unwrap)
                .filter(|command| command.op == Op::DrawIndexedIndirect)
                .count() as u32
        };
        let mut fits = vec![0u32; layout.buckets.len()];
        fits[whole] = 5;
        assert!(!layout.note_idle(&fits));
        let busy = draws(&layout);
        assert_eq!(busy, piece_draws, "a level with copies draws every piece");
        // No copy picks the level: it stays drawn until the wait ends, then turns idle once.
        fits[whole] = 0;
        let changes: Vec<bool> = (0..super::super::copies::IDLE_FRAMES)
            .map(|_| layout.note_idle(&fits))
            .collect();
        assert_eq!(changes.iter().filter(|&&changed| changed).count(), 1);
        assert_eq!(changes.last(), Some(&true));
        assert!(layout.idle[whole]);
        assert_eq!(draws(&layout), 0, "an idle level draws no piece");
        // A copy picks the level again, and its pieces draw at once.
        fits[whole] = 1;
        assert!(layout.note_idle(&fits));
        assert_eq!(draws(&layout), busy);
        // The direct path counts each bucket's copies itself, and leaves out a level's bucket
        // that holds none.
        let direct = |counts: &[u32]| {
            let mut list = DrawList::with_capacity(4096);
            super::super::opaque::record_direct(
                &mut list,
                crate::view::ViewId::CAMERA,
                &layout,
                &meshes,
                super::super::opaque::Bundle::Opaque,
                counts,
                &|_| false,
            )
            .unwrap();
            null3d_gpu::drawlist::decode(list.words())
                .map(Result::unwrap)
                .filter(|command| command.op == Op::DrawIndexed)
                .count() as u32
        };
        let mut counts = vec![0u32; layout.buckets.len()];
        assert_eq!(direct(&counts), 0, "pieces that hold no copy draw nothing");
        counts[first as usize..(first + count) as usize].fill(2);
        assert_eq!(direct(&counts), piece_draws);
    }

    /// A mesh split into two parts whose list comes in three pieces, the last of which crosses
    /// from the first part into the second: its bucket draws nothing of its own, and each piece's
    /// bucket draws the ranges of the parts that it covers, in the bucket's place in the draw
    /// order, from a slice of the bucket's size, with its sphere and cone in its record.
    /// A layout of one object whose mesh, split into two parts, holds three pieces, with the
    /// layout's settings, the mesh and the targets that it was built for.
    fn pieced_layout() -> (Layout, SceneSettings, u32, PassTargets) {
        let (mut layout, mut settings, mesh) = split_tree_layout(0, 1);
        let piece = |triangles: u32, axis: f32| crate::pieces::Piece {
            triangles,
            sphere: [axis, 0.0, 0.0, 2.0],
            cone: [axis, 0.0, 0.0, 0.5],
        };
        settings
            .meshes_mut()
            .set_pieces(
                mesh - 1,
                &[piece(10_000, 1.0), piece(10_000, -1.0), piece(10_000, 0.0)],
                &[],
            )
            .unwrap();
        let material = settings
            .materials_mut()
            .create(Shading::Lit, 0, [1.0; 4])
            .unwrap()
            + 1;
        let mut scene = SceneStorage::with_capacity(8);
        let object = scene.reserve().unwrap();
        scene
            .apply_commands(
                &[
                    Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
                    Command::set_material(object, material),
                ],
                1,
            )
            .unwrap();
        scene.update_transforms(&JobSystem::new(0));
        let targets = PassTargets {
            color_format: format::CANVAS,
            depth_format: format::DEPTH32_FLOAT,
            samples: 4,
            permutation: 0,
        };
        layout
            .rebuild(
                &settings,
                &mut PipelineCache::default(),
                targets,
                &scene,
                &BatchTable::with_capacity(1),
                scene.parity(),
                u32::MAX,
                CasterPasses::default(),
                Prepass::Off,
                &Skinning::default(),
                &mut KeyCounts::new(),
                targets,
                false,
                0,
            )
            .unwrap();
        (layout, settings, mesh, targets)
    }

    #[test]
    fn a_mesh_in_pieces_draws_each_piece_from_a_bucket_and_slice_of_its_own() {
        let (layout, settings, mesh, _) = pieced_layout();
        let whole = layout
            .buckets
            .iter()
            .position(|bucket| bucket.pieces.is_some())
            .expect("a bucket with pieces");
        let (first, count) = layout.buckets[whole].pieces.unwrap();
        assert_eq!(count, 3);
        assert_eq!(layout.buckets[whole].draws, 0);
        let pieces = &layout.buckets[first as usize..(first + count) as usize];
        assert_eq!(
            pieces.iter().map(|b| b.draws).collect::<Vec<_>>(),
            [1, 1, 2]
        );
        // The ranges cover the mesh's two parts once, in order: the third piece ends the first
        // part and starts the second.
        let parts = settings
            .meshes()
            .parts(settings.meshes().mesh(mesh - 1).unwrap(), false);
        assert_eq!(parts.len(), 2);
        let ranges: Vec<(u32, u32, u32)> = pieces
            .iter()
            .flat_map(|b| &layout.draws[b.first_draw as usize..(b.first_draw + b.draws) as usize])
            .map(|draw| (draw.first_index, draw.index_count, draw.base_vertex))
            .collect();
        let split = parts[0].index_count;
        assert_eq!(
            ranges,
            [
                (parts[0].first_index, 30_000, parts[0].base_vertex),
                (parts[0].first_index + 30_000, 30_000, parts[0].base_vertex),
                (
                    parts[0].first_index + 60_000,
                    split - 60_000,
                    parts[0].base_vertex
                ),
                (parts[1].first_index, 90_000 - split, parts[1].base_vertex),
            ]
        );
        // Each piece's slice holds every copy that its bucket's would, after the bucket's own.
        for (k, bucket) in pieces.iter().enumerate() {
            assert_eq!(bucket.capacity, layout.buckets[whole].capacity);
            assert_eq!(bucket.material, layout.buckets[whole].material);
            assert_eq!(bucket.pipeline, layout.buckets[whole].pipeline);
            let record = &layout.bucket_records[(first as usize + k) * BUCKET_WORDS as usize..];
            assert_eq!(
                f32::from_bits(record[5]),
                [1.0, -1.0, 0.0][k],
                "the sphere's centre"
            );
            assert_eq!(f32::from_bits(record[2]), 2.0, "the sphere's radius");
            assert_eq!(
                f32::from_bits(record[10]),
                [1.0, -1.0, 0.0][k],
                "the cone's axis"
            );
            assert_eq!(f32::from_bits(record[13]), 0.5, "the cone's cutoff");
        }
        let starts: Vec<u32> = pieces.iter().map(|b| b.base).collect();
        assert!(starts.windows(2).all(|w| w[1] >= w[0] + pieces[0].capacity));
        let record = &layout.bucket_records[whole * BUCKET_WORDS as usize..];
        assert_eq!(record[9], PIECED | first | count << PIECE_COUNT_SHIFT);
        // A pass draws the pieces where the bucket would draw.
        let order: Vec<usize> = layout.drawn_buckets().collect();
        let at = order.iter().position(|&b| b == first as usize).unwrap();
        assert_eq!(
            &order[at..at + 3],
            &[first as usize, first as usize + 1, first as usize + 2]
        );
        assert!(!order.contains(&whole));
    }

    /// The cluster pass draws a split mesh's patches with 32-bit indices from the first part's base
    /// vertex, so every index must land on the mesh vertex that the tree named, in the one page
    /// that holds all the mesh's parts.
    #[test]
    fn a_split_meshs_tree_reaches_its_own_vertices_from_the_first_parts_base_vertex() {
        let (layout, settings, mesh) = split_tree_layout(
            null3d_gpu::drawlist::sizes::PORTABLE_STORAGE_BINDING_BYTES,
            1,
        );
        let meshes = settings.meshes();
        let slot = meshes.mesh(mesh - 1).unwrap();
        assert!(meshes.parts(slot, false).len() > 1, "the mesh splits");
        let [cluster] = layout.clusters[..] else {
            panic!("the mesh draws its tree: {:?}", layout.clusters);
        };
        let first = meshes.joined_parts(slot).expect("one run of vertices");
        assert_eq!(cluster.base_vertex, first.base_vertex);
        let page = &meshes.pages()[first.page as usize];
        let stride = null3d_gpu::drawlist::vertex::stride(0) as usize;
        for (k, &index) in layout.cluster_indices.iter().enumerate() {
            let at = (index + cluster.base_vertex) as usize * stride;
            let own = u32::from_le_bytes(page.vertices[at..at + 4].try_into().unwrap());
            assert_eq!(own, 90_000 - 3 + k as u32, "index {k}");
        }
    }

    /// A tree whose tables would pass the cluster pass's storage binding draws the mesh's whole
    /// triangle list, as it would where no cluster pass runs, rather than fail the frame.
    #[test]
    fn a_tree_past_the_cluster_binding_draws_whole() {
        // The tree's patch and its mesh's record take 64 bytes of the patch table.
        let [table, _] = super::super::clusters::table_bytes(1, 1, 3);
        let (layout, ..) = split_tree_layout(table, 1);
        assert_eq!(layout.clusters.len(), 1);
        let (layout, ..) = split_tree_layout(table - 1, 1);
        assert!(layout.clusters.is_empty());
        assert!(layout.buckets.iter().all(|bucket| bucket.cluster.is_none()));
        let (layout, ..) = split_tree_layout(0, 1);
        assert!(layout.clusters.is_empty());
    }

    /// The pass copies each patch's indices in a workgroup of its own, in one dispatch along one
    /// axis, so the trees that a layout draws hold at most as many patches as that axis takes.
    #[test]
    fn a_tree_past_one_dispatch_of_patches_draws_whole() {
        let most = null3d_gpu::caps::MAX_WORKGROUPS_PER_DIMENSION;
        let binding = null3d_gpu::drawlist::sizes::PORTABLE_STORAGE_BINDING_BYTES;
        let (layout, ..) = split_tree_layout(binding, most);
        assert_eq!(layout.clusters.len(), 1);
        let (layout, ..) = split_tree_layout(binding, most + 1);
        assert!(layout.clusters.is_empty());
    }
}

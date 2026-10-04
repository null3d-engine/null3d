//! The sources and buckets that every view culls and draws, and their uploads: the world matrices,
//! the bucket, cell and layer mask of every source, the bucket records that the culling shader
//! reads, and the sources in cell order.
//!
//! A layout holds one kind of bucket. The scene's layout holds every object and instance row with a
//! mesh and a material, as the views of cameras draw them, and it owns the matrices, the layer
//! table and the cell order. The casters' layout holds the objects that cast shadows, grouped by
//! mesh alone, as the shadow cascades draw their depth. It has a bucket table and bucket records of
//! its own, and its culling reads the scene layout's matrices, layer table and cell order.

use std::collections::TryReserveError;
use std::ops::Range;

use null3d_core::cells::CELL_SHIFT;
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::scene::{SceneStorage, flags};
use null3d_core::snapshot::SCENE_TARGET;
use null3d_core::world::{MATRIX_FLOATS, UNBOUNDED_RADIUS};
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage as usage, sizes};

use super::ids;
use super::skin::Skinning;
use crate::cells::{CellCulling, CellMask, CellOrder, MOVING};
use crate::frame::{
    FrameInput, HIDDEN, RecordError, SceneSettings, UploadArena, address, bucket_of,
    collect_bucket_keys, drawn_rows, floats_as_bytes, grown_size, words_as_bytes,
};
use crate::pipelines::{DrawKey, PassTargets, PipelineCache, Prepass};

/// Words of one bucket record in the culling shader: base, material, radius, first draw, draw
/// count, the centre of the local sphere that culls the bucket's sources, and the first joint of
/// the skin of a bucket whose vertex shader skins.
const BUCKET_WORDS: u32 = sizes::BUCKET_WORDS;
/// Bytes of one bucket record.
const BUCKET_BYTES: u32 = BUCKET_WORDS * 4;
/// Bytes of one world matrix: three rows of four floats.
const MATRIX_BYTES: u32 = (MATRIX_FLOATS * 4) as u32;

/// What makes a bucket, in draw order: what its mesh and material ask of their pipeline, the bind
/// group of its material's map, the mesh page of its mesh's first part, its engine mesh and
/// material ids, and the bounds that cull its sources (see [`bounds_of`]). The WebGL2 builder's
/// keys have the same type, so both share one sort.
type BucketKey = (DrawKey, u32, u32, u32, u32, u32);

/// What a layout's buckets draw.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Drawn {
    /// Every object and instance row with a mesh and a material, as the views of cameras draw
    /// them.
    #[default]
    Scene,
    /// The objects that cast shadows, as the shadow cascades draw their depth.
    Casters,
}

/// The material of every caster bucket: a caster's depth does not depend on its material, so
/// casters of one mesh share a bucket.
const CASTER_MATERIAL: u32 = 1;

/// The bounds of sources culled with their mesh's sphere, centred on their origin.
const MESH_BOUNDS: u32 = 0;
/// The bounds of sources that culling keeps wherever they are.
const UNCULLED_BOUNDS: u32 = 1;
/// The bounds of a scene object with a sphere of its own: this plus its slot.
const OWN_BOUNDS: u32 = 2;

/// The bounds part of a scene object's bucket key. The culling shader reads one local sphere per
/// bucket, so each object with a sphere of its own draws from a bucket of its own.
fn bounds_of(scene: &SceneStorage, slot: usize) -> u32 {
    let object_flags = scene.flags()[slot];
    if object_flags & flags::UNCULLED != 0 {
        UNCULLED_BOUNDS
    } else if object_flags & flags::CUSTOM_BOUNDS != 0 {
        OWN_BOUNDS + slot as u32
    } else {
        MESH_BOUNDS
    }
}

/// The centre and radius of the local sphere that culls a bucket with `bounds`, whose mesh's
/// sphere has `mesh_radius`.
fn local_sphere(scene: &SceneStorage, bounds: u32, mesh_radius: f32) -> ([f32; 3], f32) {
    match bounds {
        MESH_BOUNDS => ([0.0; 3], mesh_radius),
        UNCULLED_BOUNDS => ([0.0; 3], UNBOUNDED_RADIUS),
        own => {
            let slot = (own - OWN_BOUNDS) as usize;
            let center = &scene.local_centers()[slot * 3..slot * 3 + 3];
            ([center[0], center[1], center[2]], scene.local_radii()[slot])
        }
    }
}

/// One bucket: its pipeline, its slice of each view's compacted instance buffer, and its draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Bucket {
    /// The id of its render pipeline.
    pub(super) pipeline: u32,
    /// The id of the render pipeline that draws its depth in the depth prepass or the occluders'
    /// pass, or 0 for a bucket that the pass leaves out.
    pub(super) prepass: u32,
    /// The bind group of its material's map, or 0 for a pipeline that reads none.
    pub(super) group: u32,
    pub(super) material: u32,
    pub(super) base: u32,
    pub(super) capacity: u32,
    /// Its draws, one per part of its mesh: `draws` of the layout's draws from `first_draw` on.
    pub(super) first_draw: u32,
    pub(super) draws: u32,
    /// The local sphere that culls its sources.
    pub(super) center: [f32; 3],
    pub(super) radius: f32,
    /// True for the bucket of a skinned object whose vertex shader skins it, with the first joint
    /// of its skin in the joint texture.
    pub(super) skins: bool,
    pub(super) first_joint: u32,
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
    /// part's region of the skinned vertex buffer.
    pub(super) vertices: Option<(u32, u32)>,
}

/// The bit of a table entry that marks a source that the sketch marks as an occluder, which the
/// first phase of occlusion culling draws. Buckets take the bits below it, and the cell index the
/// bits from `CELL_SHIFT` up.
pub(super) const OCCLUDER: u32 = 1 << 22;
const _: () = assert!(OCCLUDER << 1 == 1 << CELL_SHIFT);

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

/// A scene object's entry in the bucket table: its bucket, whether it is an occluder, and its
/// cell, or `HIDDEN` while it is hidden, which its world radius says.
fn scene_entry(home: u32, world_radius: f32, cell: u32, object_flags: u32) -> u32 {
    if world_radius == f32::NEG_INFINITY {
        HIDDEN
    } else {
        entry(home, cell, object_flags & flags::OCCLUDER != 0)
    }
}

/// The entry of a batch's `row`: the batch's bucket and the row's cell while the row is active.
/// Instance rows are never occluders.
fn row_entry(bucket: u32, batch: &InstanceBatch, row: u32, active: u32) -> u32 {
    if row < active {
        entry(bucket, batch.cells()[row as usize], false)
    } else {
        HIDDEN
    }
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

/// A batch's part of the tables as they were last written: its bucket, the active row count its
/// bucket table entries hold, and the mask its rows hold in the layer table.
#[derive(Clone, Copy, Debug)]
struct BatchRows {
    bucket: u32,
    active: u32,
    layers: u32,
}

/// The source layout and bucket tables, rebuilt when the structure changes.
#[derive(Default)]
pub(super) struct Layout {
    /// What the buckets draw.
    drawn: Drawn,
    pub(super) sources: u32,
    /// Each batch's raw id and the first source of its rows.
    batch_bases: Vec<(u32, u32)>,
    pub(super) buckets: Vec<Bucket>,
    /// Every bucket's draws, bucket by bucket; a draw's place is its indirect draw's.
    pub(super) draws: Vec<Draw>,
    /// The entry of every source: its bucket, its occluder bit and its cell, or `HIDDEN`.
    instance_buckets: Vec<u32>,
    /// The shown sources whose entries carry the occluder bit.
    occluders: u32,
    /// The layer mask of every source.
    source_layers: Vec<u32>,
    /// True when every scene slot holds the default mask in the layer table, as it does while no
    /// object has a mask of its own.
    scene_layers_default: bool,
    /// The bucket of every scene slot whether it is shown or not, or `HIDDEN` for a slot with no
    /// mesh or material.
    home_buckets: Vec<u32>,
    /// Each batch's part of the tables, in `batch_bases` order.
    batch_rows: Vec<BatchRows>,
    /// The per-frame reset of every indirect draw: instance counts at zero.
    pub(super) indirect_template: Vec<u32>,
    /// Each bucket of a skinned object, with the object's slot, in bucket order. Their bounds
    /// change with the pose in every frame.
    skinned: Vec<(u32, u32)>,
    /// Bucket records in the culling shader's layout.
    bucket_records: Vec<u32>,
    /// Scratch for rebuilds: every bucket key with its source count, sorted and merged into one
    /// entry per bucket.
    key_counts: Vec<(BucketKey, u32)>,
    pub(super) built: bool,
    /// Sizes of the matrix buffer, the bucket table, the layer table, the bucket records and the
    /// cell order, 0 before they exist.
    buffer_sizes: [u32; 5],
    /// Every drawn source in cell order: the still sources cell by cell, then the moving ones.
    order: CellOrder,
    /// The cell culling build that the order follows, and whether the GPU holds it.
    order_build: Option<u32>,
    order_uploaded: bool,
}

impl Layout {
    /// An empty layout of buckets that draw `drawn`.
    pub(super) fn new(drawn: Drawn) -> Self {
        Self {
            drawn,
            ..Self::default()
        }
    }

    /// The buffers of the bucket table and the bucket records, which the culling passes bind.
    pub(super) fn table_ids(&self) -> (u32, u32) {
        match self.drawn {
            Drawn::Scene => (ids::INSTANCE_BUCKETS, ids::BUCKETS),
            Drawn::Casters => (ids::CASTER_BUCKETS, ids::CASTER_RECORDS),
        }
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

    /// The sources that draw somewhere, which each view's compacted instance buffer holds.
    pub(super) fn drawable(&self) -> u32 {
        self.buckets.iter().map(|b| b.capacity).sum()
    }

    /// The most that one frame copies into its arena for the tables: the bucket table, the layer
    /// table, the bucket records and the cell order.
    pub(super) fn upload_bound(&self) -> usize {
        let rows = self.sources as usize * 4 + self.owned(self.sources) as usize * 8;
        // A frame that writes every record writes the skinned objects' bounds again after them.
        let writes = if self.skinned.is_empty() { 1 } else { 2 };
        rows + self.buckets.len() * BUCKET_BYTES as usize * writes
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

    /// Empties the buckets, for a layout that draws nothing until it is built again.
    pub(super) fn clear(&mut self) {
        self.occluders = 0;
        self.buckets.clear();
        self.draws.clear();
        self.skinned.clear();
        self.indirect_template.clear();
        self.bucket_records.clear();
    }

    /// The shown scene objects that the sketch marks as occluders.
    pub(super) fn occluders(&self) -> u32 {
        self.occluders
    }

    /// Forgets the buffers, so the next layout makes them again and uploads everything.
    pub(super) fn forget_gpu(&mut self) {
        self.built = false;
        self.buffer_sizes = [0; 5];
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
    ) -> Result<(), RecordError> {
        if !cells.active() {
            return Ok(());
        }
        if self.order_build != Some(cells.builds()) {
            let (scene, batches) = (input.scene, input.batches);
            let (bases, rows) = (&self.batch_bases, &self.batch_rows);
            self.order.build(&|visit| {
                cells.visit_scene(scene, visit);
                for (((_, batch), &(_, base)), batch_rows) in batches.iter().zip(bases).zip(rows) {
                    if batch_rows.bucket == HIDDEN {
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
    /// with each bucket's pipeline id from `pipelines`, for a pass that draws into `targets`. With
    /// `shadows`, the scene's receivers draw with pipelines that read the shadow maps. With a
    /// `prepass`, the buckets that it draws get its pipelines too. Skinned objects
    /// draw the skinned vertices that `skinning` lays out. It reuses
    /// the layout's tables and scratch space, which grow only with the scene. A scene of more than
    /// `limit` sources fails.
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
        shadows: bool,
        prepass: Prepass,
        skinning: &Skinning,
    ) -> Result<(), RecordError> {
        let scene_rows = scene.capacity() + 1;
        self.batch_bases.clear();
        let mut sources = scene_rows;
        for (id, batch) in batches.iter() {
            self.batch_bases.push((id.raw(), sources));
            sources += batch.capacity();
        }
        if sources > limit {
            return Err(RecordError::TooManySources { limit });
        }
        self.sources = sources;
        let owned = self.owned(sources);
        self.order
            .try_reserve(owned as usize)
            .map_err(|_| RecordError::OutOfMemory {
                bytes: owned.saturating_mul(4),
            })?;
        self.order_build = None;

        let meshes = settings.meshes();
        let drawn = self.drawn;
        let vertex_skinning = skinning.in_vertex_shader();
        let skin = |key: DrawKey| skinning.skinned_key(key);
        let key_of = |mesh: u32, material: u32, bounds: u32, object: u32, skinned: bool| {
            let mut pipeline = settings.pipeline_of(mesh, material)?;
            if skinned {
                pipeline = skin(pipeline);
            }
            let page = meshes.parts(meshes.mesh(mesh - 1)?).first()?.page;
            if drawn == Drawn::Casters {
                let mut caster = settings.caster_of(pipeline);
                if skinned {
                    caster = skin(caster);
                }
                return Some((caster, 0, page, mesh, CASTER_MATERIAL, bounds));
            }
            // Blended pairs draw in the transparent pass, which sorts them on the job workers.
            if pipeline.blends() {
                return None;
            }
            let pipeline = if shadows && object & flags::RECEIVE_SHADOWS != 0 {
                settings.receiving(pipeline)
            } else {
                pipeline
            };
            let group = settings.texture_group(material, pipeline);
            Some((pipeline, group, page, mesh, material, bounds))
        };
        let world = scene.world(parity);
        let scene_key = |slot: usize| {
            let object = scene.flags()[slot];
            if drawn == Drawn::Casters && (!shadows || object & flags::CAST_SHADOWS == 0) {
                return None;
            }
            let bounds = bounds_of(scene, slot);
            key_of(
                scene.meshes()[slot],
                scene.materials()[slot],
                bounds,
                object,
                skinning.object(slot as u32).is_some(),
            )
        };
        // Instance batches cast no shadows yet. Sprites sized in pixels of the screen have no
        // bounds in the world, so culling keeps them.
        let batch_key = |batch: &InstanceBatch| match drawn {
            Drawn::Scene => {
                let bounds = if batch.unculled() {
                    UNCULLED_BOUNDS
                } else {
                    MESH_BOUNDS
                };
                key_of(batch.mesh(), batch.material(), bounds, 0, false)
            }
            Drawn::Casters => None,
        };

        collect_bucket_keys(
            &mut self.key_counts,
            scene,
            batches,
            scene_key,
            |_, batch| batch_key(batch),
        );

        if self.key_counts.len() as u32 >= MAX_BUCKETS {
            return Err(RecordError::TooManySources { limit: MAX_BUCKETS });
        }
        self.buckets.clear();
        self.draws.clear();
        self.skinned.clear();
        let mut base = 0;
        for &((pipeline, group, _, mesh, material, bounds), count) in &self.key_counts {
            let slot = meshes.mesh(mesh - 1).expect("keys name known meshes");
            let parts = meshes.parts(slot);
            let (center, radius) = local_sphere(scene, bounds, slot.radius);
            let object = bounds.checked_sub(OWN_BOUNDS);
            let skin = object.and_then(|object| skinning.object(object));
            if let (Some(object), Some(_)) = (object, skin) {
                self.skinned.push((self.buckets.len() as u32, object));
            }
            let regions = object.and_then(|object| skinning.parts_of(object));
            let (pipeline, prepass) = pipelines.opaque(pipeline, targets, prepass);
            self.buckets.push(Bucket {
                pipeline,
                prepass,
                group,
                material,
                base,
                capacity: count,
                first_draw: self.draws.len() as u32,
                draws: parts.len() as u32,
                center,
                radius,
                skins: skin.is_some() && vertex_skinning,
                first_joint: skin.map_or(0, |skin| skin.joint_base),
            });
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
                    vertices: region.map(|region| (ids::SKINNED, region.region)),
                }
            }));
            base += count;
        }

        let counts = &self.key_counts;
        let bucket_of = |key: Option<BucketKey>| bucket_of(counts, key).unwrap_or(HIDDEN);
        self.instance_buckets.clear();
        self.home_buckets.clear();
        let slots = world.radii().iter().zip(scene.cells()).zip(scene.flags());
        for (slot, ((&radius, &cell), &flags)) in slots.take(scene_rows as usize).enumerate() {
            let home = bucket_of(scene_key(slot));
            self.home_buckets.push(home);
            self.instance_buckets
                .push(scene_entry(home, radius, cell, flags));
        }
        self.occluders = occluders_in(&self.instance_buckets);
        self.source_layers.clear();
        if self.owns_sources() {
            self.source_layers
                .extend_from_slice(&scene.layers()[..scene_rows as usize]);
        }
        self.scene_layers_default = scene.common_layers().is_some();
        self.batch_rows.clear();
        for (_, batch) in batches.iter() {
            let bucket = bucket_of(batch_key(batch));
            let (active, layers) = (batch.frame_active_count(parity), batch.layers());
            self.batch_rows.push(BatchRows {
                bucket,
                active,
                layers,
            });
            self.instance_buckets
                .extend((0..batch.capacity()).map(|row| row_entry(bucket, batch, row, active)));
            if self.owns_sources() {
                let rows = self.source_layers.len() + batch.capacity() as usize;
                self.source_layers.resize(rows, layers);
            }
        }

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
            ]);
        }
        self.built = true;
        Ok(())
    }

    /// Uploads the bounds of the skinned objects' buckets, which the animation step moved: one
    /// write of the records from the first such bucket to the last.
    pub(super) fn update_skinned(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        scene: &SceneStorage,
    ) -> Result<(), RecordError> {
        let (Some(&(first, _)), Some(&(last, _))) = (self.skinned.first(), self.skinned.last())
        else {
            return Ok(());
        };
        for &(bucket, slot) in &self.skinned {
            let (center, radius) = local_sphere(scene, OWN_BOUNDS + slot, 0.0);
            let record = &mut self.bucket_records[(bucket * BUCKET_WORDS) as usize..];
            record[2] = radius.to_bits();
            record[5..8].copy_from_slice(&center.map(f32::to_bits));
        }
        let words = &self.bucket_records
            [(first * BUCKET_WORDS) as usize..((last + 1) * BUCKET_WORDS) as usize];
        let (at, bytes) = arena.push(words_as_bytes(words))?;
        let (_, records) = self.table_ids();
        list.push(Op::WriteBuffer, &[records, first * BUCKET_BYTES, at, bytes])?;
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
                *made = grown_size(size, binding_bytes);
                list.push(
                    Op::CreateBuffer,
                    &[id, *made, usage::STORAGE | usage::COPY_DST],
                )?;
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
        if !self.buckets.is_empty() {
            let (at, bytes) = arena.push(words_as_bytes(&self.bucket_records))?;
            list.push(Op::WriteBuffer, &[records, 0, at, bytes])?;
        }
        Ok(recreated)
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
        let (instance_buckets, source_layers, occluders) = (
            &mut self.instance_buckets,
            &mut self.source_layers,
            &mut self.occluders,
        );
        let mut check = |start: u32, count: u32| -> Result<(), RecordError> {
            let slots = start..(start + count).min(scene_rows);
            let entry =
                |s: usize| scene_entry(home_buckets[s], radii[s], cells[s], object_flags[s]);
            let range = slots.start as usize..slots.end as usize;
            let before = occluders_in(&instance_buckets[range.clone()]);
            if let Some(rows) = sync_rows(instance_buckets, slots.clone(), entry) {
                *occluders = *occluders - before + occluders_in(&instance_buckets[range]);
                write_rows(list, arena, entries, instance_buckets, rows)?;
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
            for row in low..high {
                self.instance_buckets[(base + row) as usize] = row_entry(bucket, batch, row, now);
            }
            self.batch_rows[index].active = now;
            let rows = base + low..base + high;
            write_rows(list, arena, entries, &self.instance_buckets, rows)?;
        }
        Ok(())
    }

    /// Uploads changed world matrices straight from the core's world buffers of this parity, or
    /// every matrix after the layout changed.
    pub(super) fn upload_matrices(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        parity: usize,
        everything: bool,
    ) -> Result<(), RecordError> {
        let mut upload = |base: u32, matrices: &[f32], start: u32, count: u32| {
            let floats =
                &matrices[start as usize * MATRIX_FLOATS..(start + count) as usize * MATRIX_FLOATS];
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
        for range in input.snapshot.uploads() {
            let Some(base) = self.base_of(range.target) else {
                continue;
            };
            if range.target == SCENE_TARGET {
                let scene = input.scene.world(parity).matrices();
                if let Some((start, count)) =
                    drawn_rows(&self.home_buckets, range.start, range.count)
                {
                    upload(base, scene, start, count)?;
                }
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
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use null3d_core::jobs::JobSystem;
    use null3d_core::scene::Command;
    use null3d_gpu::drawlist::format;

    use super::*;
    use crate::frame::CanvasOutput;
    use crate::geometry::box_geometry;
    use crate::gpu_driven::scene_settings;
    use crate::materials::Shading;

    #[test]
    fn objects_with_bounds_of_their_own_or_none_cull_in_buckets_of_their_own() {
        let mut settings = scene_settings(4, CanvasOutput::default());
        let box_mesh = box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap();
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
                false,
                Prepass::Off,
                &Skinning::default(),
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
                (2, [0.0; 3], mesh_radius),
                (1, [0.0; 3], UNBOUNDED_RADIUS),
                (1, [0.0, 1.5, 0.0], 4.0),
            ]
        );
        // Each record holds its sphere's centre, where the culling shader reads it, then the
        // first joint of a skin, which no bucket here has.
        let words = BUCKET_WORDS as usize;
        let record = &layout.bucket_records[2 * words..3 * words];
        assert_eq!(record[5..8], [0.0f32, 1.5, 0.0].map(f32::to_bits));
        assert_eq!(record[8], 0);
    }
}
